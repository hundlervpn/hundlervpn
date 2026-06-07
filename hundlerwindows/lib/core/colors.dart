import 'package:flutter/material.dart';

/// Hundler VPN — дизайн-токены.
///
/// Источник правды — `HundlerAll/AGENTS.md` секция "Дизайн-токены".
/// Менять значения здесь без согласования с мини-аппом и Android-клиентом
/// нельзя — иначе разъедется визуал между web/Telegram-Mini-App и
/// нативными клиентами.
///
/// Файл — побайтовая копия из `hundlerandroid/lib/core/colors.dart`.
/// Когда вынесем общий код в Dart-пакет `hundler_core/` — этот файл
/// исчезнет.
class HundlerColors {
  HundlerColors._();

  // Backgrounds
  static const Color bgPrimary = Color(0xFF020202);
  static const Color bgSurface = Color(0xFF0A0A0A);
  static const Color bgElevated = Color(0xFF141414);

  // Text
  static const Color textPrimary = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFFA3A3A3);

  // Brand accents
  static const Color accentRed = Color(0xFFEF4444);          // red-500
  static const Color accentRedGlow = Color(0x59EF4444);      // 35% alpha
  static const Color accentRedSoft = Color(0x1AEF4444);      // 10% alpha (фон chip)
  static const Color accentOrange = Color(0xFFF97316);       // orange-500

  // Status
  static const Color success = Color(0xFF22C55E);            // green-500
  static const Color danger = Color(0xFFDC2626);             // red-600

  // Borders
  static const Color borderSubtle = Color(0x14FFFFFF);       // 8% alpha
  static const Color borderStrong = Color(0x33FFFFFF);       // 20% alpha
}

/// Радиусы. Карточки — 16, кнопки — 12, чипы — 8.
class HundlerRadius {
  HundlerRadius._();
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
}

/// 4-точечная сетка отступов.
class HundlerSpacing {
  HundlerSpacing._();
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 20;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;
}
