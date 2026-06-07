import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../../core/colors.dart';
import '../../core/typography.dart';
import '../home/widgets/tiger_logo.dart';

/// Splash-экран на время `AuthBootstrapping`. Показывается пока
/// `AuthController._bootstrap()` восстанавливает сессию из DPAPI и
/// проверяет её через `/api/auth/session`. На быстрой сети занимает
/// ~200-500 мс, на медленной — до 12 секунд (таймаут Dio).
///
/// Не показывает индикатор прогресса — дышащий тигр сам по себе
/// читается как "идёт загрузка".
///
/// Окно frameless — оборачиваем всё в [DragToMoveArea] чтобы юзер мог
/// двигать окно зажав в любой точке splash'а.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: HundlerColors.bgPrimary,
      body: DragToMoveArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const TigerLogo(size: 160),
              const SizedBox(height: HundlerSpacing.xl),
              Text(
                'HUNDLER VPN',
                style: HundlerTypography.brandTitle(size: 18),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
