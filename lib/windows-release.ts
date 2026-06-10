/**
 * Общий helper для работы с GitHub-релизами Windows-клиента
 * (`hundlervpn/Hundler-App`).
 *
 * Используется двумя роутами:
 *  - `GET /api/clients/windows/latest.json`     — манифест авто-апдейта
 *  - `GET /api/clients/windows/download/[file]` — стриминг installer'а
 *
 * ## Зачем нужен токен
 * Репозиторий `Hundler-App` приватный. У приватного репо ассеты релизов
 * НЕ доступны по публичной ссылке `…/releases/download/<tag>/<file>` —
 * GitHub отдаёт 404 всем без авторизации. Поэтому:
 *  - сам GitHub API дёргаем с `Authorization: Bearer <token>`,
 *  - а юзерам отдаём файл сами (прокси-роут стримит ассет с токеном).
 *
 * Токен берём из `process.env.GITHUB_RELEASE_TOKEN` (fine-grained PAT,
 * read-only на Contents этого репо). Если токена нет — работаем без
 * авторизации (на случай если репо ещё публичный): тогда всё ведёт себя
 * как раньше. Это делает переход бесшовным: добавил токен + закрыл
 * репо — прокси сразу подхватит.
 */

export const GITHUB_REPO = 'hundlervpn/Hundler-App';
const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface GithubAsset {
  /** Имя файла, напр. `HundlerVPN-Setup-v0.1.8.exe`. */
  name: string;
  /** API-URL ассета (`…/releases/assets/<id>`) — для приватного скачивания. */
  url: string;
  /** Публичный browser URL (работает только для публичного репо). */
  browser_download_url: string;
  size: number;
  id: number;
}

export interface GithubRelease {
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubAsset[];
  published_at: string;
}

/** Заголовки для запросов в GitHub API. Добавляет токен, если он есть. */
export function githubHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // User-Agent обязателен в GitHub API — без него 403.
    'User-Agent': 'HundlerVPN-Backend',
    ...extra,
  };
  const token = process.env.GITHUB_RELEASE_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Имя installer-ассета должно совпадать с тем, что генерит CI. */
export function findInstallerAsset(release: GithubRelease): GithubAsset | null {
  return (
    release.assets.find(
      (a) => a.name.endsWith('.exe') && a.name.startsWith('HundlerVPN-Setup'),
    ) ?? null
  );
}

export function findSha256Asset(release: GithubRelease): GithubAsset | null {
  return release.assets.find((a) => a.name.endsWith('.exe.sha256')) ?? null;
}

/** `v0.1.8` → `0.1.8`. */
export function normalizeVersion(tag: string): string {
  return tag.startsWith('v') ? tag.substring(1) : tag;
}

/**
 * Тянет последний релиз из GitHub API. Короткий кэш 60с (revalidate)
 * чтобы новый релиз появлялся в открытом клиенте почти сразу; rate-limit
 * не упираемся за счёт PAT (`GITHUB_RELEASE_TOKEN` → 5000 req/hour).
 * Возвращает `null` при ошибке/отсутствии.
 */
export async function fetchGithubLatest(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(GITHUB_LATEST_API, {
      headers: githubHeaders(),
      next: { revalidate: 60 },
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

/**
 * Читает содержимое `.exe.sha256` ассета. Для приватного репо качаем
 * через API-URL ассета с `Accept: application/octet-stream` + токен
 * (browser_download_url для приватного репо вернёт 404).
 */
export async function fetchSha256(asset: GithubAsset | null): Promise<string | null> {
  if (!asset) return null;
  try {
    const res = await fetch(asset.url, {
      headers: githubHeaders({ Accept: 'application/octet-stream' }),
      redirect: 'follow',
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim().toLowerCase();
    // Файл `.sha256` обычно содержит просто хеш; иногда `<hex>  filename`.
    return text.split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
  while (pa.length < 3) pa.push(0);
  while (pb.length < 3) pb.push(0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Базовый URL приложения (для построения ссылок на прокси). */
export function appBaseUrl(): string {
  return process.env.APP_URL || 'https://hundlervpn.xyz';
}
