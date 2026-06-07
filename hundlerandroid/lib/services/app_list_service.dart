import 'package:flutter/services.dart';

/// Запись об установленном приложении (для экрана per-app exclusion).
class InstalledApp {
  const InstalledApp({
    required this.packageName,
    required this.appName,
    required this.isExcluded,
    required this.isSystem,
  });

  final String packageName;
  final String appName;

  /// Сейчас НЕ ходит через VPN (есть в `tun.exclude_package`).
  final bool isExcluded;

  /// Системное приложение (FLAG_SYSTEM). Обычно скрываем — но Chrome /
  /// Google Maps / Play Store технически системные (FLAG_UPDATED_SYSTEM_APP).
  final bool isSystem;

  InstalledApp copyWith({bool? isExcluded}) => InstalledApp(
        packageName: packageName,
        appName: appName,
        isExcluded: isExcluded ?? this.isExcluded,
        isSystem: isSystem,
      );
}

/// Обёртка над platform-channel `com.hundlervpn.android/applist`.
///
/// Логика per-app exclusion:
///
///  1. UI открывает экран → дёргает [getInstalledApps] → показывает список
///     приложений с чекбоксами (тех что включены в `excludedPackages`).
///  2. Юзер тапает чекбокс → UI меняет [InstalledApp.isExcluded] локально.
///  3. На "Сохранить" → [setExcludedPackages] с новым списком.
///  4. На следующее переподключение VPN (либо сейчас, если уже подключён —
///     попросим юзера переподключить) sing-box получает обновлённый
///     `tun.exclude_package` через CoreManager и применяет.
class AppListService {
  AppListService._();

  static final AppListService instance = AppListService._();

  static const _ch = MethodChannel('com.hundlervpn.android/applist');

  Future<List<InstalledApp>> getInstalledApps() async {
    try {
      final raw = await _ch.invokeListMethod<dynamic>('getInstalledApps');
      if (raw == null) return const [];
      return raw
          .map((e) {
            final m = (e as Map).cast<dynamic, dynamic>();
            return InstalledApp(
              packageName: m['packageName'] as String? ?? '',
              appName: m['appName'] as String? ?? '',
              isExcluded: m['isExcluded'] as bool? ?? false,
              isSystem: m['isSystem'] as bool? ?? false,
            );
          })
          .where((a) => a.packageName.isNotEmpty)
          .toList(growable: false);
    } on MissingPluginException {
      return const [];
    } on PlatformException {
      return const [];
    }
  }

  Future<List<String>> getExcludedPackages() async {
    try {
      final raw = await _ch.invokeListMethod<String>('getExcludedPackages');
      return raw ?? const [];
    } on MissingPluginException {
      return const [];
    }
  }

  Future<void> setExcludedPackages(Set<String> packages) async {
    try {
      await _ch.invokeMethod<bool>(
        'setExcludedPackages',
        <String, dynamic>{'packages': packages.toList()},
      );
    } on MissingPluginException {
      // ignored
    }
  }

  /// Возвращает список packages из дефолтного RU-пресета. Используется
  /// для UI-кнопки "Восстановить пресет RU банков и госуслуг".
  Future<List<String>> getRuBankPreset() async {
    try {
      final raw = await _ch.invokeListMethod<String>('getRuBankPreset');
      return raw ?? const [];
    } on MissingPluginException {
      return const [];
    }
  }

  Future<List<String>> applyRuBankPreset() async {
    try {
      final raw = await _ch.invokeListMethod<String>('applyRuBankPreset');
      return raw ?? const [];
    } on MissingPluginException {
      return const [];
    }
  }

  Future<void> clearAll() async {
    try {
      await _ch.invokeMethod<bool>('clearExcludedPackages');
    } on MissingPluginException {
      // ignored
    }
  }
}
