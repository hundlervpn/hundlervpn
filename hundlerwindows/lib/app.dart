import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_screen.dart';
import 'features/splash/splash_screen.dart';
import 'features/vpn/vpn_controller.dart';
import 'services/tray_service.dart';
import 'services/vpn_service.dart';

/// Корневой MaterialApp + auth-гейт.
///
/// Слушает `authControllerProvider` и переключается между:
///   - [SplashScreen]  при `AuthBootstrapping`
///   - [LoginScreen]   при `AuthSignedOut`
///   - [HomeScreen]    при `AuthSignedIn`
///
/// AnimatedSwitcher с fade — приятный переход при смене состояния
/// (например после успешного OAuth login без перезапуска приложения).
class HundlerApp extends ConsumerWidget {
  const HundlerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Hundler VPN',
      debugShowCheckedModeBanner: false,
      theme: buildHundlerTheme(),
      // _TrayBridge оборачивает _AuthGate, чтобы получить доступ к
      // Riverpod через ref. Это нужно для двух вещей:
      //   1. TrayService.initialize(onToggleVpn: ref.read(...).toggle)
      //      — handler меню «Подключить/Отключить» в tray должен
      //      дёрнуть vpnControllerProvider.notifier.toggle().
      //   2. ref.listen(vpnStatusProvider) → TrayService.updateStatus
      //      — иконка/tooltip/лейбл в tray обновляются live при
      //      смене состояния sing-box процесса.
      home: const _TrayBridge(child: _AuthGate()),
    );
  }
}

/// Inicializирует [TrayService] один раз и синхронизирует его с
/// [vpnStatusProvider]. Сам по себе не рендерит UI, только пробрасывает
/// child вниз. Помещён внутрь ProviderScope (через HundlerApp), чтобы
/// получить WidgetRef для ref.read / ref.listen.
class _TrayBridge extends ConsumerStatefulWidget {
  const _TrayBridge({required this.child});
  final Widget child;

  @override
  ConsumerState<_TrayBridge> createState() => _TrayBridgeState();
}

class _TrayBridgeState extends ConsumerState<_TrayBridge> {
  @override
  void initState() {
    super.initState();
    // initialize асинхронен, но мы не ждём — UI стартует параллельно.
    // Если tray почему-то не поднимется (отсутствует .ico / sandbox)
    // — приложение работает как раньше, просто без трея.
    Future<void>.microtask(() async {
      await TrayService.instance.initialize(
        onToggleVpn: () =>
            ref.read(vpnControllerProvider.notifier).toggle(),
      );
      // Прокинуть текущее состояние сразу — на старте оно почти всегда
      // VpnStatus.disconnected, но если был hot-reload и sing-box.exe
      // ещё жив — увидим actual.
      await TrayService.instance.updateStatus(
        VpnService.instance.status,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    // Слушаем смены статуса и проксируем в TrayService. ref.listen
    // имеет смысл только внутри build, поэтому он здесь, а не в initState.
    ref.listen<AsyncValue<VpnStatus>>(vpnStatusProvider, (prev, next) {
      next.whenData(TrayService.instance.updateStatus);
    });
    return widget.child;
  }
}

class _AuthGate extends ConsumerWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authControllerProvider);

    final Widget child = switch (authState) {
      AuthBootstrapping() => const SplashScreen(),
      AuthSignedOut() => const LoginScreen(),
      AuthSignedIn() => const HomeScreen(),
    };

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      child: KeyedSubtree(
        key: ValueKey(authState.runtimeType),
        child: child,
      ),
    );
  }
}
