import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../../core/colors.dart';
import '../../../services/vpn_service.dart';

/// Интерактивный тигр — единственная кнопка для подключения / отключения
/// VPN. Сам тигр кликабелен, вокруг него — анимированное pulse-кольцо,
/// которое меняет поведение в зависимости от состояния подключения.
///
/// Состояния:
///
/// - `disconnected` / `error` — статичный soft-red ring, тигр медленно
///   «дышит» (4с цикл, ±2% scale).
/// - `connecting` / `disconnecting` — два расходящихся ripple-кольца +
///   быстрый «нервный» pulse тигра.
/// - `connected` — яркий double-glow ring, тигр стабильно подсвечен.
///
/// Tap-area покрывает не только тигра, но и ring вокруг — попасть пальцем
/// проще. Чтобы анимации не «прыгали» между сборками, размер ring'а
/// фиксируется через [size] (диаметр тигра, ring рисуется наружу).
class ConnectTiger extends StatefulWidget {
  const ConnectTiger({
    super.key,
    required this.status,
    required this.onTap,
    this.size = 220,
  });

  final VpnConnectionStatus status;
  final VoidCallback onTap;
  final double size;

  @override
  State<ConnectTiger> createState() => _ConnectTigerState();
}

class _ConnectTigerState extends State<ConnectTiger>
    with TickerProviderStateMixin {
  late final AnimationController _rippleCtrl;

  @override
  void initState() {
    super.initState();
    _rippleCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    );
    _syncRippleAnim();
  }

  @override
  void didUpdateWidget(covariant ConnectTiger oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status != widget.status) {
      _syncRippleAnim();
    }
  }

  void _syncRippleAnim() {
    final transitioning = widget.status == VpnConnectionStatus.connecting ||
        widget.status == VpnConnectionStatus.disconnecting;
    if (transitioning) {
      _rippleCtrl.repeat();
    } else {
      _rippleCtrl.stop();
      _rippleCtrl.reset();
    }
  }

  @override
  void dispose() {
    _rippleCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Внешний размер — на 60% больше тигра, чтобы было место для ring.
    final outer = widget.size * 1.6;
    return SizedBox.square(
      dimension: outer,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // 1. Soft ambient halo на фоне.
          _AmbientHalo(status: widget.status, size: outer),

          // 2. Расходящиеся ripple-кольца только в transitioning-стейтах.
          if (widget.status == VpnConnectionStatus.connecting ||
              widget.status == VpnConnectionStatus.disconnecting)
            _RippleRings(controller: _rippleCtrl, outerSize: outer),

          // 3. Основное состояние ring — постоянная окружность вокруг тигра.
          _MainRing(status: widget.status, size: widget.size * 1.15),

          // 4. Сам тигр — кликабельный, с дыхательной анимацией.
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: widget.onTap,
            child: _TigerCore(size: widget.size, status: widget.status),
          ),
        ],
      ),
    );
  }
}

/// Дальний размытый halo за тигром. Цвет зависит от статуса.
class _AmbientHalo extends StatelessWidget {
  const _AmbientHalo({required this.status, required this.size});
  final VpnConnectionStatus status;
  final double size;

  @override
  Widget build(BuildContext context) {
    final color = _glowColor(status, ambient: true);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 600),
      curve: Curves.easeOutCubic,
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [color, Colors.transparent],
          stops: const [0.0, 0.75],
        ),
      ),
    );
  }
}

/// Две расходящиеся «волны» — fade-out + scale-up. Видны только когда
/// подключаемся/отключаемся.
class _RippleRings extends StatelessWidget {
  const _RippleRings({required this.controller, required this.outerSize});
  final AnimationController controller;
  final double outerSize;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        // Две волны со сдвигом 0.5 фазы.
        return Stack(
          alignment: Alignment.center,
          children: [
            _ring(controller.value),
            _ring((controller.value + 0.5) % 1),
          ],
        );
      },
    );
  }

  Widget _ring(double t) {
    // Размер растёт от 0.55 до 1.0 от outer, прозрачность от 0.6 до 0.
    final scale = 0.55 + 0.45 * t;
    final opacity = (1 - t).clamp(0.0, 1.0) * 0.6;
    return Container(
      width: outerSize * scale,
      height: outerSize * scale,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: HundlerColors.accentRed.withValues(alpha: opacity),
          width: 1.5,
        ),
      ),
    );
  }
}

/// Главное ring-кольцо вокруг тигра. Толще / тоньше / ярче в зависимости
/// от состояния.
class _MainRing extends StatelessWidget {
  const _MainRing({required this.status, required this.size});
  final VpnConnectionStatus status;
  final double size;

  @override
  Widget build(BuildContext context) {
    final connected = status == VpnConnectionStatus.connected;
    final inProgress = status == VpnConnectionStatus.connecting ||
        status == VpnConnectionStatus.disconnecting;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      curve: Curves.easeOutCubic,
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: connected
              ? HundlerColors.accentRed
              : inProgress
                  ? HundlerColors.accentOrange.withValues(alpha: 0.6)
                  : HundlerColors.borderStrong,
          width: connected ? 2.5 : 1.5,
        ),
        boxShadow: connected
            ? [
                BoxShadow(
                  color: HundlerColors.accentRed.withValues(alpha: 0.4),
                  blurRadius: 36,
                  spreadRadius: 2,
                ),
              ]
            : null,
      ),
    );
  }
}

/// Сам тигр + локальный glow в зависимости от состояния.
class _TigerCore extends StatelessWidget {
  const _TigerCore({required this.size, required this.status});
  final double size;
  final VpnConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    final connected = status == VpnConnectionStatus.connected;
    return SizedBox.square(
      dimension: size,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: _glowColor(status).withValues(
                alpha: connected ? 0.65 : 0.35,
              ),
              blurRadius: connected ? 56 : 36,
              spreadRadius: connected ? 6 : 2,
            ),
          ],
        ),
        child: Image.asset(
          'assets/images/tiger.png',
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
        )
            .animate(
              onPlay: (c) => c.repeat(reverse: true),
              key: ValueKey(status),
            )
            .scaleXY(
              begin: 1.0,
              end: connected ? 1.03 : 1.02,
              duration: connected ? 2.seconds : 4.seconds,
              curve: Curves.easeInOut,
            )
            .fadeIn(
              begin: 0.94,
              duration: connected ? 2.seconds : 4.seconds,
              curve: Curves.easeInOut,
            ),
      ),
    );
  }
}

Color _glowColor(VpnConnectionStatus status, {bool ambient = false}) {
  switch (status) {
    case VpnConnectionStatus.connected:
      return ambient
          ? HundlerColors.accentRed.withValues(alpha: 0.18)
          : HundlerColors.accentRed;
    case VpnConnectionStatus.connecting:
    case VpnConnectionStatus.disconnecting:
      return ambient
          ? HundlerColors.accentOrange.withValues(alpha: 0.12)
          : HundlerColors.accentOrange;
    case VpnConnectionStatus.error:
      return ambient
          ? HundlerColors.danger.withValues(alpha: 0.14)
          : HundlerColors.danger;
    case VpnConnectionStatus.disconnected:
      return ambient
          ? HundlerColors.accentRed.withValues(alpha: 0.08)
          : HundlerColors.accentRedGlow;
  }
}
