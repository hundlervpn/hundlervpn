/**
 * Helper для работы с GitHub-релизами Android-клиента
 * (`hundlervpn/Hundler-Android`).
 *
 * Используется роутами:
 *  - `GET /api/clients/android/latest.json`     — манифест авто-апдейта
 *  - `GET /api/clients/android/download/[file]` — стриминг APK
 *  - `GET /download/android`                    — 302 на arm64-APK
 *
 * Generic-хелперы (заголовки с PAT, сравнение версий и т.п.)
 * переиспользуем из `windows-release.ts` — логика одна, отличается
 * только репо и набор ассетов.
 *
 * ## Per-ABI APK
 * CI Android-клиента (`release-android.yml`) собирает релиз с
 * `--split-per-abi`: три APK с именами
 * `HundlerVPN-<version>-<abi>.apk`, abi ∈ {arm64-v8a, armeabi-v7a,
 * x86_64}, плюс по `.sha256`-файлу на каждый. Клиент сам выбирает APK
 * под свою архитектуру из `apks{}` манифеста; arm64-v8a — дефолт
 * (~99% живых устройств).
 *
 * Репозиторий приватный → ассеты качаем через API-URL с
 * `GITHUB_RELEASE_TOKEN` (см. windows-release.ts «Зачем нужен токен»).
 * ⚠️ PAT должен быть выдан и на `Hundler-Android` (Contents read-only),
 * не только на `Hundler-App`!
 */

import {
  githubHeaders,
  type GithubAsset,
  type GithubRelease,
} from '@/lib/windows-release';

export const ANDROID_GITHUB_REPO = 'hundlervpn/Hundler-Android';
const ANDROID_LATEST_API = `https://api.github.com/repos/${ANDROID_GITHUB_REPO}/releases/latest`;

/** ABI, которые собирает CI. Порядок = приоритет fallback'а. */
export const ANDROID_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64'] as const;
export type AndroidAbi = (typeof ANDROID_ABIS)[number];

/** Дефолтная архитектура для «просто скачать» ссылок. */
export const DEFAULT_ABI: AndroidAbi = 'arm64-v8a';

/**
 * Последний релиз Android-клиента из GitHub API. Кэш 60с — новый релиз
 * виден клиентам в течение ~минуты. `null` при ошибке/отсутствии.
 */
export async function fetchAndroidLatest(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(ANDROID_LATEST_API, {
      headers: githubHeaders(),
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      console.error(`GitHub API (android) returned ${res.status}`);
      return null;
    }
    return (await res.json()) as GithubRelease;
  } catch (e) {
    console.error('Failed to fetch Android GitHub releases:', e);
    return null;
  }
}

/** APK-ассет под конкретную архитектуру (`HundlerVPN-…-<abi>.apk`). */
export function findApkAsset(
  release: GithubRelease,
  abi: AndroidAbi,
): GithubAsset | null {
  return (
    release.assets.find(
      (a) =>
        a.name.startsWith('HundlerVPN-') &&
        a.name.endsWith(`-${abi}.apk`),
    ) ?? null
  );
}

/** `.sha256`-ассет, парный к APK (`<имя>.apk.sha256`). */
export function findApkSha256Asset(
  release: GithubRelease,
  apk: GithubAsset,
): GithubAsset | null {
  return release.assets.find((a) => a.name === `${apk.name}.sha256`) ?? null;
}

/**
 * Резолвит ассет по имени файла из URL прокси-роута:
 *  1. точное совпадение имени (нормальный путь),
 *  2. совпадение по `-<abi>.apk`-суффиксу — версия в имени устарела
 *     (юзер качает по старой ссылке, а релиз уже новее) → отдаём ту же
 *     архитектуру из последнего релиза, консистентно с latest.json,
 *  3. fallback на arm64-v8a.
 */
export function resolveApkAsset(
  release: GithubRelease,
  fileName: string,
): GithubAsset | null {
  const exact = release.assets.find(
    (a) => a.name === fileName && a.name.endsWith('.apk'),
  );
  if (exact) return exact;

  const abi = ANDROID_ABIS.find((x) => fileName.endsWith(`-${x}.apk`));
  if (abi) {
    const byAbi = findApkAsset(release, abi);
    if (byAbi) return byAbi;
  }

  return findApkAsset(release, DEFAULT_ABI);
}
