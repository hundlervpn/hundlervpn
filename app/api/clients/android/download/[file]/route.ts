import { NextResponse } from 'next/server';
import { fetchAndroidLatest, resolveApkAsset } from '@/lib/android-release';
import { githubHeaders } from '@/lib/windows-release';

/**
 * GET /api/clients/android/download/<filename>
 *
 * Прокси-стриминг APK Android-клиента с GitHub Releases. Зачем — см.
 * Windows-аналог (`api/clients/windows/download/[file]/route.ts`):
 * репо приватный, прямые ссылки GitHub отдают 404, стримим ассет сами
 * с серверным PAT.
 *
 * ⚠️ Отличие от Windows: `<filename>` здесь НЕ косметический! CI
 * собирает три APK под разные архитектуры (`HundlerVPN-<ver>-<abi>.apk`),
 * и имя файла определяет, какую из них отдать (см. resolveApkAsset:
 * точное имя → тот же ABI из последнего релиза → arm64-v8a).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const fileName = decodeURIComponent(file ?? '');

  const release = await fetchAndroidLatest();
  if (!release || release.draft) {
    return NextResponse.json(
      { error: 'No release available' },
      { status: 503 },
    );
  }

  const apk = resolveApkAsset(release, fileName);
  if (!apk) {
    return NextResponse.json(
      { error: 'No APK asset in release' },
      { status: 503 },
    );
  }

  // API-URL ассета + Accept: octet-stream → GitHub 302 на подписанный
  // CDN-URL, fetch сам идёт по редиректу.
  let ghRes: Response;
  try {
    ghRes = await fetch(apk.url, {
      headers: githubHeaders({ Accept: 'application/octet-stream' }),
      redirect: 'follow',
      cache: 'no-store',
    });
  } catch (e) {
    console.error('Failed to fetch APK asset:', e);
    return NextResponse.json(
      { error: 'Upstream fetch failed' },
      { status: 502 },
    );
  }

  if (!ghRes.ok || !ghRes.body) {
    console.error(`GitHub APK download returned ${ghRes.status}`);
    return NextResponse.json(
      { error: 'APK not available' },
      { status: 502 },
    );
  }

  const headers = new Headers({
    // Правильный MIME, чтобы Android-браузер сразу предлагал установку.
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${apk.name}"`,
    'Cache-Control': 'public, s-maxage=300, max-age=60',
  });
  // Content-Length — для прогресс-бара в клиенте.
  const len = ghRes.headers.get('content-length');
  if (len) {
    headers.set('Content-Length', len);
  } else if (apk.size) {
    headers.set('Content-Length', String(apk.size));
  }

  return new NextResponse(ghRes.body, { status: 200, headers });
}
