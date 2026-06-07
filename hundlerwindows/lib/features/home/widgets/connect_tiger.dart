import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../../core/colors.dart';
import 'tiger_logo.dart';

/// Кликабельный тигр-кнопка для Connect/Disconnect.
///
/// Это **главный** интерактивный элемент Home Screen в премиум-стиле:
/// большой круг (260×260) с тигром в центре, окружённый status-кольцом
/// которое меняет цвет/толщину/glow в зависимости от состояния VPN.
///
/// Состояния и визуал:
///
/// - **disconnected**: красное тонкое кольцо, мягкий красный glow,
///   тигр «дышит» (стандартная анимация). Subtitle «Нажмите, чтобы
///   подключиться».
/// - **connecting**: оранжевое кольцо вращается (0→2π за 1.4 с),
///   glow оранжевый. Subtitle «Подключение...».
/// - **connected**: **белое** кольцо с холодным glow + 3 расходящиеся
///   ripple-волны (sci-fi sonar look). Subtitle «Защищено».
/// - **error**: красное кольцо, danger-glow. Subtitle «Ошибка —
///   попробовать снова?».
///
/// Жест:
///
/// - tap → `onTap()`. Внутри коллера обычно вызывается
///   `vpnControllerProvider.notifier.toggle()`.
/// - hover (Mouse-region) → лёгкий scale (1.0 → 1.03).
/// - press → scale (0.97) для тактильной обратной связи.
class ConnectTiger extends StatefulWidget {
  const ConnectTiger({
    super.key,
    required this.connecting,
    required this.connected,
    required this.hasError,
    required this.onTap,
    this.size = 260,
  });

  final bool connecting;
  final bool connected;
  final bool hasError;
  final VoidCallback? onTap;

  /// Внешний диаметр круга (включая status-ring и glow).
  final double size;

  @override
  State<ConnectTiger> createState() => _ConnectTigerState();
}

class _ConnectTigerState extends State<ConnectTiger> {
  bool _hover = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final size = widget.size;
    final tigerSize = size * 0.65;
    final ringColor = widget.hasError
        ? HundlerColors.danger
        : widget.connected
            ? Colors.white
            : widget.connecting
                ? HundlerColors.accentOrange
                : HundlerColors.accentRed;
    // При connected glow белый и нежно-холодный (как у LED).
    final glowColor = widget.connected
        ? Colors.white.withValues(alpha: 0.45)
        : ringColor.withValues(alpha: 0.35);
    final glowRadius = widget.connected ? 50.0 : 42.0;
    final ringWidth = widget.connecting ? 3.5 : (widget.connected ? 3.0 : 2.0);

    final subtitle = widget.hasError
        ? 'Нажмите, чтобы попробовать снова'
        : widget.connecting
            ? 'Подключение...'
            : widget.connected
                ? 'Защищено'
                : 'Нажмите, чтобы подключиться';

    final scale = _pressed ? 0.97 : (_hover ? 1.03 : 1.0);

    Widget ring = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: ringColor.withValues(alpha: 0.85),
          width: ringWidth,
        ),
        boxShadow: [
          BoxShadow(
            color: glowColor,
            blurRadius: glowRadius,
            spreadRadius: 4,
          ),
        ],
      ),
    );

    if (widget.connecting) {
      // Кольцо вращается. Делаем «дугу» — для эффекта прогресса —
      // через CustomPaint было бы идеально, но без overengineering
      // используем непрерывный rotate целого Border ring'а: визуально
      // glow и Border однородные, поэтому rotate выглядит как
      // равномерное «дыхание» а не явная стрелка. Этого достаточно
      // для премиум-ощущения «работаем».
      ring = ring
          .animate(onPlay: (c) => c.repeat())
          .rotate(
            duration: const Duration(milliseconds: 1400),
            curve: Curves.linear,
          );
    } else if (widget.connected) {
      // Лёгкое «дыхание» кольца, чтобы было ясно что соединение живое.
      ring = ring
          .animate(onPlay: (c) => c.repeat(reverse: true))
          .scale(
            begin: const Offset(1.0, 1.0),
            end: const Offset(1.025, 1.025),
            duration: 2.seconds,
            curve: Curves.easeInOut,
          );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        MouseRegion(
          cursor: SystemMouseCursors.click,
          onEnter: (_) => setState(() => _hover = true),
          onExit: (_) => setState(() {
            _hover = false;
            _pressed = false;
          }),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapDown: (_) => setState(() => _pressed = true),
            onTapCancel: () => setState(() => _pressed = false),
            onTapUp: (_) => setState(() => _pressed = false),
            onTap: widget.onTap,
            child: AnimatedScale(
              duration: const Duration(milliseconds: 120),
              scale: scale,
              curve: Curves.easeOut,
              // Stack нужен чтобы волны выходили ЗА пределы size
              // (scale 1.0 → 1.55). clipBehavior:none разрешает overflow.
              child: SizedBox(
                width: size,
                height: size,
                child: Stack(
                  alignment: Alignment.center,
                  clipBehavior: Clip.none,
                  children: [
                    // Ripple-волны видны только при connected.
                    // Размещены ПОД ring (z-order первый).
                    if (widget.connected)
                      _RippleWaves(baseSize: size, color: Colors.white),
                    ring,
                    // Внутренний круг — тёмный «диск» под тигром,
                    // даёт depth.
                    Container(
                      width: size * 0.82,
                      height: size * 0.82,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          colors: [
                            HundlerColors.bgSurface,
                            HundlerColors.bgPrimary,
                          ],
                          stops: const [0.0, 1.0],
                          radius: 0.85,
                        ),
                      ),
                    ),
                    // Сам тигр — без своего glow, его роль играет
                    // status-ring снаружи.
                    TigerLogo(size: tigerSize, showGlow: false),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: HundlerSpacing.md),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          child: Text(
            subtitle,
            key: ValueKey(subtitle),
            style: TextStyle(
              color: ringColor,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.4,
            ),
          ),
        ),
      ],
    );
  }
}

