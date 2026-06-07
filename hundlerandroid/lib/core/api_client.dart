import 'package:device_info_plus/device_info_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../data/models/server.dart';

export '../data/models/server.dart' show HundlerServer;

/// HTTP-клиент к мини-аппу `hundlervpn.xyz`.
///
/// Источник правды по эндпоинтам — `HundlerAll/AGENTS.md` секция
/// "Публичный API-контракт". Не инлайнить URL'ы по проекту — вся
/// маршрутизация идёт через этот клиент.
class HundlerApi {
  HundlerApi({
    Dio? dio,
    FlutterSecureStorage? storage,
    String baseUrl = _defaultBaseUrl,
  })  : _dio = dio ?? _buildDio(baseUrl),
        _storage = storage ?? const FlutterSecureStorage() {
    _dio.interceptors.add(_AuthInterceptor(_storage));
  }

  static const String _defaultBaseUrl = 'https://hundlervpn.xyz';

  final Dio _dio;
  final FlutterSecureStorage _storage;

  static Dio _buildDio(String baseUrl) {
    return Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 12),
        receiveTimeout: const Duration(seconds: 20),
        sendTimeout: const Duration(seconds: 12),
        headers: const {
          'Accept': 'application/json',
        },
      ),
    );
  }

  /// User-Agent в формате, который мини-апп распознаёт как sing-box-клиент.
  /// Бэкенд по этому заголовку отдаёт sing-box JSON (а не base64 VLESS).
  static Future<String> buildUserAgent() async {
    final pkg = await PackageInfo.fromPlatform();
    final di = DeviceInfoPlugin();
    final android = await di.androidInfo;
    return 'HundlerVPN/${pkg.version} '
        '(android; Android ${android.version.release}) '
        'sing-box/embedded';
  }

  /// Заголовки идентификации устройства, которые требует мини-апп для
  /// per-device квоты (см. AGENTS.md → Subscription).
  static Future<Map<String, String>> deviceHeaders() async {
    final di = DeviceInfoPlugin();
    final android = await di.androidInfo;

    // ANDROID_ID — стабильный per-app-signing-key per-device идентификатор.
    // На factory reset и при смене подписи приложения он меняется, но это
    // допустимо — пользователь в худшем случае «потеряет» один слот в
    // лимите и сможет кикнуть старое устройство в /api/users/devices.
    final hwid = android.id;
    final model = '${android.brand} ${android.model}';

    return {
      'X-Device-OS': 'android',
      'X-Device-Model': model,
      'X-HWID': hwid,
      'User-Agent': await buildUserAgent(),
    };
  }

  /// `GET /api/sub/{token}` — главный эндпоинт. Возвращает sing-box JSON
  /// + метаданные подписки в HTTP-заголовках.
  Future<SubscriptionResponse> fetchSubscription(String subToken) async {
    final headers = await deviceHeaders();
    final res = await _dio.getUri<String>(
      Uri.parse('/api/sub/$subToken'),
      options: Options(
        headers: headers,
        responseType: ResponseType.plain,
        validateStatus: (s) => s != null && s < 500,
      ),
    );

    if (res.statusCode != 200) {
      throw HundlerApiException(
        'Subscription fetch failed (${res.statusCode})',
        res.statusCode,
      );
    }

    return SubscriptionResponse(
      configJson: res.data ?? '',
      profileTitle: res.headers.value('profile-title'),
      profileUpdateIntervalHours:
          int.tryParse(res.headers.value('profile-update-interval') ?? '1') ??
              1,
      userInfo: SubscriptionUserInfo.parse(
        res.headers.value('subscription-userinfo'),
      ),
    );
  }

  /// `GET /api/servers` — raw json, для backward-compatibility.
  Future<List<Map<String, dynamic>>> fetchServers() async {
    final res = await _dio.get<Map<String, dynamic>>('/api/servers');
    final raw = res.data;
    if (raw == null || raw['ok'] != true) {
      throw const HundlerApiException('Failed to load servers', 0);
    }
    final list = (raw['servers'] as List?) ?? const [];
    return list.cast<Map<String, dynamic>>();
  }

  /// Типизированный аналог [fetchServers] — отбрасывает неактивные
  /// серверы и парсит в [HundlerServer]. Для UI-списка локаций.
  Future<List<HundlerServer>> fetchServersTyped() async {
    final raw = await fetchServers();
    return raw
        .map(HundlerServer.fromJson)
        .where((s) => s.isActive && s.host.isNotEmpty)
        .toList(growable: false);
  }

  /// `GET /api/auth/session?token=<token>` — проверка валидности
  /// сессионного токена, возвращает базовую инфу о юзере. Вызывается
  /// сразу после OAuth-redirect'а и при холодном старте приложения.
  Future<HundlerSession?> fetchSession(String sessionToken) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/api/auth/session',
      queryParameters: {'token': sessionToken},
      options: Options(validateStatus: (s) => s != null && s < 500),
    );
    if (res.statusCode == 401) return null; // токен невалиден / истёк
    if (res.statusCode != 200 || res.data == null) {
      throw HundlerApiException(
        'Session check failed (${res.statusCode})',
        res.statusCode,
      );
    }
    final raw = res.data!;
    if (raw['ok'] != true) return null;
    final user = (raw['user'] as Map?)?.cast<String, dynamic>();
    if (user == null) return null;
    final uid = _asInt(user['id']);
    if (uid == null) {
      throw HundlerApiException(
        'Session response missing user.id (got: ${user['id']?.runtimeType})',
        res.statusCode,
      );
    }
    return HundlerSession(
      token: sessionToken,
      userId: uid,
      email: user['email'] as String?,
      name: user['name'] as String?,
      telegramId: _asInt(user['telegramId']),
    );
  }

  /// `POST /api/auth/send-code` — отправить 6-значный код на email.
  /// Бэкенд rate-limit'ит: 1 раз в 60 секунд на email. Возвращает
  /// `true` если код отправлен, либо кидает [HundlerApiException]
  /// с человеко-читаемой ошибкой ('Подождите минуту…' / 'Некорректный
  /// email').
  Future<void> sendEmailCode(String email) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/auth/send-code',
      data: {'email': email.trim().toLowerCase()},
      options: Options(validateStatus: (s) => s != null && s < 600),
    );
    if (res.statusCode == 200 && res.data?['ok'] == true) return;
    // Бэк отдаёт {error: '...'} с локализованным сообщением — пробрасываем.
    final msg = res.data?['error'] as String? ??
        'Ошибка отправки кода (${res.statusCode})';
    throw HundlerApiException(msg, res.statusCode);
  }

  /// `POST /api/auth/verify-code` — проверить код, получить sessionToken.
  /// На success возвращает sessionToken; ошибки кидает как
  /// [HundlerApiException] с сообщением бэка.
  Future<String> verifyEmailCode({
    required String email,
    required String code,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/auth/verify-code',
      data: {
        'email': email.trim().toLowerCase(),
        'code': code.trim(),
      },
      options: Options(validateStatus: (s) => s != null && s < 600),
    );
    if (res.statusCode == 200 && res.data?['ok'] == true) {
      final token = res.data?['sessionToken'] as String?;
      if (token == null || token.isEmpty) {
        throw const HundlerApiException(
          'Сервер не вернул sessionToken',
          200,
        );
      }
      return token;
    }
    final msg = res.data?['error'] as String? ??
        'Не удалось подтвердить код (${res.statusCode})';
    throw HundlerApiException(msg, res.statusCode);
  }

  /// `GET /api/auth/account?userId=<id>` — детали привязок (telegram_id,
  /// email, google_id, referralCode, дата регистрации). Используется на
  /// ProfileScreen чтобы показать какие способы входа уже привязаны и
  /// дать кнопки «Привязать ещё».
  Future<HundlerAccount?> fetchAccount({required int userId}) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/api/auth/account',
      queryParameters: {'userId': userId},
      options: Options(validateStatus: (s) => s != null && s < 500),
    );
    if (res.statusCode != 200 || res.data?['ok'] != true) return null;
    final a = (res.data?['account'] as Map?)?.cast<String, dynamic>();
    if (a == null) return null;
    return HundlerAccount(
      userId: _asInt(a['id']) ?? userId,
      telegramId: _asInt(a['telegramId']),
      email: a['email'] as String?,
      emailVerified: a['emailVerified'] == true,
      googleId: a['googleId'] as String?,
      username: a['username'] as String?,
      firstName: a['firstName'] as String?,
      lastName: a['lastName'] as String?,
      photoUrl: a['photoUrl'] as String?,
      authType: a['authType'] as String?,
      referralCode: a['referralCode'] as String?,
      createdAt: a['createdAt'] != null
          ? DateTime.tryParse(a['createdAt'] as String)
          : null,
    );
  }

  /// `GET /api/users/state?userId=<id>` — daysLeft, subscription URL,
  /// статус подписки. **Главный** эндпоинт для главного экрана:
  /// именно отсюда мы знаем сколько дней осталось и есть ли URL для
  /// загрузки sing-box-конфига.
  Future<HundlerUserState?> fetchUserState({
    required int userId,
  }) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/api/users/state',
      queryParameters: {'userId': userId},
      options: Options(validateStatus: (s) => s != null && s < 500),
    );
    if (res.statusCode != 200 || res.data == null) {
      throw HundlerApiException(
        'User state failed (${res.statusCode})',
        res.statusCode,
      );
    }
    final raw = res.data!;
    if (raw['ok'] != true) return null;
    final p = (raw['profile'] as Map?)?.cast<String, dynamic>();
    if (p == null) return null;
    return HundlerUserState(
      userId: _asInt(p['userId']) ?? userId,
      telegramId: _asInt(p['telegramId']),
      status: p['status'] as String? ?? 'none',
      daysLeft: _asInt(p['daysLeft']) ?? 0,
      endDate: p['endDate'] != null ? DateTime.tryParse(p['endDate'] as String) : null,
      hasActiveKey: p['hasActiveKey'] as bool? ?? false,
      isBanned: p['isBanned'] as bool? ?? false,
      banReason: p['banReason'] as String?,
      subscriptionUrl: p['subscriptionUrl'] as String?,
      referralCode: p['referralCode'] as String?,
    );
  }
}

