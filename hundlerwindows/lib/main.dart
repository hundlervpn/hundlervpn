import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import 'app.dart';
import 'core/colors.dart';

/// Точка входа Hundler VPN Windows.
///
/// До рендера приложения:
///   1. Инициализируем `window_manager` — frameless окно 420×720,
///      собственный title bar нарисован в HomeScreen (`_TitleBar`).
///
/// **OAuth-flow**: НЕ используем `hundler://` deeplink + `protocol_handler`
/// потому что Windows на deeplink запускает второй процесс exe,
/// ломает `flutter run` device-connection и без named-mutex IPC не
/// форвардит аргумент живому инстансу. Вместо этого — loopback HTTP
/// server в `AuthService._runWebAuth` (RFC 8252). Подробности в
/// `lib/services/auth_service.dart`.
///
/// Старая регистрация `HKCU\Software\Classes\hundler\...` от прошлых
/// запусков остаётся в реестре, но не используется — она безвредна,
/// удалять не будем (не хочется чтобы при `flutter run` каждый раз
/// показывалась UAC-prompt-like для записи в реестр).
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await windowManager.ensureInitialized();
  const initialOptions = WindowOptions(
    size: Size(420, 720),
    minimumSize: Size(380, 600),
    center: true,
    backgroundColor: HundlerColors.bgPrimary,
    skipTaskbar: false,
    titleBarStyle: TitleBarStyle.hidden,
    title: 'Hundler VPN',
  );
  await windowManager.waitUntilReadyToShow(initialOptions, () async {
    await windowManager.show();
    await windowManager.focus();
  });

  // Перехватываем close → onWindowClose в TrayService прячет окно в
  // трей вместо реального завершения процесса. Реальный выход —
  // только через контекст-меню «Выход» в трее (там сначала
  // setPreventClose(false) и потом close).
  await windowManager.setPreventClose(true);

  runApp(const ProviderScope(child: HundlerApp()));
}
