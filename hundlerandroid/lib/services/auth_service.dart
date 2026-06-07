import 'dart:developer' as developer;

import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

import '../core/api_client.dart';
import 'storage_service.dart';

/// Логгер для AuthService — пишет под тегом "HundlerAuth", легко
/// фильтровать через `adb logcat *:S flutter:V`.
void _log(String msg) {
  developer.log(msg, name: 'HundlerAuth');
  // ignore: avoid_print
  print('[HundlerAuth] $msg');
}

/// Высокоуровневый сервис авторизации Hundler VPN.
///
/// Покрывает три флоу:
///
/// 1. **Google OAuth** через Custom Tabs.
///    - Открывает `https://hundlervpn.xyz/api/auth/google/start?nativeReturn=hundler://auth/callback`
///      в Chrome Custom Tab.
///    - `flutter_web_auth_2` ждёт redirect на `hundler://auth/callback?token=...`,
///      перехватывает (через `CallbackActivity` в AndroidManifest.xml) и
///      возвращает URL Dart-стороне.
///    - Достаём `token` query-param, сохраняем в [StorageService] как
///      session token, проверяем через [HundlerApi.fetchSession] и
///      [HundlerApi.fetchUserState].
///
/// 2. **Холодный старт**: `bootstrap()` пытается оживить сохранённую
///    сессию. Если токен валиден — отдаёт [HundlerSession]; если нет —
///    стирает всё и возвращает `null` (UI показывает [LoginScreen]).
///
/// 3. **Logout**: `logout()` — стираем session token + sub_token из
///    secure storage. Бэкенд-сессии остаются валидными в БД (мини-апп
///    их сам пожалеет когда `expires_at` пройдёт), но клиент о них
///    больше не знает.
///
/// Email-код и Telegram Login — будут добавлены отдельными методами
/// (`loginWithEmailCode`, `loginWithTelegram`) когда дойдём до них.
class AuthService {
  AuthService({
    HundlerApi? api,
    StorageService? storage,
  })  : _api = api ?? HundlerApi(),
        _storage = storage ?? StorageService.instance;

  static final AuthService instance = AuthService();

  final HundlerApi _api;
  final StorageService _storage;

  /// Базовый URL для OAuth-флоу. Должен совпадать с APP_URL в Hostman.
  static const String _backendUrl = 'https://hundlervpn.xyz';

  /// Куда бэкенд редиректит после успешного OAuth. Должно совпадать
  /// с тем что объявлено в `AndroidManifest.xml` под
  /// `com.linusu.flutter_web_auth_2.CallbackActivity`.
  static const String _callbackScheme = 'hundler';
  static const String _callbackUrl = 'hundler://auth/callback';

  HundlerApi get api => _api;

