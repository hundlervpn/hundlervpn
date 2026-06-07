import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../../core/colors.dart';

/// Брендовый лого с дыхательной анимацией (4 с цикл, ±2% scale + альфа
/// 0.95→1). Должен совпадать с поведением `TigerNetworkLogo` в мини-аппе.
///
/// Под капотом — `assets/images/tiger.png` (тот же файл, что
/// `hundlerminiapp/public/tiger.png`). Glow реализуется через
/// `BoxShadow`, потому что `Image.filter` смерчит прямоугольный bbox,
/// а у нас круглая alpha-маска.
class TigerLogo extends StatelessWidget {
  const TigerLogo({super.key, this.size = 224});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: HundlerColors.accentRedGlow,
              blurRadius: 42,
              spreadRadius: 4,
            ),
            BoxShadow(
              color: HundlerColors.accentRedSoft,
              blurRadius: 80,
              spreadRadius: 12,
            ),
          ],
        ),
        child: Image.asset(
          'assets/images/tiger.png',
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
        )
            .animate(
              onPlay: (controller) => controller.repeat(reverse: true),
            )
            .scaleXY(
              begin: 1.0,
              end: 1.02,
              duration: 4.seconds,
              curve: Curves.easeInOut,
            )
            .fadeIn(
              begin: 0.95,
              duration: 4.seconds,
              curve: Curves.easeInOut,
            ),
      ),
    );
  }
}
