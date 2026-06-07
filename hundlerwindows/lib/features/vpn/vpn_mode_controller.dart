import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../services/storage_service.dart';

/// Режим работы VPN.
///
/// - **[tun]**: системный TUN-туннель (через wintun). **Весь** трафик
///   ОС идёт через VPN. Default. Требует UAC.
/// - **[proxy]**: HTTP+SOCKS5 inbound на `127.0.0.1:7890`. Юзер должен
///   вручную прописать прокси в браузере / приложении. ОС-трафик идёт
///   мимо. **Не** требует admin (если включить mixed-listen — UAC ок).
///   Полезно когда:
///     - юзер не хочет туннелировать **всё** (только Chrome);
///     - VPN-провайдер блокирован на уровне ОС firewall'а;
///     - тестирование без правки роутинг-таблицы.
enum VpnMode { tun, proxy }

/// Текущий режим VPN. Источник правды — [StorageService] (поле `vpn_mode`).
final vpnModeProvider =
    NotifierProvider<VpnModeController, VpnMode>(VpnModeController.new);

class VpnModeController extends Notifier<VpnMode> {
  late final StorageService _storage;

  @override
  VpnMode build() {
    _storage = StorageService.instance;
    // Асинхронно подгружаем из storage. До этого момента — default `tun`.
    _load();
    return VpnMode.tun;
  }

  Future<void> _load() async {
    final raw = await _storage.getVpnMode();
    if (raw == 'proxy') {
      state = VpnMode.proxy;
    } else {
      state = VpnMode.tun;
    }
  }

  Future<void> set(VpnMode mode) async {
    state = mode;
    await _storage.setVpnMode(mode == VpnMode.proxy ? 'proxy' : 'tun');
  }
}