  /// Открывает Google OAuth flow в Custom Tab.
  ///
  /// Возвращает [AuthResult.success] с [HundlerSession] если логин
  /// прошёл и backend выдал валидный sessionToken. На отмене юзером
  /// (закрыл вкладку) кидает [PlatformException] — оборачиваем в
  /// [AuthResult.cancelled]. На любых других ошибках —
  /// [AuthResult.error] с сообщением.
  Future<AuthResult> loginWithGoogle() async {
    final encodedReturn = Uri.encodeComponent(_callbackUrl);
    final startUrl =
        '$_backendUrl/api/auth/google/start?nativeReturn=$encodedReturn';

    _log('loginWithGoogle: start URL = $startUrl');
    _log('loginWithGoogle: callbackUrlScheme = $_callbackScheme');

    String resultUrl;
    try {
      resultUrl = await FlutterWebAuth2.authenticate(
        url: startUrl,
        callbackUrlScheme: _callbackScheme,
        options: const FlutterWebAuth2Options(
          // Эфемерная сессия — Custom Tab НЕ будет шарить cookies с
          // обычным Chrome. Это значит юзеру каждый раз придётся
          // вводить Google-пароль; альтернатива (preferEphemeral=false)
          // подтягивает залогиненный Google-аккаунт автоматически —
          // обычно это лучше для UX, но в дебаге проще когда сессии
          // изолированы.
          preferEphemeral: false,
          // Прежде чем считать что юзер отменил — ждём 5 минут реального
          // времени. Достаточно для медленного flow с подтверждением.
          timeout: 300,
        ),
      );
      _log('loginWithGoogle: authenticate() returned URL = $resultUrl');
    } catch (e, st) {
      _log('loginWithGoogle: authenticate() threw: $e');
      _log('loginWithGoogle: stacktrace: $st');
      // CanceledLogin / network error / etc.
      final msg = e.toString();
      if (msg.contains('CANCELED') || msg.contains('canceled')) {
        return const AuthResult.cancelled();
      }
      return AuthResult.error('OAuth-ошибка: $msg');
    }

    final uri = Uri.tryParse(resultUrl);
    if (uri == null) {
      _log('loginWithGoogle: failed to parse callback URL: $resultUrl');
      return AuthResult.error('Не удалось распарсить $resultUrl');
    }
    _log('loginWithGoogle: parsed URI scheme=${uri.scheme} '
        'host=${uri.host} path=${uri.path} '
        'queryKeys=${uri.queryParameters.keys.toList()}');
    final token = uri.queryParameters['token'];
    if (token == null || token.isEmpty) {
      _log('loginWithGoogle: callback URL has no token param');
      return const AuthResult.error('Backend не вернул token в callback');
    }

    _log('loginWithGoogle: got session token, finalizing login...');
    return _completeLogin(token);
  }

  /// Запустить Telegram OAuth (OIDC) flow в Custom Tab.
  ///
  /// Открывает `https://hundlervpn.xyz/api/auth/telegram/start?nativeReturn=
  /// hundler://auth/callback`. Бэкенд редиректит на oauth.telegram.org,
  /// после успеха возвращает HTML-bounce-страницу которая через JS
  /// делает `window.location.replace('hundler://auth/callback?token=...')`.
  /// Этот deep-link перехватывается `CallbackActivity` (Android Manifest)
  /// и возвращается сюда через `flutter_web_auth_2`.
  ///
  /// Важно: server-side 302 на custom:// scheme Chrome Custom Tab НЕ
  /// уважает (наблюдается на MIUI / Chrome 148+). Поэтому HTML-bounce —
  /// единственный надёжный путь. Та же логика у Google.
  Future<AuthResult> loginWithTelegram() async {
    final encodedReturn = Uri.encodeComponent(_callbackUrl);
    final startUrl =
        '$_backendUrl/api/auth/telegram/start?nativeReturn=$encodedReturn';

    _log('loginWithTelegram: start URL = $startUrl');

    String resultUrl;
    try {
      resultUrl = await FlutterWebAuth2.authenticate(
        url: startUrl,
        callbackUrlScheme: _callbackScheme,
        options: const FlutterWebAuth2Options(
          // У Telegram OIDC окно подтверждения часто хочет cookies из
          // основного браузера (юзер залогинен в Telegram Web). Если
          // ephemeral=true — каждый раз пришлось бы вводить телефон+код.
          preferEphemeral: false,
          timeout: 300,
        ),
      );
      _log('loginWithTelegram: authenticate() returned URL = $resultUrl');
    } catch (e) {
      _log('loginWithTelegram: authenticate() threw: $e');
      final msg = e.toString();
      if (msg.contains('CANCELED') || msg.contains('canceled')) {
        return const AuthResult.cancelled();
      }
      return AuthResult.error('Telegram-OAuth ошибка: $msg');
    }

    final uri = Uri.tryParse(resultUrl);
    if (uri == null) {
      return AuthResult.error('Не удалось распарсить $resultUrl');
    }
    // Бэк может вернуть `?error=<msg>` если на стороне Telegram юзер
    // отменил, либо JWT не прошёл валидацию.
    final err = uri.queryParameters['error'];
    if (err != null && err.isNotEmpty) {
      _log('loginWithTelegram: backend returned error: $err');
      return AuthResult.error('Telegram: $err');
    }
    final token = uri.queryParameters['token'];
    if (token == null || token.isEmpty) {
      _log('loginWithTelegram: callback URL has no token param');
      return const AuthResult.error('Backend не вернул token в callback');
    }
    return _completeLogin(token);
  }

