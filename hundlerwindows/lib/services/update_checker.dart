import 'package:dio/dio.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Проверка обновлений приложения.
///
/// Бэкенд должен реализовать эндпоинт:
/// ```
/// GET https://hundlervpn.xyz/api/clients/windows/latest.json
/// {
///   "version": "0.2.0",
///   "url": "https://hundlervpn.xyz/dl/hundler-0.2.0-win-x64.exe",
///   "sha256": "<hex>",
///   "release_notes": "Исправления ...",
///   "min_version": "0.1.0",
///   "mandatory": false
/// }
/// ```
///
/// Семантика полей:
/// - `version`: текущая последняя версия в семвере (`a.b.c`).
/// - `url`: прямая ссылка на installer / portable exe.
/// - `sha256`: хэш бинарника — клиент проверит после скачивания.
/// - `release_notes`: краткое описание изменений на русском.
/// - `min_version`: версия ниже которой работа НЕ поддерживается.
///   Если текущая < min_version → юзера принудительно отправляем на
///   обновление, кнопка Connect блокирована.
/// - `mandatory`: то же что `min_version`-trigger, но через флаг.
///
/// Клиент:
/// 1. При старте приложения (после auth) один раз дергает endpoint.
/// 2. Сравнивает версии через [_compareVersions].
/// 3. Если новее → возвращает [UpdateInfo] для UI-баннера.
/// 4. Tap по баннеру → `launchUrl(url)` (download в браузере).
///
/// **TODO бэкенд**: эндпоинт `/api/clients/windows/latest.json`,
/// статический файл `/dl/<version>.exe` с code-signed installer
/// (см. WINDOWS-AGENTS.md → security checklist).
class UpdateChecker {
  UpdateChecker._();
  static final UpdateChecker instance = UpdateChecker._();

  static const _manifestUrl =
      'https://hundlervpn.xyz/api/clients/windows/latest.json';

  /// Возвращает `null` если обновлений нет или сеть упала. Никогда не
  /// бросает — баннер обновления опциональный, не должен ломать UI.
  Future<UpdateInfo?> check() async {
    try {
      final pkg = await PackageInfo.fromPlatform();
      final currentVersion = pkg.version;

      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 5),
      ));
      final resp = await dio.getUri<Map<String, dynamic>>(
        Uri.parse(_manifestUrl),
      );
      final data = resp.data;
      if (data == null) return null;

      final latestVersion = data['version'] as String?;
      final url = data['url'] as String?;
      if (latestVersion == null || url == null) return null;

      // Текущая >= latest → обновление не нужно.
      if (_compareVersions(currentVersion, latestVersion) >= 0) {
        return null;
      }

      final minVersion = data['min_version'] as String? ?? '0.0.0';
      final mandatory = data['mandatory'] as bool? ??
          (_compareVersions(currentVersion, minVersion) < 0);

      return UpdateInfo(
        currentVersion: currentVersion,
        latestVersion: latestVersion,
        url: url,
        sha256: data['sha256'] as String?,
        releaseNotes: data['release_notes'] as String? ?? '',
        mandatory: mandatory,
      );
    } catch (_) {
      // Сеть упала / endpoint 404 / парсинг сломан — UI просто не
      // покажет баннер. Не падаем.
      return null;
    }
  }

  /// Сравнивает версии в семвере. `-1` если a<b, `0` если равны,
  /// `1` если a>b. Принимает форматы `a.b.c`, `a.b`, `a`.
  static int _compareVersions(String a, String b) {
    final pa = a.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    final pb = b.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    while (pa.length < 3) {
      pa.add(0);
    }
    while (pb.length < 3) {
      pb.add(0);
    }
    for (var i = 0; i < 3; i++) {
      if (pa[i] != pb[i]) return pa[i].compareTo(pb[i]);
    }
    return 0;
  }
}

class UpdateInfo {
  const UpdateInfo({
    required this.currentVersion,
    required this.latestVersion,
    required this.url,
    required this.sha256,
    required this.releaseNotes,
    required this.mandatory,
  });

  final String currentVersion;
  final String latestVersion;
  final String url;
  final String? sha256;
  final String releaseNotes;

  /// Если `true` — клиент **не должен** позволять подключиться к VPN
  /// без обновления. Используется когда бэкенд знает что текущая
  /// версия имеет критическую уязвимость или несовместимый протокол.
  final bool mandatory;
}
