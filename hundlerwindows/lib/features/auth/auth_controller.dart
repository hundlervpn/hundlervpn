import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../services/auth_service.dart';

/// Singleton-провайдер сервиса. Всегда отдаёт `AuthService.instance`.
final authServiceProvider =
    Provider<AuthService>((ref) => AuthService.instance);

/// Состояние авторизации. Корневой router (см. `app.dart`) слушает его и
/// переключается между Splash / Login / Home.
sealed class AuthState {
  const AuthState();
}

/// Идёт восстановление сессии при холодном старте → UI показывает splash.
class AuthBootstrapping extends AuthState {
  const AuthBootstrapping();
}

/// Юзер не залогинен → UI показывает [LoginScreen].
class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.reason});
  final String? reason;
}

/// Юзер залогинен → UI показывает [HomeScreen].
class AuthSignedIn extends AuthState {
  const AuthSignedIn({required this.session, this.state});
  final HundlerSession session;
  final HundlerUserState? state;

  AuthSignedIn copyWith({HundlerUserState? state}) =>
      AuthSignedIn(session: session, state: state ?? this.state);
}

/// Контроллер авторизации. Один на всё приложение.
///
/// Структура — копия из `hundlerandroid/lib/features/auth/auth_controller.dart`.
/// Отличие — нет вызова `subscriptionRepositoryProvider.clear()` в
/// signOut(), потому что Subscription-репозиторий ещё не реализован
/// (TODO следующий этап).
class AuthController extends Notifier<AuthState> {
  late final AuthService _service;

  @override
  AuthState build() {
    _service = ref.read(authServiceProvider);
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

  Future<AuthResult> signInWithGoogle() async {
    final result = await _service.loginWithGoogle();
    _applyResult(result);
    return result;
  }

  Future<AuthResult> signInWithTelegram() async {
    final result = await _service.loginWithTelegram();
    _applyResult(result);
    return result;
  }

  Future<void> sendEmailCode(String email) async {
    await _service.sendEmailCode(email);
  }

  Future<AuthResult> verifyEmailCode({
    required String email,
    required String code,
  }) async {
    final result = await _service.verifyEmailCode(email: email, code: code);
    _applyResult(result);
    return result;
  }

  void _applyResult(AuthResult result) {
    switch (result) {
      case AuthSuccess(:final session, state: final userState):
        state = AuthSignedIn(session: session, state: userState);
      case AuthCancelled():
        // Состояние не трогаем — юзер просто закрыл браузер.
        break;
      case AuthError(:final message):
        state = AuthSignedOut(reason: message);
    }
  }

  /// Принудительный refresh `/api/users/state` (после оплаты, активации
  /// триала, изменения подписки).
  Future<void> refreshUserState() async {
    final s = state;
    if (s is! AuthSignedIn) return;
    try {
      final newState =
          await _service.api.fetchUserState(userId: s.session.userId);
      state = AuthSignedIn(session: s.session, state: newState);
    } catch (_) {
      // ignore — оставляем что было
    }
  }

  Future<void> signOut() async {
    await _service.logout();
    state = const AuthSignedOut();
  }
}

final authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);
