import { NextResponse } from 'next/server';
import {
  ANDROID_ABIS,
  DEFAULT_ABI,
  fetchAndroidLatest,
  findApkAsset,
  findApkSha256Asset,
} from '@/lib/android-release';
import {
  appBaseUrl,
  compareVersions,
  fetchSha256,
  normalizeVersion,
} from '@/lib/windows-release';

/**
 * GET /api/clients/android/latest.json
 *
 * Манифест авто-апдейта Android-клиента — формат, который ожидает
 * `Hundler-Android/lib/services/update_checker.dart`:
 *
 * ```json
 * {
 *   "version": "0.2.0",
 *   "url": "https://hundlervpn.xyz/api/clients/android/download/HundlerVPN-0.2.0-arm64-v8a.apk",
 *   "sha256": "<hex arm64>",
 *   "apks": {
 *     "arm64-v8a":   { "url": "…", "sha256": "<hex>", "size": 123 },
 *     "armeabi-v7a": { "url": "…", "sha256": "<hex>", "size": 123 },
 *     "x86_64":      { "url": "…", "sha256": "<hex>", "size": 123 }
 *   },
 *   "min_version": "0.2.0",
 *   "mandatory": false
 * }
 * ```
 *
 * Клиент выбирает APK под СВОЮ архитектуру из `apks{}`; верхнеуровневые
 * `url`/`sha256` — arm64-v8a fallback для неизвестных ABI.
 *
 * Всё остальное — как у Windows-аналога (см. комментарии в
 * `api/clients/windows/latest.json/route.ts`): приватный репо → ссылки
 * ведут на наш прокси, кэш 60с, 503 при недоступном GitHub (клиент
 * тихо не показывает баннер).
 */

// Минимальная поддерживаемая версия Android-клиента. Всё что ниже —
// mandatory-обновление (красный баннер). Поднимать при breaking changes.
const MIN_SUPPORTED_VERSION = '0.2.0';

export async function GET() {
  const release = await fetchAndroidLatest();
  if (!release || release.draft) {
    return NextResponse.json(
      { error: 'No release available' },
      { status: 503 },
    );
  }

  const base = appBaseUrl();
  const apks: Record<
    string,
    { url: string; sha256: string | null; size: number }
  > = {};

  for (const abi of ANDROID_ABIS) {
    const apk = findApkAsset(release, abi);
    if (!apk) continue;
    // .sha256-ассеты крошечные (64 байта), качаем все три — каждый
    // fetch кэшируется на 60с, как и сам манифест.
    const sha256 = await fetchSha256(findApkSha256Asset(release, apk));
    apks[abi] = {
      url: `${base}/api/clients/android/download/${encodeURIComponent(apk.name)}`,
      sha256,
      size: apk.size,
    };
  }

  const fallback = apks[DEFAULT_ABI] ?? Object.values(apks)[0];
  if (!fallback) {
    return NextResponse.json(
      { error: 'No APK assets in release' },
      { status: 503 },
    );
  }

  const version = normalizeVersion(release.tag_name);
  const minNormalized = normalizeVersion(MIN_SUPPORTED_VERSION);
  // mandatory выключен (как у Windows): включается когда поднимем
  // MIN_SUPPORTED_VERSION при breaking change и уберём `&& false`.
  const mandatory = compareVersions(version, minNormalized) > 0 && false;

  return NextResponse.json(
    {
      version,
      url: fallback.url,
      sha256: fallback.sha256,
      apks,
      min_version: minNormalized,
      mandatory,
      // Мета для дебага — клиент игнорирует.
      _meta: {
        published_at: release.published_at,
        tag: release.tag_name,
      },
    },
    {
      headers: {
        // Edge 60с + browser 30с; клиент дополнительно ре-чекает раз в
        // 15 мин и при возврате приложения из фона.
        'Cache-Control': 'public, s-maxage=60, max-age=30',
      },
    },
  );
}
