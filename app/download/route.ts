import { NextResponse } from 'next/server';
import {
  appBaseUrl,
  fetchGithubLatest,
  findInstallerAsset,
} from '@/lib/windows-release';

/**
 * GET /download
 *
 * Публичная «красивая» ссылка для первой установки Windows-клиента.
 * Резолвит последний релиз и редиректит на прокси-роут скачивания
 * (`/api/clients/windows/download/<name>`), который стримит `.exe`
 * с приватного GitHub-репо через серверный токен.
 *
 * Эту ссылку можно давать юзерам / класть на сайт / в бота —
 * `https://hundlervpn.xyz/download` всегда отдаст актуальный installer.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const release = await fetchGithubLatest();
  const installer = release && !release.draft ? findInstallerAsset(release) : null;

  if (!installer) {
    // Нет релиза — отправляем на главную, а не показываем голую ошибку.
    return NextResponse.redirect(appBaseUrl(), { status: 302 });
  }

  const target = `${appBaseUrl()}/api/clients/windows/download/${encodeURIComponent(
    installer.name,
  )}`;
  return NextResponse.redirect(target, { status: 302 });
}
