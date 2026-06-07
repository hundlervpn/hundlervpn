import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../services/storage_service.dart';

/// VPN-протокол. Влияет на то какие outbounds оставлять в sing-box
/// JSON (`SingboxConfigPatch.filterOutboundsByProtocol`).
///
/// - **[vless]**: VLESS + Reality + XUDP. Default, работает на всех
///   серверах HundlerVPN. Стелс-протокол, поднимает поддельный TLS-
///   handshake с легитимным фронт-сайтом (steal-mode Reality), DPI
///   видит обычный HTTPS.
///
/// - **[hysteria]**: Hysteria2 (UDP-based). Быстрее VLESS на нестабильной
///   сети — собственный congestion control. Не стелс — DPI видит UDP
///   на нестандартном порту. Полезен когда:
///     - провайдер шейпит TCP трафик но пропускает UDP;
///     - юзер на мобильном инете, где UDP стабильнее.
///   **Доступен только если бэкенд `/api/sub/{token}` отдаёт
///   hysteria2-outbound в sing-box JSON.** В моей памяти зафиксировано
///   что Hy2 был удалён 2026-05-08 — нужно вернуть сервер и outbound.
enum VpnProtocol { vless, hysteria }

extension VpnProtocolX on VpnProtocol {
  /// Тип outbound'а в sing-box JSON. Используется для фильтрации
  /// `outbounds[]` в `SingboxConfigPatch.filterOutboundsByProtocol`.
  /// Строго совпадает со значением `outbound.type` в JSON.
  String get singboxType {
    switch (this) {
      case VpnProtocol.vless:
        return 'vless';
      case VpnProtocol.hysteria:
        return 'hysteria2';
    }
  }

  /// Короткий tag, который шлёт бэкенд в `/api/servers` поле `protocols`.
  /// **Без** «2» в конце — это API-контракт, см.
  /// `hundlerminiapp/app/api/servers/route.ts` v62.
  String get serverFilterTag {
    switch (this) {
      case VpnProtocol.vless:
        return 'vless';
      case VpnProtocol.hysteria:
        return 'hysteria';
    }
  }

  String get displayName {
    switch (this) {
      case VpnProtocol.vless:
        return 'VLESS';
      case VpnProtocol.hysteria:
        return 'Hysteria';
    }
  }
}

final vpnProtocolProvider =
    NotifierProvider<VpnProtocolController, VpnProtocol>(
        VpnProtocolController.new);

class VpnProtocolController extends Notifier<VpnProtocol> {
  late final StorageService _storage;

  @override
  VpnProtocol build() {
    _storage = StorageService.instance;
    _load();
    return VpnProtocol.vless;
  }

  Future<void> _load() async {
    final raw = await _storage.getVpnProtocol();
    if (raw == 'hysteria') {
      state = VpnProtocol.hysteria;
    } else {
      state = VpnProtocol.vless;
    }
  }

  Future<void> set(VpnProtocol p) async {
    state = p;
    await _storage.setVpnProtocol(
      p == VpnProtocol.hysteria ? 'hysteria' : 'vless',
    );
  }
}
