/// VPN-сервер, как его отдаёт `/api/servers`.
///
/// Тут НЕТ `public_key` / `short_id` / `sni` / `uuid` — они входят
/// только в sing-box JSON конфиг (`/api/sub/{token}`) и не должны
/// существовать в Dart-runtime отдельно. Иначе клиент мог бы
/// собирать VLESS-URL сам — а нам это не нужно (см. AGENTS.md
/// "VPN-протокол").
class HundlerServer {
  const HundlerServer({
    required this.id,
    required this.name,
    required this.host,
    required this.port,
    required this.country,
    required this.isActive,
  });

  final int id;
  final String name;
  final String host;
  final int port;
  final String country;     // ISO-2 ('DE', 'NL', 'RU')
  final bool isActive;

  factory HundlerServer.fromJson(Map<String, dynamic> json) {
    return HundlerServer(
      id: _asInt(json['id']) ?? 0,
      name: json['name'] as String? ?? '',
      host: json['host'] as String? ?? '',
      port: _asInt(json['port']) ?? 443,
      country: (json['country'] as String? ?? '').toUpperCase(),
      isActive: json['is_active'] as bool? ?? true,
    );
  }

  /// Эмодзи-флаг по ISO-2 коду страны. Используется в UI карточек серверов.
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
/// строки. Идентичен helper'у в `api_client.dart`, но дублирован тут
/// чтобы не создавать кросс-импорт между моделью и API-клиентом.
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