/// Безопасный парсер числа из JSON. PostgreSQL BIGINT в node-postgres
/// сериализуется в строку (чтобы не терять точность на >2^53), но Dart
/// `as num` падает с TypeError на строке. Этот helper покрывает:
///   - `null` → `null`
///   - `int` / `double` → `.toInt()`
///   - `String` → `int.tryParse(...)` (поддерживает и "123", и "1.5e3")
///   - всё остальное → `null` (а не throw, чтобы UI не падал)
int? _asInt(dynamic value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) {
    final asInt = int.tryParse(value);
    if (asInt != null) return asInt;
    final asDouble = double.tryParse(value);
    if (asDouble != null) return asDouble.toInt();
  }
  return null;
}

/// Активная сессия — то что приходит из `/api/auth/session`.
class HundlerSession {
  const HundlerSession({
    required this.token,
    required this.userId,
    this.email,
    this.name,
    this.telegramId,
  });

  /// `sessionToken` (UUID из таблицы `email_sessions`). Вместе с userId
  /// — основной идентификатор для последующих запросов state/devices.
  final String token;
  final int userId;
  final String? email;
  final String? name;
  final int? telegramId;

  String get displayName =>
      name?.trim().isNotEmpty == true
          ? name!
          : (email != null ? email!.split('@').first : 'Hundler User');
}

