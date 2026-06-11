import { NextResponse } from 'next/server';
import {
  DEFAULT_ABI,
  fetchAndroidLatest,
  findApkAsset,
} from '@/lib/android-release';
import { appBaseUrl } from '@/lib/windows-release';

/**
 * GET /download/android
 *
 * Публичная «красивая» ссылка для первой установки Android-клиента —
 * аналог `/download` для Windows. Редиректит на прокси-роут скачивания
 * arm64-v8a APK (подходит ~всем живым устройствам; владельцы экзотики
 * возьмут свой ABI из ассетов GitHub-релиза или через мини-апп).
 *
 * Эту ссылку даём юзерам / кладём в бота / на сайт:
 * `https://hundlervpn.xyz/download/android` всегда отдаст актуальный APK.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const release = await fetchAndroidLatest();
  const apk =
    release && !release.draft ? findApkAsset(release, DEFAULT_ABI) : null;

  if (!apk) {
    // Нет релиза — на главную, а не голая ошибка.
    return NextResponse.redirect(appBaseUrl(), { status: 302 });
  }

  const target = `${appBaseUrl()}/api/clients/android/download/${encodeURIComponent(
    apk.name,
  )}`;
  return NextResponse.redirect(target, { status: 302 });
}
