import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../services/auth_service.dart';
import '../subscription/subscription_controller.dart';

/// Singleton-провайдер сервиса. Всегда отдаёт `AuthService.instance`.
final authServiceProvider = Provider<AuthService>((ref) => AuthService.instance);

/// Состояние авторизации, которое слушает корневой router.
sealed class AuthState {
  const AuthState();
}

/// Идёт восстановление сессии при холодном старте.
class AuthBootstrapping extends AuthState {
  const AuthBootstrapping();
}

/// Юзер не залогинен — показываем LoginScreen.
class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.reason});
  final String? reason;
}

/// Юзер залогинен.
class AuthSignedIn extends AuthState {
  const AuthSignedIn({required this.session, this.state});
  final HundlerSession session;
  final HundlerUserState? state;
}

/// Контроллер авторизации. Один на всё приложение, переживает hot
/// reload благодаря `Notifier` внутри Riverpod scope.
class AuthController extends Notifier<AuthState> {
  late final AuthService _service;

  @override
  AuthState build() {
    _service = ref.read(authServiceProvider);
    // Запускаем bootstrap асинхронно. До завершения — возвращаем
    // состояние «загрузка», UI покажет splash.
    _bootstrap();
    return const AuthBootstrapping();
  }

  Future<void> _bootstrap() async {
    final session = await _service.bootstrap();
    if (session == null) {
      state = const AuthSignedOut();
      return;
    }
    HundlerUserState? userState;
    try {
      userState = await _service.api.fetchUserState(userId: session.userId);
    } catch (_) {
      userState = null;
    }
    state = AuthSignedIn(session: session, state: userState);
  }

  /// Запустить Google OAuth flow. Возвращает [AuthResult] чтобы UI
  /// мог показать конкретное сообщение (отмена / ошибка / успех).
  Future<AuthResult> signInWithGoogle() async {
    final result = await _service.loginWithGoogle();
    _applyResult(result);
    return result;
  }

  /// Запустить Telegram OIDC flow в Custom Tab. См. [AuthService].
  Future<AuthResult> signInWithTelegram() async {
    final result = await _service.loginWithTelegram();
    _applyResult(result);
    return result;
  }

  /// Шаг 1 email-флоу: отправить код. Пробрасывает [HundlerApiException]
  /// чтобы UI мог показать конкретное сообщение (rate-limit / некорректный
  /// email). На успех — никаких state-изменений, ждём ввод кода.
  Future<void> sendEmailCode(String email) async {
    await _service.sendEmailCode(email);
  }

  /// Шаг 2 email-флоу: верифицировать код, поднять сессию.
  Future<AuthResult> verifyEmailCode({
    required String email,
    required String code,
  }) async {
    final result = await _service.verifyEmailCode(email: email, code: code);
    _applyResult(result);
    return result;
  }

  /// Общий редьюсер AuthResult → AuthState для всех login-флоу.
  void _applyResult(AuthResult result) {
    switch (result) {
      case AuthSuccess(:final session, state: final userState):
        state = AuthSignedIn(session: session, state: userState);
      case AuthCancelled():
        // Состояние не трогаем — юзер просто закрыл Custom Tab.
        break;
      case AuthError(:final message):
        state = AuthSignedOut(reason: message);
    }
  }

  /// Принудительно перетянуть `/api/users/state` — после оплаты,
  /// после изменения подписки и т.п.
  Future<void> refreshUserState() async {
    final s = state;
    if (s is! AuthSignedIn) return;
    try {
      final newState = await _service.api.fetchUserState(userId: s.session.userId);
      state = AuthSignedIn(session: s.session, state: newState);
    } catch (_) {
      // ignore — оставляем что было
    }
  }

  Future<void> signOut() async {
    // Очищаем закешированный sing-box JSON и останавливаем поллер
    // подписки — иначе следующий логин подтянет старые UUID.
    try {
      await ref.read(subscriptionRepositoryProvider).clear();
    } catch (_) {
      /* не критично */
    }
    await _service.logout();
    state = const AuthSignedOut();
  }
}

final authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);
