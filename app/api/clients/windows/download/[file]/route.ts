import { NextResponse } from 'next/server';
import {
  fetchGithubLatest,
  findInstallerAsset,
  githubHeaders,
} from '@/lib/windows-release';

/**
 * GET /api/clients/windows/download/<filename>
 *
 * Прокси-стриминг installer'а Windows-клиента с GitHub Releases.
 *
 * Зачем: репозиторий `Hundler-App` приватный, поэтому прямые ссылки
 * `…/releases/download/<tag>/<file>` отдают 404 всем без токена. Этот
 * роут качает ассет из GitHub с серверным PAT и стримит его юзеру —
 * клиент/браузер видит обычный `.exe` с нашего домена, GitHub нигде
 * не светится.
 *
 * `<filename>` в пути косметический (клиент использует его как имя
 * temp-файла, см. `update_installer.dart::_filenameFromUrl`). Роут
 * всегда отдаёт installer из ПОСЛЕДНЕГО релиза — это совпадает с тем,
 * что отдаёт `latest.json`, и обеспечивает консистентность с sha256.
 *
 * Стриминг большого бинарника → форсим Node runtime и отключаем кэш
 * (иначе Next попытается забуферить/закэшировать ответ).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const release = await fetchGithubLatest();
  if (!release || release.draft) {
    return NextResponse.json(
      { error: 'No release available' },
      { status: 503 },
    );
  }

  const installer = findInstallerAsset(release);
  if (!installer) {
    return NextResponse.json(
      { error: 'No installer asset in release' },
      { status: 503 },
    );
  }

  // Качаем сам ассет через API-URL с Accept: octet-stream. GitHub
  // отвечает 302 на подписанный CDN-URL (codeload/objects) — fetch
  // сам идёт по редиректу и отдаёт тело файла.
  let ghRes: Response;
  try {
    ghRes = await fetch(installer.url, {
      headers: githubHeaders({ Accept: 'application/octet-stream' }),
      redirect: 'follow',
      cache: 'no-store',
    });
  } catch (e) {
    console.error('Failed to fetch installer asset:', e);
    return NextResponse.json(
      { error: 'Upstream fetch failed' },
      { status: 502 },
    );
  }

  if (!ghRes.ok || !ghRes.body) {
    console.error(`GitHub asset download returned ${ghRes.status}`);
    return NextResponse.json(
      { error: 'Installer not available' },
      { status: 502 },
    );
  }

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${installer.name}"`,
    // Файл меняется только при новом релизе; держим короткий кэш на CDN.
    'Cache-Control': 'public, s-maxage=300, max-age=60',
  });
  // Прокидываем размер если GitHub его вернул — для прогресс-бара клиента.
  const len = ghRes.headers.get('content-length');
  if (len) {
    headers.set('Content-Length', len);
  } else if (installer.size) {
    headers.set('Content-Length', String(installer.size));
  }

  return new NextResponse(ghRes.body, { status: 200, headers });
}
