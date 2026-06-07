import { NextResponse } from 'next/server';

/**
 * GET /api/clients/windows/latest.json
 *
 * Возвращает информацию о последнем релизе Windows-клиента в формате,
 * который ожидает `lib/services/update_checker.dart`:
 *
 * ```json
 * {
 *   "version": "0.1.1",
 *   "url": "https://github.com/hundlervpn/Hundler-App/releases/download/v0.1.1/HundlerVPN-Setup-v0.1.1.exe",
 *   "sha256": "<hex>",
 *   "release_notes": "...",
 *   "min_version": "0.1.0",
 *   "mandatory": false
 * }
 * ```
 *
 * Источник правды — GitHub Releases API:
 * `https://api.github.com/repos/hundlervpn/Hundler-App/releases/latest`
 *
 * **Кэшируем ответ на 5 минут** через `Cache-Control` чтобы не упереться
 * в rate-limit GitHub API (60 req/hour без auth, 5000 с PAT). Юзеры
 * Hundler чекают апдейт раз в час → даже без кеша мы бы не упёрлись,
 * но кеш страхует от всплесков.
 *
 * Если GitHub недоступен или нет ни одного релиза — возвращаем 503,
 * клиент тихо игнорирует (не показывает баннер).
 *
 * Имя папки `latest.json/` (с точкой) — Next.js app-router принимает
 * `.json` как часть URL-сегмента, и финальный URL получается ровно
 * `/api/clients/windows/latest.json` без редиректа. Так клиент v0.1.0
 * получит апдейт без правки `_manifestUrl` константы.
 */

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubAsset[];
  published_at: string;
}

const GITHUB_REPO = 'hundlervpn/Hundler-App';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Минимальная версия клиента которая ещё поддерживается. Всё что ниже —
// принудительный upgrade (mandatory=true). Поднимать вручную при
// breaking changes в API/протоколе.
const MIN_SUPPORTED_VERSION = '0.1.0';

// Имя файла-installer'а в GitHub Release. Должно совпадать с тем что
// генерит `release-windows.yml` workflow → `HundlerVPN-Setup-vX.Y.Z.exe`.
function findInstallerAsset(release: GithubRelease): GithubAsset | null {
  return (
    release.assets.find(
      (a) => a.name.endsWith('.exe') && a.name.startsWith('HundlerVPN-Setup'),
    ) ?? null
  );
}

function findSha256Asset(release: GithubRelease): GithubAsset | null {
  return (
    release.assets.find((a) => a.name.endsWith('.exe.sha256')) ?? null
  );
}

// `v0.1.1` → `0.1.1`. UpdateChecker сравнивает версии без `v`-префикса
// потому что `package_info_plus` отдаёт `pubspec.yaml::version` без `v`.
function normalizeVersion(tag: string): string {
  return tag.startsWith('v') ? tag.substring(1) : tag;
}

async function fetchGithubLatest(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(GITHUB_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // User-Agent обязателен в GitHub API — без него 403.
        'User-Agent': 'HundlerVPN-Backend',
      },
      // Next.js 14: revalidate=300 кэширует ответ на 5 минут на edge.
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`GitHub API returned ${res.status}`);
      return null;
    }
    return (await res.json()) as GithubRelease;
  } catch (e) {
    console.error('Failed to fetch GitHub releases:', e);
    return null;
  }
}

async function fetchSha256(asset: GithubAsset | null): Promise<string | null> {
  if (!asset) return null;
  try {
    const res = await fetch(asset.browser_download_url, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim().toLowerCase();
    // Файл `.sha256` содержит просто хеш. Если случайно туда попало
    // что-то типа `<hex>  filename` — берём первое слово.
    return text.split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
  while (pa.length < 3) pa.push(0);
  while (pb.length < 3) pb.push(0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

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

  const shaAsset = findSha256Asset(release);
  const sha256 = await fetchSha256(shaAsset);

  const version = normalizeVersion(release.tag_name);
  const minNormalized = normalizeVersion(MIN_SUPPORTED_VERSION);
  // `mandatory` если последняя стабильная версия выше нашего минимума,
  // и юзер на ещё более старой версии. Сейчас MIN=0.1.0 — никого не
  // блокируем. Логика на будущее.
  const mandatory =
    compareVersions(version, minNormalized) > 0 && false;

  // Release notes из GitHub приходят в Markdown. Клиент покажет 2 строки
  // — этого хватит для краткого summary. Если хочется красиво — можно
  // парсить только первую строку или первый параграф.
  const notes = release.body?.trim() ?? '';

  return NextResponse.json(
    {
      version,
      url: installer.browser_download_url,
      sha256,
      release_notes:
        notes.length > 200 ? notes.substring(0, 200) + '…' : notes,
      min_version: minNormalized,
      mandatory,
      // Полезные мета для дебага — клиент их игнорирует.
      _meta: {
        published_at: release.published_at,
        size_bytes: installer.size,
        installer_name: installer.name,
      },
    },
    {
      headers: {
        // Edge кеш 5 минут + browser кеш 1 минута. Юзеры не должны
        // видеть устаревший ответ дольше 5 минут после нового релиза.
        'Cache-Control': 'public, s-maxage=300, max-age=60',
      },
    },
  );
}
