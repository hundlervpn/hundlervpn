import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';

/// Типографика Hundler VPN — Manrope + Space Grotesk.
///
/// Файл — побайтовая копия из `hundlerandroid/lib/core/typography.dart`.
/// Менять только синхронно с Android-клиентом и мини-аппом.
///
/// Грузим через google_fonts (HTTP-кеш в первом запуске + offline после).
class HundlerTypography {
  HundlerTypography._();

  static TextTheme buildTextTheme() {
    final base = GoogleFonts.manropeTextTheme(
      ThemeData.dark().textTheme,
    ).apply(
      bodyColor: HundlerColors.textPrimary,
      displayColor: HundlerColors.textPrimary,
    );

    final displayBase = GoogleFonts.spaceGrotesk(
      fontWeight: FontWeight.w700,
      letterSpacing: 0.5,
      color: HundlerColors.textPrimary,
    );

    return base.copyWith(
      displayLarge: displayBase.copyWith(fontSize: 48, height: 1.05),
      displayMedium: displayBase.copyWith(fontSize: 36, height: 1.1),
      displaySmall: displayBase.copyWith(fontSize: 28, height: 1.15),

      headlineLarge: GoogleFonts.spaceGrotesk(
        fontWeight: FontWeight.w600,
        fontSize: 28,
        color: HundlerColors.textPrimary,
        letterSpacing: -0.2,
      ),
      headlineMedium: GoogleFonts.spaceGrotesk(
        fontWeight: FontWeight.w600,
        fontSize: 22,
        color: HundlerColors.textPrimary,
        letterSpacing: -0.2,
      ),
      headlineSmall: GoogleFonts.spaceGrotesk(
        fontWeight: FontWeight.w600,
        fontSize: 18,
        color: HundlerColors.textPrimary,
        letterSpacing: -0.1,
      ),

      titleLarge: base.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        fontSize: 18,
        letterSpacing: -0.1,
      ),
      titleMedium: base.titleMedium?.copyWith(
        fontWeight: FontWeight.w600,
        fontSize: 15,
      ),

      bodyLarge: base.bodyLarge?.copyWith(fontSize: 16),
      bodyMedium: base.bodyMedium?.copyWith(fontSize: 14),
      bodySmall: base.bodySmall?.copyWith(
        fontSize: 12,
        color: HundlerColors.textSecondary,
      ),

      labelLarge: base.labelLarge?.copyWith(
        fontWeight: FontWeight.w700,
        fontSize: 15,
        letterSpacing: 0.2,
      ),
      labelMedium: base.labelMedium?.copyWith(
        fontWeight: FontWeight.w600,
        fontSize: 13,
      ),
    );
  }

  /// Стиль для брендовой надписи "HUNDLER VPN" — Space Grotesk Bold.
  static TextStyle brandTitle({double size = 22}) => GoogleFonts.spaceGrotesk(
        fontWeight: FontWeight.w700,
        letterSpacing: 1.5,
        fontSize: size,
        color: HundlerColors.textPrimary,
      );

  /// Текст внутри статусной плашки на Home ("ЗАЩИЩЕНО" / "ОТКЛЮЧЕНО").
  static TextStyle statusBadge({double size = 26, Color? color}) =>
      GoogleFonts.spaceGrotesk(
        fontWeight: FontWeight.w700,
        letterSpacing: 2.5,
        fontSize: size,
        height: 1.0,
        color: color ?? HundlerColors.textPrimary,
      );
}