/// Sci-fi sonar-волны: 3 концентрических кольца расходятся от центра
/// и затухают. Виден только когда VPN подключён.
///
/// Реализация:
///   - Один `AnimationController` 3-секундный loop.
///   - 3 кольца со staggered phase (0.00, 0.33, 0.67), каждое — `scale
///     1.0 → 1.55`, `opacity 0.55 → 0.0` (с easeOut).
///   - Рисуется через `CustomPainter` чтобы одной перерисовкой на тик
///     отрисовать все 3 кольца (Container+AnimatedBuilder ×3 было бы
///     ~3× тяжелее по performance).
///
/// Параметр `baseSize` = диаметр status-кольца. Волны стартуют с этого
/// размера и расширяются до `baseSize × 1.55`.
class _RippleWaves extends StatefulWidget {
  const _RippleWaves({required this.baseSize, required this.color});

  final double baseSize;
  final Color color;

  @override
  State<_RippleWaves> createState() => _RippleWavesState();
}

class _RippleWavesState extends State<_RippleWaves>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 3000),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final maxSize = widget.baseSize * 1.55;
    return SizedBox(
      width: maxSize,
      height: maxSize,
      child: AnimatedBuilder(
        animation: _ctrl,
        builder: (context, _) {
          return CustomPaint(
            painter: _RipplePainter(
              progress: _ctrl.value,
              baseRadius: widget.baseSize / 2,
              maxRadius: maxSize / 2,
              color: widget.color,
            ),
          );
        },
      ),
    );
  }
}

/// Рисует 3 расходящиеся волны. Каждая — кольцо (stroke), не filled.
///
/// Логика staggering: глобальный `progress ∈ [0..1]` за 3с. Для волны
/// `i ∈ {0,1,2}` локальный progress = `(progress + i/3) % 1`. Так
/// волны всегда «разнесены» во времени на треть цикла, что даёт
/// эффект непрерывного pulse'а.
class _RipplePainter extends CustomPainter {
  _RipplePainter({
    required this.progress,
    required this.baseRadius,
    required this.maxRadius,
    required this.color,
  });

  final double progress;
  final double baseRadius;
  final double maxRadius;
  final Color color;

  static const int _waveCount = 3;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    for (var i = 0; i < _waveCount; i++) {
      final localT = (progress + i / _waveCount) % 1.0;
      // easeOut: быстрый старт, медленное затухание — выглядит как
      // настоящие волны на воде.
      final eased = Curves.easeOutCubic.transform(localT);
      final radius = baseRadius + (maxRadius - baseRadius) * eased;
      // Прозрачность падает к концу волны.
      final alpha = (1.0 - localT) * 0.55;
      if (alpha <= 0) continue;
      final paint = Paint()
        ..color = color.withValues(alpha: alpha)
        ..style = PaintingStyle.stroke
        // Тоньше к концу волны — добавляет дальний sci-fi эффект.
        ..strokeWidth = 2.0 * (1.0 - localT * 0.6);
      canvas.drawCircle(center, radius, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _RipplePainter old) =>
      old.progress != progress || old.color != color;
}
