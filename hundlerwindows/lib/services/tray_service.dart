import 'dart:async';
import 'dart:io';

import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import 'vpn_service.dart';

/// Поведение клика по items контекстного меню — пробрасываем наверх
/// (в TrayController через Riverpod), чтобы можно было дёрнуть
/// `vpnControllerProvider.notifier.toggle()` без прямой зависимости
/// от UI-слоя.
typedef TrayMenuHandler = FutureOr<void> Function();

/// Системный tray (значок в правом-нижнем углу панели задач Windows).
///
/// **Зачем нужен**: VPN-приложение должно жить в трее, чтобы юзер
/// мог свернуть окно (а не закрыть его) и при этом туннель оставался
/// активен. Это ожидание UX от любого нормального VPN-клиента
/// (NordVPN / ProtonVPN / Mullvad).
///
/// Реализация — `tray_manager` пакет. Он использует Win32 Shell_NotifyIcon
/// под капотом. Иконка берётся из `assets/images/tray_icon.ico`
/// (копия из `windows/runner/resources/app_icon.ico`, в Flutter asset
/// bundle не попадает автоматически — пришлось скопировать).
///
/// Контекстное меню:
///   - **Открыть Hundler VPN** — `windowManager.show()` + focus.
///   - **Подключить / Отключить** — toggle VPN. Лейбл меняется
///     динамически от текущего status'а (см. [updateStatus]).
///   - **Выход** — `windowManager.close()` (полный exit процесса,
///     sing-box.exe убивается через VpnService.dispose).
///
/// Tooltip (показывается при наведении на иконку):
///   - `Hundler VPN — Защищено` / `Подключение...` / `Отключено`.
class TrayService with TrayListener, WindowListener {
  TrayService._();
  static final TrayService instance = TrayService._();

  bool _initialized = false;
  TrayMenuHandler? _onToggleVpn;

  /// Текущее отображаемое состояние — для динамического меню.
  VpnStatus _status = VpnStatus.disconnected;

  /// Инициализация — вызвать один раз из main.dart после
  /// `windowManager.ensureInitialized()`. Идемпотентно: повторные
  /// вызовы no-op.
  Future<void> initialize({required TrayMenuHandler onToggleVpn}) async {
    if (_initialized) {
      _onToggleVpn = onToggleVpn;
      return;
    }
    _onToggleVpn = onToggleVpn;
    if (!Platform.isWindows) {
      // На не-Windows тихо пропускаем — но проект всё равно
      // только Windows.
      _initialized = true;
      return;
    }

    try {
      // tray_manager на Windows ищет icon относительно
      // <exe-dir>/data/flutter_assets/. У нас файл в
      // assets/images/tray_icon.ico.
      await trayManager.setIcon('assets/images/tray_icon.ico');
      await trayManager.setToolTip(_buildTooltip());
      await _rebuildMenu();
      trayManager.addListener(this);
      windowManager.addListener(this);
      _initialized = true;
    } catch (e) {
      // ignore: avoid_print
      print('[TrayService] init failed: $e');
    }
  }

  /// Дёргается из TrayController при изменении VpnStatus.
  Future<void> updateStatus(VpnStatus status) async {
    if (!_initialized || !Platform.isWindows) return;
    if (status == _status) return;
    _status = status;
    try {
      await trayManager.setToolTip(_buildTooltip());
      await _rebuildMenu();
    } catch (_) {
      // tray уже мог быть disposed — игнорируем.
    }
  }

  /// Полная разборка — обычно не вызываем (трей живёт пока живёт
  /// процесс), но оставлено для unit-тестов / hot-reload.
  Future<void> dispose() async {
    if (!_initialized) return;
    _initialized = false;
    try {
      trayManager.removeListener(this);
      windowManager.removeListener(this);
      await trayManager.destroy();
    } catch (_) {}
  }

  String _buildTooltip() {
    return switch (_status) {
      VpnStatus.connected => 'Hundler VPN — Защищено',
      VpnStatus.connecting => 'Hundler VPN — Подключение...',
      VpnStatus.error => 'Hundler VPN — Ошибка',
      VpnStatus.disconnected => 'Hundler VPN — Отключено',
    };
  }

  Future<void> _rebuildMenu() async {
    final isOn = _status == VpnStatus.connected ||
        _status == VpnStatus.connecting;
    final menu = Menu(
      items: [
        MenuItem(
          key: 'show',
          label: 'Открыть Hundler VPN',
        ),
        MenuItem.separator(),
        MenuItem(
          key: 'toggle',
          label: isOn ? 'Отключить VPN' : 'Подключить VPN',
        ),
        MenuItem.separator(),
        MenuItem(
          key: 'quit',
          label: 'Выход',
        ),
      ],
    );
    await trayManager.setContextMenu(menu);
  }

  // === TrayListener ===

  /// Левый клик по иконке — обычно «показать главное окно». На Windows
  /// `tray_manager` пакет фактически делегирует это поведение каждому
  /// приложению (нет общепринятой системной семантики).
  @override
  void onTrayIconMouseDown() {
    _showWindow();
  }

  /// Правый клик — раскрыть контекст-меню. Без этого вызова меню не
  /// появляется (отличие от других платформ).
  @override
  void onTrayIconRightMouseDown() {
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) {
    switch (menuItem.key) {
      case 'show':
        _showWindow();
        break;
      case 'toggle':
        _onToggleVpn?.call();
        break;
      case 'quit':
        _quit();
        break;
    }
  }

  // === WindowListener ===

  /// При попытке закрыть окно (× в title-bar или Alt+F4) — прячем в
  /// трей вместо настоящего закрытия. Юзер выходит явно через
  /// контекст-меню «Выход».
  ///
  /// **Важно**: чтобы это работало, в main.dart должно быть
  /// `windowManager.setPreventClose(true)` — иначе close сработает
  /// напрямую и [onWindowClose] не вызовется.
  @override
  void onWindowClose() async {
    final shouldHide =
        await windowManager.isPreventClose() && Platform.isWindows;
    if (shouldHide) {
      await windowManager.hide();
    }
  }

  Future<void> _showWindow() async {
    try {
      if (await windowManager.isMinimized()) {
        await windowManager.restore();
      }
      await windowManager.show();
      await windowManager.focus();
    } catch (_) {}
  }

  /// Полный выход. Сначала `setPreventClose(false)` чтобы [onWindowClose]
  /// не перехватил закрытие и реально закрылся процесс. VpnService при
  /// этом убьёт sing-box.exe через taskkill (см. dispose-цепочку).
  Future<void> _quit() async {
    try {
      await windowManager.setPreventClose(false);
      await windowManager.close();
    } catch (_) {
      // На крайний случай — жёстко.
      exit(0);
    }
  }
}