/// Профиль аккаунта — `/api/auth/account`. Показывает какие способы
/// входа уже привязаны (telegram_id, google_id, email), реферальный
/// код и дату регистрации. Используется на ProfileScreen.
class HundlerAccount {
  const HundlerAccount({
    required this.userId,
    this.telegramId,
    this.email,
    this.emailVerified = false,
    this.googleId,
    this.username,
    this.firstName,
    this.lastName,
    this.photoUrl,
    this.authType,
    this.referralCode,
    this.createdAt,
  });

  final int userId;
  final int? telegramId;
  final String? email;
  final bool emailVerified;
  final String? googleId;
  final String? username;
  final String? firstName;
  final String? lastName;
  final String? photoUrl;

  /// `'telegram'` | `'email'` | `'google'` — первичный способ регистрации.
  final String? authType;
  final String? referralCode;
  final DateTime? createdAt;

  bool get hasTelegram => telegramId != null;
  bool get hasGoogle => (googleId ?? '').isNotEmpty;
  bool get hasEmail => (email ?? '').isNotEmpty && emailVerified;

  String get displayName {
    final fn = firstName?.trim();
    if (fn != null && fn.isNotEmpty) {
      final ln = lastName?.trim();
      return (ln == null || ln.isEmpty) ? fn : '$fn $ln';
    }
    final u = username?.trim();
    if (u != null && u.isNotEmpty) return '@$u';
    final e = email?.trim();
    if (e != null && e.isNotEmpty) return e.split('@').first;
    return 'Hundler User';
  }
}

