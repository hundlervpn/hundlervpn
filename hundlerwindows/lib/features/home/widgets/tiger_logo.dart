import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../../core/colors.dart';

/// «Дышащий» логотип тигра Hundler VPN.
///
/// Бренд требует: ±2 % scale и 0.95→1.0 alpha по циклу 4 секунды,
/// smooth ease (НЕ bounce). Glow реализуется как BoxShadow с радиусом 42
/// и цветом `accentRedGlow` (35 % красного).
///
/// Это копия `hundlerandroid/lib/features/home/widgets/tiger_logo.dart`
/// — после выноса общего кода в `hundler_core/` файл уйдёт.
class TigerLogo extends StatelessWidget {
  const TigerLogo({super.key, this.size = 224, this.showGlow = true});

  final double size;

  /// Окружающий красный glow. Хочется отключить — например на маленьких
  /// размерах в трее — выставить false.
  final bool showGlow;

  @override
  Widget build(BuildContext context) {
    final image = Image.asset(
      'assets/images/tiger.png',
      width: size,
      height: size,
      fit: BoxFit.contain,
    );

    final animated = image
        .animate(onPlay: (c) => c.repeat(reverse: true))
        .scale(
          begin: const Offset(1, 1),
          end: const Offset(1.02, 1.02),
          duration: 4.seconds,
          curve: Curves.easeInOut,
        )
        .fade(
          begin: 0.95,
          end: 1.0,
          duration: 4.seconds,
          curve: Curves.easeInOut,
        );

    if (!showGlow) return animated;

    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: HundlerColors.accentRedGlow,
            blurRadius: 42,
            spreadRadius: 6,
          ),
        ],
      ),
      child: animated,
    );
  }
}
