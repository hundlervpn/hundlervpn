import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../core/colors.dart';
import '../../core/typography.dart';
import '../../services/auth_service.dart';
import '../home/widgets/tiger_logo.dart';
import 'auth_controller.dart';

/// Экран входа Hundler VPN.
///
/// Поддерживает три способа:
/// - **Google** — Custom Tab → OIDC → deep-link.
/// - **Telegram** — то же самое через oauth.telegram.org.
/// - **Email + код** — две стадии: запросить код / ввести 6-значный код.
///
/// Стейт `_step` управляет какой UI показывать. На стадиях email
/// кнопки Google/Telegram спрятаны, остаётся только email-form + back.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

enum _Step { providers, emailEnter, emailCode }

class _LoginScreenState extends ConsumerState<LoginScreen> {
  _Step _step = _Step.providers;
  bool _busy = false;
  String? _error;

  final _emailCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  String _verifiedEmail = '';

  // Cooldown между отправками кода (бэк: 60 секунд per-email rate limit).
  // Считаем тут чтобы не давить кнопку зря и не получать 429.
  int _resendCooldown = 0;
  Timer? _cooldownTimer;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _codeCtrl.dispose();
    _cooldownTimer?.cancel();
    super.dispose();
  }

  void _startCooldown() {
    _cooldownTimer?.cancel();
    setState(() => _resendCooldown = 60);
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() {
        _resendCooldown -= 1;
        if (_resendCooldown <= 0) t.cancel();
      });
    });
  }

  Future<void> _onGoogle() => _runProviderLogin(
        () => ref.read(authControllerProvider.notifier).signInWithGoogle(),
      );

  Future<void> _onTelegram() => _runProviderLogin(
        () => ref.read(authControllerProvider.notifier).signInWithTelegram(),
      );

  Future<void> _runProviderLogin(Future<AuthResult> Function() fn) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await fn();
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (result is AuthError) _error = result.message;
    });
  }

  Future<void> _onSendCode() async {
    if (_busy) return;
    final email = _emailCtrl.text.trim();
    if (!_isValidEmail(email)) {
      setState(() => _error = 'Введите корректный email');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).sendEmailCode(email);
      if (!mounted) return;
      setState(() {
        _verifiedEmail = email;
        _step = _Step.emailCode;
        _codeCtrl.clear();
      });
      _startCooldown();
    } on HundlerApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Не удалось отправить код: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onVerifyCode() async {
    if (_busy) return;
    final code = _codeCtrl.text.trim();
    if (code.length != 6) {
      setState(() => _error = 'Код состоит из 6 цифр');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await ref
        .read(authControllerProvider.notifier)
        .verifyEmailCode(email: _verifiedEmail, code: code);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (result is AuthError) _error = result.message;
    });
  }

  Future<void> _onResendCode() async {
    if (_resendCooldown > 0) return;
    await _onSendCode();
  }

  bool _isValidEmail(String s) =>
      RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(s);

  void _backToProviders() {
    setState(() {
      _step = _Step.providers;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final isCompact = constraints.maxHeight < 720;
            final tigerSize = isCompact ? 120.0 : 170.0;
            return SingleChildScrollView(
              physics: const ClampingScrollPhysics(),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: IntrinsicHeight(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: HundlerSpacing.xl,
                      vertical: HundlerSpacing.xxl,
                    ),
                    child: Column(
                      children: [
                        const Spacer(flex: 2),
                        TigerLogo(size: tigerSize),
                        const SizedBox(height: HundlerSpacing.lg),
                        Text(
                          'HUNDLER VPN',
                          style: HundlerTypography.brandTitle(size: 28),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: HundlerSpacing.xs),
                        Text(
                          'VLESS + Reality, обход DPI',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: HundlerColors.textSecondary,
                              ),
                          textAlign: TextAlign.center,
                        ),
                        const Spacer(flex: 3),
                        if (_error != null) ...[
                          _ErrorBanner(message: _error!),
                          const SizedBox(height: HundlerSpacing.md),
                        ],
                        _buildBody(),
                        const SizedBox(height: HundlerSpacing.lg),
                        _LegalText(theme: Theme.of(context)),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildBody() {
    switch (_step) {
      case _Step.providers:
        return _ProviderButtons(
          busy: _busy,
          onGoogle: _onGoogle,
          onTelegram: _onTelegram,
          onEmail: () => setState(() {
            _step = _Step.emailEnter;
            _error = null;
          }),
        );
      case _Step.emailEnter:
        return _EmailForm(
          controller: _emailCtrl,
          busy: _busy,
          onBack: _backToProviders,
          onSubmit: _onSendCode,
        );
      case _Step.emailCode:
        return _CodeForm(
          email: _verifiedEmail,
          controller: _codeCtrl,
          busy: _busy,
          resendCooldown: _resendCooldown,
          onResend: _onResendCode,
          onBack: () => setState(() {
            _step = _Step.emailEnter;
            _error = null;
          }),
          onSubmit: _onVerifyCode,
        );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Шаг 1: три кнопки провайдеров.
// ─────────────────────────────────────────────────────────────────────────────

class _ProviderButtons extends StatelessWidget {
  const _ProviderButtons({
    required this.busy,
    required this.onGoogle,
    required this.onTelegram,
    required this.onEmail,
  });

  final bool busy;
  final VoidCallback onGoogle;
  final VoidCallback onTelegram;
  final VoidCallback onEmail;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _ProviderButton(
          label: 'Войти через Telegram',
          glyph: const _TelegramGlyph(size: 22),
          fillColor: const Color(0xFF2AABEE),
          textColor: Colors.white,
          onPressed: busy ? null : onTelegram,
        ),
        const SizedBox(height: HundlerSpacing.sm),
        _ProviderButton(
          label: 'Войти через Google',
          glyph: const _GoogleGlyph(size: 22),
          fillColor: HundlerColors.textPrimary,
          textColor: HundlerColors.bgPrimary,
          onPressed: busy ? null : onGoogle,
        ),
        const SizedBox(height: HundlerSpacing.sm),
        _ProviderButton(
          label: 'Войти по коду на e-mail',
          glyph: const Icon(
            Icons.mail_outline_rounded,
            color: HundlerColors.textPrimary,
            size: 22,
          ),
          fillColor: HundlerColors.bgSurface,
          textColor: HundlerColors.textPrimary,
          outlined: true,
          onPressed: busy ? null : onEmail,
        ),
        if (busy) ...[
          const SizedBox(height: HundlerSpacing.md),
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: HundlerColors.accentRed,
            ),
          ),
        ],
      ],
    );
  }
}

class _ProviderButton extends StatelessWidget {
  const _ProviderButton({
    required this.label,
    required this.glyph,
    required this.fillColor,
    required this.textColor,
    required this.onPressed,
    this.outlined = false,
  });

  final String label;
  final Widget glyph;
  final Color fillColor;
  final Color textColor;
  final VoidCallback? onPressed;
  final bool outlined;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: double.infinity,
      height: 56,
      child: Material(
        color: fillColor,
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
          child: Container(
            decoration: outlined
                ? BoxDecoration(
                    borderRadius: BorderRadius.circular(HundlerRadius.sm),
                    border: Border.all(color: HundlerColors.borderSubtle),
                  )
                : null,
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  glyph,
                  const SizedBox(width: HundlerSpacing.sm),
                  Text(
                    label,
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: textColor,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Брендовый Telegram-glyph: круг #2AABEE с белым «бумажным самолётиком».
/// SVG-аналог нарисован через CustomPainter чтобы не тащить svg-пакет.
class _TelegramGlyph extends StatelessWidget {
  const _TelegramGlyph({required this.size});
  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: const Icon(
        Icons.send_rounded,
        color: Colors.white,
        size: 20,
      ),
    );
  }
}

/// Брендовый Google-glyph: тёмный круг с тонким красным контуром и
/// белой "G". Hundler-эстетика вместо google-радужного градиента.
class _GoogleGlyph extends StatelessWidget {
  const _GoogleGlyph({required this.size});
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1A1A1A), Color(0xFF050505)],
        ),
        border: Border.all(
          color: HundlerColors.accentRed.withValues(alpha: 0.7),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: HundlerColors.accentRed.withValues(alpha: 0.25),
            blurRadius: 8,
            spreadRadius: 0.5,
          ),
        ],
      ),
      child: Text(
        'G',
        style: TextStyle(
          color: HundlerColors.textPrimary,
          fontSize: size * 0.58,
          fontWeight: FontWeight.w700,
          height: 1,
          letterSpacing: -0.5,
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Шаг 2: ввод email.
// ─────────────────────────────────────────────────────────────────────────────

class _EmailForm extends StatelessWidget {
  const _EmailForm({
    required this.controller,
    required this.busy,
    required this.onBack,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool busy;
  final VoidCallback onBack;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: controller,
          enabled: !busy,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          textCapitalization: TextCapitalization.none,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => onSubmit(),
          style: theme.textTheme.bodyLarge,
          decoration: _input(
            label: 'E-mail',
            hint: 'you@example.com',
            icon: Icons.mail_outline_rounded,
          ),
        ),
        const SizedBox(height: HundlerSpacing.md),
        _PrimaryButton(
          label: 'Получить код',
          busy: busy,
          onPressed: busy ? null : onSubmit,
        ),
        const SizedBox(height: HundlerSpacing.sm),
        _SecondaryButton(
          label: 'Назад',
          onPressed: busy ? null : onBack,
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Шаг 3: ввод 6-значного кода.
// ─────────────────────────────────────────────────────────────────────────────

class _CodeForm extends StatelessWidget {
  const _CodeForm({
    required this.email,
    required this.controller,
    required this.busy,
    required this.resendCooldown,
    required this.onResend,
    required this.onBack,
    required this.onSubmit,
  });

  final String email;
  final TextEditingController controller;
  final bool busy;
  final int resendCooldown;
  final VoidCallback onResend;
  final VoidCallback onBack;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Код отправлен на $email',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: HundlerColors.textSecondary,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: HundlerSpacing.md),
        TextField(
          controller: controller,
          enabled: !busy,
          keyboardType: TextInputType.number,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(6),
          ],
          maxLength: 6,
          textAlign: TextAlign.center,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => onSubmit(),
          style: theme.textTheme.headlineSmall?.copyWith(
            letterSpacing: 12,
            fontWeight: FontWeight.w600,
            fontSize: 24,
          ),
          decoration: _input(
            label: '6-значный код',
            hint: '••••••',
            icon: Icons.pin_outlined,
            counterText: '',
          ),
        ),
        const SizedBox(height: HundlerSpacing.md),
        _PrimaryButton(
          label: 'Войти',
          busy: busy,
          onPressed: busy ? null : onSubmit,
        ),
        const SizedBox(height: HundlerSpacing.sm),
        Row(
          children: [
            Expanded(
              child: TextButton(
                onPressed: busy ? null : onBack,
                style: TextButton.styleFrom(
                  foregroundColor: HundlerColors.textSecondary,
                ),
                child: const Text('Изменить email'),
              ),
            ),
            Expanded(
              child: TextButton(
                onPressed: (busy || resendCooldown > 0) ? null : onResend,
                style: TextButton.styleFrom(
                  foregroundColor: HundlerColors.accentRed,
                ),
                child: Text(
                  resendCooldown > 0
                      ? 'Заново через $resendCooldown с'
                      : 'Отправить снова',
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

InputDecoration _input({
  required String label,
  required String hint,
  required IconData icon,
  String? counterText,
}) {
  return InputDecoration(
    labelText: label,
    hintText: hint,
    prefixIcon: Icon(icon, color: HundlerColors.textSecondary, size: 20),
    counterText: counterText,
    filled: true,
    fillColor: HundlerColors.bgSurface,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(HundlerRadius.sm),
      borderSide: const BorderSide(color: HundlerColors.borderSubtle),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(HundlerRadius.sm),
      borderSide: const BorderSide(color: HundlerColors.borderSubtle),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(HundlerRadius.sm),
      borderSide: const BorderSide(color: HundlerColors.accentRed, width: 1.4),
    ),
    labelStyle: const TextStyle(color: HundlerColors.textSecondary),
    hintStyle: TextStyle(
      color: HundlerColors.textSecondary.withValues(alpha: 0.6),
    ),
  );
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    required this.label,
    required this.busy,
    required this.onPressed,
  });

  final String label;
  final bool busy;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: Material(
        color: HundlerColors.accentRed,
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
          child: Center(
            child: busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  const _SecondaryButton({
    required this.label,
    required this.onPressed,
  });

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: TextButton(
        onPressed: onPressed,
        style: TextButton.styleFrom(
          foregroundColor: HundlerColors.textSecondary,
          backgroundColor: Colors.transparent,
        ),
        child: Text(label),
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
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: HundlerSpacing.md,
        vertical: HundlerSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: HundlerColors.danger.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
        border: Border.all(
          color: HundlerColors.danger.withValues(alpha: 0.4),
        ),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: HundlerColors.danger,
          fontSize: 13,
        ),
      ),
    );
  }
}

class _LegalText extends StatelessWidget {
  const _LegalText({required this.theme});
  final ThemeData theme;

  Future<void> _open(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final caption = theme.textTheme.bodySmall?.copyWith(
      color: HundlerColors.textSecondary,
      fontSize: 11,
      height: 1.4,
    );
    final link = caption?.copyWith(
      color: HundlerColors.textPrimary,
      decoration: TextDecoration.underline,
    );
    return RichText(
      textAlign: TextAlign.center,
      text: TextSpan(
        style: caption,
        children: [
          const TextSpan(text: 'Входя, вы соглашаетесь с '),
          TextSpan(
            text: 'условиями',
            style: link,
            recognizer: TapGestureRecognizer()
              ..onTap = () => _open('https://hundlervpn.xyz/terms'),
          ),
          const TextSpan(text: ' и '),
          TextSpan(
            text: 'политикой',
            style: link,
            recognizer: TapGestureRecognizer()
              ..onTap = () => _open('https://hundlervpn.xyz/privacy'),
          ),
          const TextSpan(text: '.'),
        ],
      ),
    );
  }
}
