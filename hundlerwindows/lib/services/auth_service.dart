import 'dart:async';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:url_launcher/url_launcher.dart';
import 'package:window_manager/window_manager.dart';

import '../core/api_client.dart';
import 'storage_service.dart';

void _log(String msg) {
  developer.log(msg, name: 'HundlerAuth');
  // ignore: avoid_print
  print('[HundlerAuth] $msg');
}

/// Высокоуровневый сервис авторизации Hundler VPN — Windows-версия.
///
/// На Windows desktop не работает ни `flutter_web_auth_2` (он собирается
/// только под Android/iOS), ни чистый deeplink `hundler://...` —
/// последний в Windows запускает второй процесс `hundler.exe`,
/// ломает `flutter run` device-connection и без named-mutex IPC не
/// форвардит аргумент живому инстансу.
///
/// Поэтому используем **loopback HTTP server**, как это делает
/// AppAuth / Google OAuth Desktop Best Practices (RFC 8252):
///
/// 1. Перед запуском OAuth поднимаем `HttpServer.bind('127.0.0.1', 0)`
///    — OS выдаёт свободный ephemeral port.
/// 2. Открываем в default-браузере `https://hundlervpn.xyz/api/auth/
///    {google,telegram}/start?nativeReturn=http%3A%2F%2F127.0.0.1%3APORT%2F
///    auth%2Fcallback` через `url_launcher`.
/// 3. Юзер логинится. Бэкенд завершает OAuth и возвращает HTML-баунс
///    на `http://127.0.0.1:PORT/auth/callback?token=...`.
/// 4. Наш HttpServer получает GET, выдаёт 200 OK + HTML "Можно
///    закрывать вкладку, возвращайтесь в приложение". Из запроса
///    читаем `?token=...`, закрываем сервер.
/// 5. Поднимаем сессию через `/api/auth/session`, возвращаем success.
///
/// Преимущества:
/// - Не требует single-instance lock — callback приходит в тот же
///   процесс через HTTP вместо запуска нового exe.
/// - Не требует от юзера подтверждать "Открыть Hundler VPN?"
///   в браузере (этот dialog Chrome показывает при первом hundler://).
/// - Работает на любом браузере без reg.exe и прав admin.
///
/// Безопасность: токен в URL приходит на 127.0.0.1 — никогда не
/// покидает машину. Backend валидирует входящий nativeReturn
/// через `isAllowedNativeReturn()` (см. `miniapp/lib/native-return.ts`)
/// — принимаются только 127.0.0.1:<1024..65535>, никаких
/// `localhost` / DNS-rebinding-friendly hosts.
///
/// Если запустить login и через 5 минут не получить запрос на
/// loopback-сервер — отдаём [AuthError] с timeout-сообщением.
class AuthService {
  AuthService({
    HundlerApi? api,
    StorageService? storage,
  })  : _api = api ?? HundlerApi(),
        _storage = storage ?? StorageService.instance;

  static final AuthService instance = AuthService();

  final HundlerApi _api;
  final StorageService _storage;

  /// Базовый URL (синхронизировано с `MINIAPP-AGENTS.md` → APP_URL).
  static const String _backendUrl = 'https://hundlervpn.xyz';

  /// Сколько ждать пользователя на странице Google (5 минут — достаточно
  /// для медленного flow с подтверждением 2FA).
  static const Duration _authTimeout = Duration(minutes: 5);

  HundlerApi get api => _api;

  /// Открывает Google OAuth в default-браузере и ждёт deeplink-callback.
  Future<AuthResult> loginWithGoogle() async {
    return _runWebAuth(
      startPath: '/api/auth/google/start',
      label: 'Google',
    );
  }

  /// Открывает Telegram-OIDC OAuth в default-браузере. Поведение
  /// идентично Google — бэкенд сам возвращает HTML-bounce на наш deeplink.
  Future<AuthResult> loginWithTelegram() async {
    return _runWebAuth(
      startPath: '/api/auth/telegram/start',
      label: 'Telegram',
    );
  }

  /// Шаг 1 email-флоу: бэк отправляет 6-значный код. Кидает
  /// [HundlerApiException] на rate-limit / неверный email.
  Future<void> sendEmailCode(String email) async {
    await _api.sendEmailCode(email);
  }

  /// Шаг 2 email-флоу: проверить код, получить sessionToken, поднять сессию.
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

