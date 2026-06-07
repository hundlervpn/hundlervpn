import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:window_manager/window_manager.dart';

import '../../core/api_client.dart';
import '../../core/colors.dart';
import '../../core/typography.dart';
import '../../services/auth_service.dart';
import '../home/widgets/tiger_logo.dart';
import 'auth_controller.dart';

/// LoginScreen — Windows-версия.
///
/// На Windows нет нативного Google Sign-In SDK как на Android, и нет
/// Telegram Mini App context — поэтому оба способа (Google / Telegram)
/// идут через `AuthService._runWebAuth` → системный браузер →
/// `hundler://` deep-link.
///
/// Экран простой: тигр сверху, две кнопки логина, переключатель на
/// email-форму внизу. Никаких длинных описаний — это VPN-клиент,
/// маркетинг живёт в мини-аппе.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _googleLoading = false;
  bool _emailMode = false;
  bool _telegramLoading = false;
  String? _lastError;

  @override
  void initState() {
    super.initState();
    // Если bootstrap завершился с reason — показать его на экране
    // (например "Сессия не валидна: ..."). Слушаем authState и
    // подкладываем reason в _lastError при первом маунте.
    Future.microtask(() {
      final s = ref.read(authControllerProvider);
      if (s is AuthSignedOut && s.reason != null && s.reason!.isNotEmpty) {
        if (mounted) setState(() => _lastError = s.reason);
      }
    });
  }

  Future<void> _signInWithGoogle() async {
    setState(() {
      _googleLoading = true;
      _lastError = null;
    });
    try {
      final result =
          await ref.read(authControllerProvider.notifier).signInWithGoogle();
      _handleResult(result, label: 'Google');
    } finally {
      if (mounted) setState(() => _googleLoading = false);
    }
  }

  Future<void> _signInWithTelegram() async {
    setState(() {
      _telegramLoading = true;
      _lastError = null;
    });
    try {
      final result =
          await ref.read(authControllerProvider.notifier).signInWithTelegram();
      _handleResult(result, label: 'Telegram');
    } finally {
      if (mounted) setState(() => _telegramLoading = false);
    }
  }

  void _handleResult(AuthResult result, {required String label}) {
    if (!mounted) return;
    switch (result) {
      case AuthSuccess():
        // AuthState уже AuthSignedIn — корневой роутер перерисует
        // дерево, эту страницу размонтируют автоматически. Делать
        // ничего не нужно.
        break;
      case AuthCancelled():
        setState(() => _lastError = 'Вход через $label отменён');
      case AuthError(:final message):
        setState(() => _lastError = message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: HundlerColors.bgPrimary,
      body: SafeArea(
        child: Column(
          children: [
            // Минимальный title-bar: drag-area + кнопка закрыть.
            // Без неё пользователь не сможет закрыть окно на этапе
            // логина (frameless окно без window controls).
            DragToMoveArea(
              child: SizedBox(
                height: 36,
                child: Row(
                  children: [
                    const Expanded(child: SizedBox.expand()),
                    MouseRegion(
                      cursor: SystemMouseCursors.click,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => windowManager.close(),
                        child: Container(
                          width: 36,
                          height: 36,
                          alignment: Alignment.center,
                          child: const Icon(
                            LucideIcons.x,
                            size: 14,
                            color: HundlerColors.textSecondary,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 400),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: HundlerSpacing.xl,
                      vertical: HundlerSpacing.lg,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                  const Center(child: TigerLogo(size: 140)),
                  const SizedBox(height: HundlerSpacing.xl),
                  Center(
                    child: Text(
                      'HUNDLER VPN',
                      style: HundlerTypography.brandTitle(size: 22),
                    ),
                  ),
                  const SizedBox(height: HundlerSpacing.xxl),

                  if (_lastError != null) ...[
                    _ErrorBanner(message: _lastError!),
                    const SizedBox(height: HundlerSpacing.md),
                  ],

                  if (!_emailMode) ...[
                    _GoogleButton(
                      loading: _googleLoading,
                      onPressed:
                          _googleLoading ? null : _signInWithGoogle,
                    ),
                    const SizedBox(height: HundlerSpacing.sm),
                    _TelegramButton(
                      loading: _telegramLoading,
                      onPressed:
                          _telegramLoading ? null : _signInWithTelegram,
                    ),
                    const SizedBox(height: HundlerSpacing.lg),
                    Row(
                      children: const [
                        Expanded(child: Divider()),
                        Padding(
                          padding: EdgeInsets.symmetric(
                              horizontal: HundlerSpacing.sm),
                          child: Text(
                            'или',
                            style: TextStyle(
                              color: HundlerColors.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ),
                        Expanded(child: Divider()),
                      ],
                    ),
                    const SizedBox(height: HundlerSpacing.lg),
                    OutlinedButton.icon(
                      icon: const Icon(LucideIcons.mail, size: 18),
                      label: const Text('Войти по email'),
                      onPressed: () =>
                          setState(() => _emailMode = true),
                    ),
                  ] else
                    _EmailLoginForm(
                      onCancel: () =>
                          setState(() => _emailMode = false),
                      onError: (msg) =>
                          setState(() => _lastError = msg),
                    ),

                  const SizedBox(height: HundlerSpacing.xl),
                  Center(
                    child: Text(
                      'Регистрируясь, вы соглашаетесь с условиями\n'
                      'использования сервиса.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: HundlerColors.textSecondary,
                            height: 1.4,
                          ),
                    ),
                  ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GoogleButton extends StatelessWidget {
  const _GoogleButton({required this.loading, required this.onPressed});
  final bool loading;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.white,
          foregroundColor: const Color(0xFF1F1F1F),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(HundlerRadius.sm),
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (loading)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: HundlerColors.accentRed,
                ),
              )
            else
              const _GoogleGlyph(),
            const SizedBox(width: HundlerSpacing.sm),
            Text(
              loading ? 'Открываем браузер…' : 'Войти через Google',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 15,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TelegramButton extends StatelessWidget {
  const _TelegramButton({required this.loading, required this.onPressed});
  final bool loading;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: ElevatedButton.icon(
        onPressed: onPressed,
        icon: loading
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : const Icon(LucideIcons.send, size: 18),
        label: Text(loading ? 'Открываем браузер…' : 'Войти через Telegram'),
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF229ED9), // Telegram blue
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(HundlerRadius.sm),
          ),
        ),
      ),
    );
  }
}

/// Маленький Google-G рендерим SVG-чем-то простым через CustomPaint —
/// чтобы не тянуть ассет. Это упрощённый "G" с цветными секторами.
class _GoogleGlyph extends StatelessWidget {
  const _GoogleGlyph();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 20,
      height: 20,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: SweepGradient(
          colors: [
            Color(0xFF4285F4), // blue
            Color(0xFF34A853), // green
            Color(0xFFFBBC05), // yellow
            Color(0xFFEA4335), // red
            Color(0xFF4285F4),
          ],
          stops: [0, 0.25, 0.5, 0.75, 1],
        ),
      ),
      child: const Center(
        child: Text(
          'G',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
            fontSize: 12,
            height: 1.0,
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(HundlerSpacing.md),
      decoration: BoxDecoration(
        color: const Color(0x33EF4444), // 20% red
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
        border: Border.all(color: HundlerColors.accentRed.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            LucideIcons.triangleAlert,
            size: 18,
            color: HundlerColors.accentRed,
          ),
          const SizedBox(width: HundlerSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: HundlerColors.textPrimary,
                fontSize: 13,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Email-форма: 2 шага — email → 6-значный код.
class _EmailLoginForm extends ConsumerStatefulWidget {
  const _EmailLoginForm({required this.onCancel, required this.onError});
  final VoidCallback onCancel;
  final ValueChanged<String> onError;

  @override
  ConsumerState<_EmailLoginForm> createState() => _EmailLoginFormState();
}

class _EmailLoginFormState extends ConsumerState<_EmailLoginForm> {
  final _emailCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final email = _emailCtrl.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      widget.onError('Введите корректный email');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(authControllerProvider.notifier)
          .sendEmailCode(email);
      if (mounted) setState(() => _codeSent = true);
    } on HundlerApiException catch (e) {
      widget.onError(e.message);
    } catch (e) {
      widget.onError('Не удалось отправить код: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyCode() async {
    final email = _emailCtrl.text.trim();
    final code = _codeCtrl.text.trim();
    if (code.length != 6) {
      widget.onError('Код должен быть из 6 цифр');
      return;
    }
    setState(() => _busy = true);
    try {
      final result = await ref
          .read(authControllerProvider.notifier)
          .verifyEmailCode(email: email, code: code);
      if (!mounted) return;
      switch (result) {
        case AuthSuccess():
          // Auth gate переключит экран сам.
          break;
        case AuthError(:final message):
          widget.onError(message);
        case AuthCancelled():
          widget.onError('Отменено');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _emailCtrl,
          enabled: !_codeSent && !_busy,
          decoration: const InputDecoration(
            labelText: 'Email',
            hintText: 'you@example.com',
            border: OutlineInputBorder(),
          ),
          keyboardType: TextInputType.emailAddress,
        ),
        const SizedBox(height: HundlerSpacing.sm),
        if (_codeSent) ...[
          TextField(
            controller: _codeCtrl,
            enabled: !_busy,
            maxLength: 6,
            decoration: const InputDecoration(
              labelText: '6-значный код',
              counterText: '',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: HundlerSpacing.sm),
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed: _busy ? null : _verifyCode,
              child: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Войти'),
            ),
          ),
        ] else
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed: _busy ? null : _sendCode,
              child: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Отправить код'),
            ),
          ),
        const SizedBox(height: HundlerSpacing.sm),
        TextButton(
          onPressed: _busy ? null : widget.onCancel,
          child: const Text('Назад'),
        ),
      ],
    );
  }
}
