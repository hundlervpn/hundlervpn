import 'secure_storage.dart';

/// Обёртка над [SecureStorage] — нашим собственным DPAPI-storage
/// через win32 FFI. Все секреты лежат тут.
///
/// Почему не [FlutterSecureStorage]: его Windows-native плагин тянет
/// `atlstr.h` (МС-специфичная ATL/MFC библиотека), которого нет в
/// базовой установке Visual Studio Build Tools. Наша [SecureStorage]
/// использует тот же DPAPI напрямую через `CryptProtectData` —
/// тот же уровень security, но без C++ зависимостей.
///
/// Под капотом — DPAPI привязывает ключ к user-аккаунту Windows:
///
/// - Содержимое **нечитаемо** для других user-аккаунтов на той же машине.
/// - При пересоздании user-учётки Windows — данные невозможно расшифровать,
///   юзер просто перезайдёт в приложение.
/// - Нет master password / keychain prompt — DPAPI работает прозрачно.
///
/// **Не** хранить здесь sing-box JSON — он большой (~5-15 КБ). Для него —
/// отдельный файл в `getApplicationSupportDirectory()` через
/// `SubscriptionRepository` (без DPAPI — NTFS-permissions достаточно).
///
/// API совпадает с Android-версией (`hundlerandroid/lib/services/
/// storage_service.dart`) — провайдеры/репозитории не отличаются.
class StorageService {
  StorageService._();
  static final StorageService instance = StorageService._();

  static const _kSessionToken = 'session_token';
  static const _kSubToken = 'sub_token';
  static const _kUserId = 'user_id';
  static const _kUserEmail = 'user_email';
  static const _kUserName = 'user_name';
  static const _kSelectedServerId = 'selected_server_id';
  static const _kVpnMode = 'vpn_mode';
  static const _kVpnProtocol = 'vpn_protocol';

  static final _storage = SecureStorage.instance;

  /// Сессионный токен (UUID из таблицы `email_sessions`). Шлётся как
  /// `Authorization: Bearer <token>` на защищённые эндпоинты бэкенда
  /// (`/api/auth/session`, `/api/users/*`).
  Future<String?> getSessionToken() => _storage.read(key: _kSessionToken);
  Future<void> setSessionToken(String token) =>
      _storage.write(key: _kSessionToken, value: token);
  Future<void> clearSessionToken() => _storage.delete(key: _kSessionToken);

  /// `sub_token` — отдельный токен для подписки. Идёт в URL запроса
  /// `/api/sub/{token}` (НЕ JWT). Выдаётся бэкендом в составе
  /// `subscriptionUrl` от `/api/users/state`.
  Future<String?> getSubToken() => _storage.read(key: _kSubToken);
  Future<void> setSubToken(String token) =>
      _storage.write(key: _kSubToken, value: token);
  Future<void> clearSubToken() => _storage.delete(key: _kSubToken);

  /// Кеш базовой инфы о юзере — позволяет показать имя/email на главном
  /// экране без сетевого запроса при холодном старте (полезно при
  /// flaky-сети — приложение всё равно «знает» кто залогинен).
  Future<void> setUserInfo({
    required int id,
    String? email,
    String? name,
  }) async {
    await _storage.write(key: _kUserId, value: id.toString());
    if (email != null) await _storage.write(key: _kUserEmail, value: email);
    if (name != null) await _storage.write(key: _kUserName, value: name);
  }

  Future<({int? id, String? email, String? name})> getUserInfo() async {
    final idStr = await _storage.read(key: _kUserId);
    final email = await _storage.read(key: _kUserEmail);
    final name = await _storage.read(key: _kUserName);
    return (
      id: idStr != null ? int.tryParse(idStr) : null,
      email: email,
      name: name,
    );
  }

  /// ID последнего выбранного сервера. UI восстанавливает его при
  /// холодном старте, чтобы юзеру не приходилось каждый раз заново
  /// выбирать локацию.
  Future<int?> getSelectedServerId() async {
    final v = await _storage.read(key: _kSelectedServerId);
    return v != null ? int.tryParse(v) : null;
  }

  Future<void> setSelectedServerId(int id) =>
      _storage.write(key: _kSelectedServerId, value: id.toString());

  Future<void> clearSelectedServerId() =>
      _storage.delete(key: _kSelectedServerId);

  /// Режим работы VPN: `tun` (системный туннель, default) или `proxy`
  /// (только HTTP/SOCKS5 inbound на 127.0.0.1:7890, нужно вручную
  /// прописать в браузере / приложении). UI-переключатель на Home.
  Future<String?> getVpnMode() => _storage.read(key: _kVpnMode);
  Future<void> setVpnMode(String mode) =>
      _storage.write(key: _kVpnMode, value: mode);

  /// VPN-протокол: `vless` (default, Reality+XUDP) или `hysteria`
  /// (Hysteria2 UDP-based). Если бэкенд не вернул outbound выбранного
  /// типа — клиент покажет ошибку при подключении.
  Future<String?> getVpnProtocol() => _storage.read(key: _kVpnProtocol);
  Future<void> setVpnProtocol(String protocol) =>
      _storage.write(key: _kVpnProtocol, value: protocol);

  /// Полный logout — стираем токены, бэкенд-сессии не трогаем.
  Future<void> clearAll() async {
    await _storage.deleteAll();
  }
}