/// Состояние подписки + subscription URL — `/api/users/state`.
class HundlerUserState {
  const HundlerUserState({
    required this.userId,
    required this.status,
    required this.daysLeft,
    required this.hasActiveKey,
    required this.isBanned,
    this.telegramId,
    this.endDate,
    this.banReason,
    this.subscriptionUrl,
    this.referralCode,
  });

  final int userId;
  final int? telegramId;

  /// `'active'` | `'expired'` | `'canceled'` | `'none'`
  final String status;
  final int daysLeft;
  final DateTime? endDate;
  final bool hasActiveKey;
  final bool isBanned;
  final String? banReason;

  /// Полный URL к `/api/sub/{token}`. Может быть null если у юзера
  /// нет ни активной подписки, ни выданных ключей. В этом случае —
  /// триал не активирован, на UI показываем CTA «Активировать триал»
  /// или ссылку на оплату.
  final String? subscriptionUrl;

  final String? referralCode;

  bool get isActive => status == 'active' && daysLeft > 0;
  bool get canConnect => isActive && subscriptionUrl != null && !isBanned;

  /// Из `subscriptionUrl` достаём только token-часть, чтобы передать
  /// в `fetchSubscription(subToken)`. Формат URL:
  /// `https://hundlervpn.xyz/api/sub/<token>`.
  String? get subToken {
    final url = subscriptionUrl;
    if (url == null || url.isEmpty) return null;
    final marker = '/api/sub/';
    final idx = url.indexOf(marker);
    if (idx < 0) return null;
    return url.substring(idx + marker.length);
  }
}

/// Ответ `/api/sub/{token}`.
class SubscriptionResponse {
  const SubscriptionResponse({
    required this.configJson,
    required this.profileTitle,
    required this.profileUpdateIntervalHours,
    required this.userInfo,
  });

  /// sing-box JSON, передаётся в нативный core как есть.
  final String configJson;
  final String? profileTitle;
  final int profileUpdateIntervalHours;
  final SubscriptionUserInfo? userInfo;

  /// `true` если конфиг — это сигнал «лимит устройств / триал кончился»
  /// (мини-апп возвращает `outbounds: null` + remarks с эмодзи). Такой
  /// конфиг нельзя передавать в core — нужно показать UI с remark'ом.
  bool get isBlocked {
    final json = configJson.trim();
    if (json.isEmpty) return false;
    // Дешёвая проверка без полноценного парсинга — если в первых
    // 1000 символах встретится `"outbounds":null` или `"remarks":`,
    // считаем что это блок-ответ.
    final head = json.length > 1000 ? json.substring(0, 1000) : json;
    return head.contains('"outbounds":null') ||
        head.contains('"outbounds": null');
  }
}

/// `subscription-userinfo: upload=...; download=...; total=...; expire=<unix>`
class SubscriptionUserInfo {
  const SubscriptionUserInfo({
    this.upload,
    this.download,
    this.total,
    this.expireAt,
  });

  final int? upload;
  final int? download;
  final int? total;
  final DateTime? expireAt;

  static SubscriptionUserInfo? parse(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    final parts = raw.split(';');
    int? upload;
    int? download;
    int? total;
    int? expire;
    for (final part in parts) {
      final kv = part.trim().split('=');
      if (kv.length != 2) continue;
      final key = kv[0].trim();
      final value = int.tryParse(kv[1].trim());
      switch (key) {
        case 'upload':
          upload = value;
        case 'download':
          download = value;
        case 'total':
          total = value;
        case 'expire':
          expire = value;
      }
    }
    return SubscriptionUserInfo(
      upload: upload,
      download: download,
      total: total,
      expireAt: expire != null
          ? DateTime.fromMillisecondsSinceEpoch(expire * 1000, isUtc: true)
          : null,
    );
  }
}

class HundlerApiException implements Exception {
  const HundlerApiException(this.message, this.statusCode);
  final String message;
  final int? statusCode;

  @override
  String toString() => 'HundlerApiException($statusCode): $message';
}

/// Подкладывает `Authorization: Bearer <jwt>` если токен есть в storage.
class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this._storage);
  final FlutterSecureStorage _storage;

  static const _jwtKey = 'hundler_jwt';

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final jwt = await _storage.read(key: _jwtKey);
    if (jwt != null && jwt.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $jwt';
    }
    handler.next(options);
  }
}
