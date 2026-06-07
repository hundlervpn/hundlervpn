/// VPN-сервер, как его отдаёт `/api/servers`.
///
/// Тут НЕТ `public_key` / `short_id` / `sni` / `uuid` — они входят
/// только в sing-box JSON конфиг (`/api/sub/{token}`) и не должны
/// существовать в Dart-runtime отдельно. Иначе клиент мог бы
/// собирать VLESS-URL сам — а нам это не нужно (см. AGENTS.md
/// "VPN-протокол").
///
/// Файл — побайтовая копия из `hundlerandroid/lib/data/models/server.dart`.
class HundlerServer {
  const HundlerServer({
    required this.id,
    required this.name,
    required this.host,
    required this.port,
    required this.country,
    required this.isActive,
    this.protocols = const ['vless'],
  });

  final int id;
  final String name;
  final String host;
  final int port;
  final String country;     // ISO-2 ('DE', 'NL', 'RU')
  final bool isActive;

  /// Какие proxy-протоколы поддерживает сервер. Возвращается с
  /// `/api/servers` как `protocols: ["vless"]` или
  /// `["vless", "hysteria"]`. Используется на экране выбора локаций
  /// для фильтрации списка под выбранный пользователем протокол.
  ///
  /// Если бэкенд по какой-то причине не вернул поле — fallback на
  /// `['vless']`, потому что VLESS+Reality есть на каждом активном
  /// сервере (см. бэкенд `/api/servers/route.ts` v62).
  final List<String> protocols;

  bool supports(String protocol) => protocols.contains(protocol);

  factory HundlerServer.fromJson(Map<String, dynamic> json) {
    final rawProtocols = json['protocols'];
    final List<String> protocols;
    if (rawProtocols is List) {
      protocols = rawProtocols
          .whereType<String>()
          .map((p) => p.toLowerCase().trim())
          .where((p) => p.isNotEmpty)
          .toList(growable: false);
    } else {
      protocols = const ['vless'];
    }

    return HundlerServer(
      id: _asInt(json['id']) ?? 0,
      name: json['name'] as String? ?? '',
      host: json['host'] as String? ?? '',
      port: _asInt(json['port']) ?? 443,
      country: (json['country'] as String? ?? '').toUpperCase(),
      isActive: json['is_active'] as bool? ?? true,
      protocols: protocols.isEmpty ? const ['vless'] : protocols,
    );
  }

  /// Эмодзи-флаг по ISO-2 коду страны. Используется в UI карточек серверов.
  ///
  /// Внимание: на Windows **по умолчанию** Segoe UI Emoji не рендерит
  /// regional-indicator-pairs как флаги (политическое решение Microsoft —
  /// Windows показывает текстовое "DE" вместо 🇩🇪). Если позже захотим
  /// настоящие флаги — bundle'им шрифт `TwemojiCountryFlags` или используем
  /// SVG-иконки из package `country_flags`. Пока живём с двухбуквенным
  /// fallback.
  String get flag => _flagFromCountry(country);

  String get displayName {
    final base = name.isEmpty ? country : name;
    return '$flag ${_localCountry(country)} | $base';
  }

  static String _flagFromCountry(String code) {
    if (code.length != 2) return '🏳';
    final base = 0x1F1E6 - 'A'.codeUnitAt(0);
    return String.fromCharCodes([
      base + code.codeUnitAt(0).toInt(),
      base + code.codeUnitAt(1).toInt(),
    ]);
  }
}

/// Безопасный int-парсер — id/port из node-postgres могут приходить как
/// строки.
int? _asInt(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) {
    final i = int.tryParse(v);
    if (i != null) return i;
    final d = double.tryParse(v);
    if (d != null) return d.toInt();
  }
  return null;
}

/// Локализованное название страны для отображения в UI.
String _localCountry(String iso) {
  switch (iso) {
    case 'DE':
      return 'Германия';
    case 'NL':
      return 'Нидерланды';
    case 'RU':
      return 'Россия';
    case 'US':
      return 'США';
    case 'GB':
      return 'Великобритания';
    case 'FR':
      return 'Франция';
    case 'JP':
      return 'Япония';
    default:
      return iso;
  }
}
