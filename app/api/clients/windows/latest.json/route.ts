import { NextResponse } from 'next/server';
import {
  appBaseUrl,
  compareVersions,
  fetchGithubLatest,
  fetchSha256,
  findInstallerAsset,
  findSha256Asset,
  normalizeVersion,
} from '@/lib/windows-release';

/**
 * GET /api/clients/windows/latest.json
 *
 * Возвращает информацию о последнем релизе Windows-клиента в формате,
 * который ожидает `lib/services/update_checker.dart`:
 *
 * ```json
 * {
 *   "version": "0.1.8",
 *   "url": "https://hundlervpn.xyz/api/clients/windows/download/HundlerVPN-Setup-v0.1.8.exe",
 *   "sha256": "<hex>",
 *   "release_notes": "...",
 *   "min_version": "0.1.0",
 *   "mandatory": false
 * }
 * ```
 *
 * Источник правды — GitHub Releases API:
 * `https://api.github.com/repos/hundlervpn/Hundler-App/releases/latest`
 * (запрос идёт с PAT, см. `lib/windows-release.ts`).
 *
 * **ВАЖНО — приватный репо:** поле `url` указывает НЕ на GitHub, а на
 * наш собственный прокси-роут `/api/clients/windows/download/<name>`.
 * У приватного репо прямые ссылки `…/releases/download/…` отдают 404
 * всем без токена, поэтому файл отдаём через себя (прокси стримит ассет
 * с токеном). Так репозиторий может быть полностью закрыт, а юзеры всё
 * равно качают по ссылке с нашего домена.
 *
 * **Кэшируем ответ на 5 минут** через `Cache-Control` чтобы не упереться
 * в rate-limit GitHub API.
 *
 * Если GitHub недоступен или нет ни одного релиза — возвращаем 503,
 * клиент тихо игнорирует (не показывает баннер).
 *
 * Имя папки `latest.json/` (с точкой) — Next.js app-router принимает
 * `.json` как часть URL-сегмента, и финальный URL получается ровно
 * `/api/clients/windows/latest.json` без редиректа.
 */

// Минимальная версия клиента которая ещё поддерживается. Всё что ниже —
// принудительный upgrade (mandatory=true). Поднимать вручную при
// breaking changes в API/протоколе.
const MIN_SUPPORTED_VERSION = '0.1.0';

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
  // и юзер на ещё более старой версии. Сейчас отключено (MIN=0.1.0).
  const mandatory =
    compareVersions(version, minNormalized) > 0 && false;

  // Release notes из GitHub приходят в Markdown. Клиент НЕ показывает их
  // в баннере (с v0.1.8), но оставляем поле для совместимости/дебага.
  const notes = release.body?.trim() ?? '';

  // Прокси-ссылка на скачивание с нашего домена. Имя файла в пути —
  // косметическое (клиент берёт его как имя temp-файла); прокси всегда
  // отдаёт installer из последнего релиза.
  const downloadUrl = `${appBaseUrl()}/api/clients/windows/download/${encodeURIComponent(
    installer.name,
  )}`;

  return NextResponse.json(
    {
      version,
      url: downloadUrl,
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