  /// Шаг 1 email-флоу: попросить бэк отправить 6-значный код на почту.
  /// Кидает [HundlerApiException] с локализованным сообщением (rate
  /// limit / некорректный email).
  Future<void> sendEmailCode(String email) async {
    await _api.sendEmailCode(email);
  }

  /// Шаг 2 email-флоу: верифицировать код, получить sessionToken и
  /// финализировать login. Возвращает [AuthResult] — UI разводит UX.
  Future<AuthResult> verifyEmailCode({
    required String email,
    required String code,
  }) async {
    String sessionToken;
    try {
      sessionToken = await _api.verifyEmailCode(email: email, code: code);
    } on HundlerApiException catch (e) {
      return AuthResult.error(e.message);
    } catch (e) {
      return AuthResult.error('Не удалось войти: $e');
    }
    return _completeLogin(sessionToken);
  }

  /// Совместная финализация для всех способов логина.
  /// Сохраняет токен, проверяет сессию, тянет user state.
  Future<AuthResult> _completeLogin(String sessionToken) async {
    await _storage.setSessionToken(sessionToken);

    HundlerSession? session;
    try {
      session = await _api.fetchSession(sessionToken);
    } catch (e) {
      await _storage.clearSessionToken();
      return AuthResult.error('Сессия не валидна: $e');
    }
    if (session == null) {
      await _storage.clearSessionToken();
      return const AuthResult.error('Backend не нашёл сессию по токену');
    }

    await _storage.setUserInfo(
      id: session.userId,
      email: session.email,
      name: session.name,
    );

    HundlerUserState? state;
    try {
      state = await _api.fetchUserState(userId: session.userId);
    } catch (_) {
      // /users/state может временно лагать — это не критично, токен
      // уже сохранён и юзер залогинен. UI попробует ещё раз позже.
      state = null;
    }

    if (state?.subscriptionUrl != null) {
      await _storage.setSubToken(state!.subscriptionUrl!);
    }

    return AuthResult.success(session: session, state: state);
  }

  /// Восстановление сессии при холодном старте. Возвращает текущую
  /// сессию или `null`. Если сохранённый токен оказался невалиден
  /// (бэкенд вернул 401) — стираем его и возвращаем `null`, чтобы
  /// UI показал [LoginScreen].
  Future<HundlerSession?> bootstrap() async {
    final saved = await _storage.getSessionToken();
    if (saved == null || saved.isEmpty) return null;
    try {
      final session = await _api.fetchSession(saved);
      if (session == null) {
        await _storage.clearSessionToken();
        return null;
      }
      return session;
    } catch (_) {
      // Сетевая ошибка — НЕ стираем, юзер может быть оффлайн.
      // Доверяем сохранённой инфе.
      final cached = await _storage.getUserInfo();
      if (cached.id == null) return null;
      return HundlerSession(
        token: saved,
        userId: cached.id!,
        email: cached.email,
        name: cached.name,
      );
    }
  }

  /// Полный logout — стираем токены, бэкенд-сессии не трогаем.
  Future<void> logout() async {
    await _storage.clearAll();
  }
}

/// Результат попытки логина.
sealed class AuthResult {
  const AuthResult();

  const factory AuthResult.success({
    required HundlerSession session,
    HundlerUserState? state,
  }) = AuthSuccess;

  const factory AuthResult.cancelled() = AuthCancelled;
  const factory AuthResult.error(String message) = AuthError;
}

class AuthSuccess extends AuthResult {
  const AuthSuccess({required this.session, this.state});
  final HundlerSession session;
  final HundlerUserState? state;
}

class AuthCancelled extends AuthResult {
  const AuthCancelled();
}

class AuthError extends AuthResult {
  const AuthError(this.message);
  final String message;
}