  /// Универсальная реализация web-OAuth: поднять loopback-сервер,
  /// открыть браузер, ждать GET-запрос от бэкенд-bounce.
  Future<AuthResult> _runWebAuth({
    required String startPath,
    required String label,
  }) async {
    // 1. HTTP server на 127.0.0.1 с рандомным портом.
    HttpServer server;
    try {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    } catch (e) {
      return AuthResult.error('Не удалось поднять loopback-сервер: $e');
    }
    final port = server.port;
    final callbackUrl = 'http://127.0.0.1:$port/auth/callback';
    _log('login[$label]: loopback server on $callbackUrl');

    // 2. Ожидаем первый входящий GET — это и будет callback.
    final completer = Completer<Uri?>();
    final sub = server.listen(
      (req) async {
        if (req.uri.path != '/auth/callback') {
          // Браузеры иногда дополнительно дёргают /favicon.ico —
          // отвечаем 204 и не считаем каллбэком.
          req.response.statusCode = HttpStatus.noContent;
          await req.response.close();
          return;
        }
        // Ответ браузеру — красивая плашка "Можно закрывать".
        req.response
          ..statusCode = HttpStatus.ok
          ..headers.contentType = ContentType.html
          ..write(_callbackHtml(success: !req.uri.queryParameters.containsKey('error')));
        await req.response.close();
        if (!completer.isCompleted) completer.complete(req.uri);
      },
      onError: (Object e) {
        if (!completer.isCompleted) completer.completeError(e);
      },
    );

    // 3. Открываем default-браузер с OAuth-start.
    final encodedReturn = Uri.encodeComponent(callbackUrl);
    final startUrl = '$_backendUrl$startPath?nativeReturn=$encodedReturn';
    _log('login[$label]: opening browser → $startUrl');
    bool launched;
    try {
      launched = await launchUrl(
        Uri.parse(startUrl),
        mode: LaunchMode.externalApplication,
      );
    } catch (e) {
      _log('login[$label]: launchUrl threw: $e');
      await sub.cancel();
      await server.close(force: true);
      return AuthResult.error('Не удалось открыть браузер: $e');
    }
    if (!launched) {
      await sub.cancel();
      await server.close(force: true);
      return const AuthResult.error('Не удалось открыть браузер');
    }

    // 4. Ждём callback или timeout.
    Uri? callbackUri;
    try {
      callbackUri = await completer.future.timeout(_authTimeout);
    } on TimeoutException {
      _log('login[$label]: timed out after ${_authTimeout.inMinutes} min');
      await sub.cancel();
      await server.close(force: true);
      return AuthResult.error(
        'Время ожидания истекло (${_authTimeout.inMinutes} мин). '
        'Попробуйте ещё раз.',
      );
    } catch (e) {
      await sub.cancel();
      await server.close(force: true);
      return AuthResult.error('Ошибка loopback-сервера: $e');
    }
    await sub.cancel();
    await server.close(force: true);

    if (callbackUri == null) {
      _log('login[$label]: no callback received');
      return const AuthResult.cancelled();
    }

    // Вернуть окно приложения на передний план — юзер видел браузер
    // весь этот время, Hundler VPN ушёл в фон.
    try {
      await windowManager.show();
      await windowManager.focus();
    } catch (_) {}

    _log('login[$label]: got callback URI = $callbackUri');

    final err = callbackUri.queryParameters['error'];
    if (err != null && err.isNotEmpty) {
      return AuthResult.error('$label: $err');
    }
    final token = callbackUri.queryParameters['token'];
    if (token == null || token.isEmpty) {
      return const AuthResult.error('Backend не вернул token в callback');
    }
    return _completeLogin(token);
  }

  /// HTML-ответ браузеру после успешного логина. Показывает
  /// тигра + "Готово, вернитесь в приложение". После 2 сек вкладка сама
  /// пытается себя закрыть через `window.close()` (работает только если
  /// вкладку открыл JS — в нашем случае это бэкенд через location.replace,
  /// этого не хватает браузеру — он вежливо оставит вкладку открытой).
  String _callbackHtml({required bool success}) {
    final title = success ? 'Готово!' : 'Ошибка входа';
    final accent = success ? '#22c55e' : '#ef4444';
    final emoji = success ? '✓' : '✕';
    return '''<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hundler VPN</title>
<style>
  html,body{margin:0;padding:0;background:#020202;color:#fff;
    font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center;}
  .box{text-align:center;padding:24px;max-width:360px;}
  .check{display:inline-flex;width:64px;height:64px;border-radius:50%;
    align-items:center;justify-content:center;
    background:$accent;color:#020202;font-size:32px;font-weight:700;
    margin-bottom:16px;}
  h1{font-size:20px;font-weight:700;margin:0 0 8px;letter-spacing:0.5px;}
  p{font-size:14px;color:#a3a3a3;margin:8px 0;line-height:1.5;}
</style>
</head><body>
<div class="box">
  <div class="check">$emoji</div>
  <h1>$title</h1>
  <p>Можно закрывать вкладку и вернуться в Hundler VPN.</p>
</div>
<script>setTimeout(function(){try{window.close();}catch(e){}}, 1500);</script>
</body></html>''';
  }

  /// Совместная финализация для всех способов логина.
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
      state = null;
    }

    // Сохраняем sub_token только если есть subscriptionUrl.
    final subToken = state?.subToken;
    if (subToken != null && subToken.isNotEmpty) {
      await _storage.setSubToken(subToken);
    }

    return AuthResult.success(session: session, state: state);
  }

  /// Восстановление сессии при холодном старте.
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
      // Сетевая ошибка — НЕ стираем токен, юзер может быть оффлайн.
      // Доверяем закешированной инфе для прелогина.
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

  /// No-op на Windows — оставляем метод для совместимости API с Android.
  /// Никто больше не вызывает это после перехода на loopback-флоу, но
  /// мы оставляем stub на случай если вернёмся к deeplink-флоу в
  /// будущем (например для Telegram desktop login).
  void receiveProtocolUrl(String url) {
    _log('receiveProtocolUrl: $url (deeplink-флоу отключен, игнорируем)');
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
