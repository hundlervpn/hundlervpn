import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Обёртка над [FlutterSecureStorage] — все секреты лежат тут.
///
/// На Android под капотом — `EncryptedSharedPreferences` (AES-256
/// с ключом из Android Keystore). Это значит что:
///
/// - Содержимое **нечитаемо** даже если root-приложение склонирует
///   `/data/data/com.hundlervpn.hundler/`.
/// - Ключи привязаны к девайсу — бэкап через `adb backup` бесполезен,
///   на новом телефоне расшифровка не пройдёт.
/// - Чтение/запись синхронные при наличии ключа; первый доступ
///   медленный (~50ms — генерация ключа в Keystore).
///
/// **Не** хранить здесь sing-box JSON-конфиг целиком — он большой,
/// и EncryptedSharedPreferences тормозит на больших значениях.
/// Для него — отдельный файл в `getApplicationSupportDirectory()`
/// (TODO в `SubscriptionRepository`).
class StorageService {
  StorageService._();
  static final StorageService instance = StorageService._();

  static const _kSessionToken = 'session_token';
  static const _kSubToken = 'sub_token';
  static const _kUserId = 'user_id';
  static const _kUserEmail = 'user_email';
  static const _kUserName = 'user_name';
  static const _kSelectedServerId = 'selected_server_id';

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  /// JWT/UUID сессии (выдаётся `/api/auth/google` и подобными).
  /// Шлётся как `Authorization: Bearer <token>` на защищённые
  /// эндпоинты бэкенда (`/api/auth/session`, `/api/users/*`).
  Future<String?> getSessionToken() => _storage.read(key: _kSessionToken);
  Future<void> setSessionToken(String token) =>
      _storage.write(key: _kSessionToken, value: token);
  Future<void> clearSessionToken() => _storage.delete(key: _kSessionToken);

  /// `sub_token` — отдельный токен для подписки. Идёт в URL
  /// запроса `/api/sub/{token}` — НЕ JWT. Выдаётся бэкендом
  /// при первом запросе `/api/auth/session` (или явным вызовом
  /// `/api/users/sub-token`). Срок жизни — до явного отзыва.
  Future<String?> getSubToken() => _storage.read(key: _kSubToken);
  Future<void> setSubToken(String token) =>
      _storage.write(key: _kSubToken, value: token);
  Future<void> clearSubToken() => _storage.delete(key: _kSubToken);

  /// Кеш базовой инфы о юзере. Не критично — но позволяет показать
  /// имя/email на главном экране без сетевого запроса при холодном
  /// старте.
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
  /// выбирать локацию. Сам сервер при следующем коннекте подтягивается
  /// из свежего `/api/servers` (вдруг хост / порт изменились).
  Future<int?> getSelectedServerId() async {
    final v = await _storage.read(key: _kSelectedServerId);
    return v != null ? int.tryParse(v) : null;
  }

  Future<void> setSelectedServerId(int id) =>
      _storage.write(key: _kSelectedServerId, value: id.toString());

  Future<void> clearSelectedServerId() =>
      _storage.delete(key: _kSelectedServerId);

  /// Полный logout: всё стираем.
  Future<void> clearAll() async {
    await _storage.deleteAll();
  }
}
