import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/colors.dart';
import 'core/theme.dart';
import 'core/typography.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/login_screen.dart';
import 'features/home/widgets/tiger_logo.dart';
import 'features/settings/excluded_apps_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/shell/main_shell.dart';

class HundlerApp extends StatelessWidget {
  const HundlerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hundler VPN',
      debugShowCheckedModeBanner: false,
      theme: buildHundlerTheme(),
      darkTheme: buildHundlerTheme(),
      themeMode: ThemeMode.dark,
      // Локализация — пока стартуем с русского. При расширении на en
      // переходим на gen_l10n / ARB-файлы (см. AGENTS.md).
      locale: const Locale('ru'),
      supportedLocales: const [Locale('ru'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const _AuthGate(),
      // Именованные маршруты — для пушей из Profile / Settings.
      // home всегда рендерится через _AuthGate, а settings/* — это
      // полноэкранные routes поверх MainShell.
      routes: {
        '/settings': (_) => const SettingsScreen(),
        '/settings/excluded': (_) => const ExcludedAppsScreen(),
      },
    );
  }
}

/// Корневой роутер: смотрит на [authControllerProvider] и решает
/// какой экран показывать. AnimatedSwitcher даёт мягкий fade при
/// переходе между сплешем / логином / главным экраном.
class _AuthGate extends ConsumerWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(authControllerProvider);
    final child = switch (state) {
      AuthBootstrapping() => const _SplashScreen(key: ValueKey('splash')),
      AuthSignedOut() => const LoginScreen(key: ValueKey('login')),
      AuthSignedIn() => const MainShell(key: ValueKey('shell')),
    };
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      child: child,
    );
  }
}

/// Splash при холодном старте — пока [AuthController.bootstrap]
/// сходит в `/api/auth/session`. Минимальный, потому что обычно
/// решение приходит за <500 мс и юзер его почти не видит.
class _SplashScreen extends StatelessWidget {
  const _SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const TigerLogo(size: 120),
            const SizedBox(height: HundlerSpacing.lg),
            Text(
              'HUNDLER VPN',
              style: HundlerTypography.brandTitle(size: 18),
            ),
            const SizedBox(height: HundlerSpacing.xl),
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: HundlerColors.accentRed,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
