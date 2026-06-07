import 'package:flutter/material.dart';

import 'colors.dart';
import 'typography.dart';

/// Тема приложения. Только dark — у Hundler VPN нет светлого режима
/// ни на одной платформе. Источник правды — `HundlerAll/AGENTS.md`.
ThemeData buildHundlerTheme() {
  const colorScheme = ColorScheme.dark(
    surface: HundlerColors.bgPrimary,
    onSurface: HundlerColors.textPrimary,
    surfaceContainerHighest: HundlerColors.bgElevated,
    surfaceContainerHigh: HundlerColors.bgSurface,
    primary: HundlerColors.accentRed,
    onPrimary: Colors.white,
    secondary: HundlerColors.accentOrange,
    onSecondary: Colors.white,
    error: HundlerColors.danger,
    onError: Colors.white,
    outline: HundlerColors.borderSubtle,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: HundlerColors.bgPrimary,
    canvasColor: HundlerColors.bgPrimary,
    splashColor: HundlerColors.accentRedSoft,
    highlightColor: HundlerColors.accentRedSoft,
    textTheme: HundlerTypography.buildTextTheme(),
    appBarTheme: AppBarTheme(
      backgroundColor: HundlerColors.bgPrimary,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: HundlerTypography.brandTitle(size: 18),
      iconTheme: const IconThemeData(color: HundlerColors.textPrimary),
    ),
    cardTheme: CardThemeData(
      color: HundlerColors.bgSurface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(HundlerRadius.md),
        side: const BorderSide(color: HundlerColors.borderSubtle),
      ),
      margin: EdgeInsets.zero,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: HundlerColors.accentRed,
        foregroundColor: Colors.white,
        elevation: 0,
        shadowColor: Colors.transparent,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
        ),
        textStyle: const TextStyle(
          fontWeight: FontWeight.w600,
          fontSize: 15,
          letterSpacing: 0.2,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: HundlerColors.textPrimary,
        side: const BorderSide(color: HundlerColors.borderStrong),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(HundlerRadius.sm),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: HundlerColors.accentRed,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: HundlerColors.borderSubtle,
      thickness: 1,
      space: 1,
    ),
    iconTheme: const IconThemeData(
      color: HundlerColors.textPrimary,
      size: 20,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: HundlerColors.bgElevated,
      contentTextStyle: const TextStyle(color: HundlerColors.textPrimary),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(HundlerRadius.sm),
      ),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
