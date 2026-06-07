import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../services/storage_service.dart';
import '../vpn/vpn_protocol_controller.dart';

/// Список серверов — `/api/servers`.
///
/// `AsyncValue<List<HundlerServer>>` — встроенные состояния
/// loading / error / data; UI читает через `.when(...)`.
final serversProvider =
    AsyncNotifierProvider<ServersController, List<HundlerServer>>(
  ServersController.new,
);

class ServersController extends AsyncNotifier<List<HundlerServer>> {
  late final HundlerApi _api;

  @override
  Future<List<HundlerServer>> build() async {
    _api = HundlerApi();
    return _api.fetchServersTyped();
  }

  /// Pull-to-refresh: повторно тянем `/api/servers`.
  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => _api.fetchServersTyped());
  }
}

/// Выбранный сервер. Источник правды — [StorageService]
/// (`selected_server_id`).
final selectedServerProvider = NotifierProvider<SelectedServerController,
    HundlerServer?>(SelectedServerController.new);

class SelectedServerController extends Notifier<HundlerServer?> {
  late final StorageService _storage;

  @override
  HundlerServer? build() {
    _storage = StorageService.instance;
    ref.listen<AsyncValue<List<HundlerServer>>>(serversProvider, (prev, next) {
      next.whenData((servers) => _reconcile(servers));
    });
    // Re-pick when пользователь переключает протокол: если текущий
    // выбранный сервер не поддерживает новый протокол — авто-выбираем
    // первый из списка, который поддерживает. Сохраняет UX без runtime-
    // ошибок «протокол недоступен на сервере X».
    ref.listen<VpnProtocol>(vpnProtocolProvider, (prev, next) {
      if (prev == next) return;
      final servers = ref.read(serversProvider).valueOrNull;
      if (servers != null) {
        _reconcile(servers, protocolOverride: next);
      }
    });
    final cached = ref.read(serversProvider).valueOrNull;
    if (cached != null) {
      _reconcile(cached);
    }
    return null;
  }

  /// Согласовать выбранный сервер с актуальным списком серверов и
  /// текущим протоколом. Алгоритм:
  ///   1) Берём сохранённый id (если есть) и проверяем что он есть в
  ///      списке И поддерживает текущий протокол.
  ///   2) Если нет — берём первый сервер в списке, поддерживающий
  ///      протокол.
  ///   3) Если таких нет — выбираем первый из всего списка (fallback,
  ///      чтобы UI не пустовал; при попытке connect клиент покажет
  ///      «протокол недоступен» через `vpn_controller`).
  Future<void> _reconcile(
    List<HundlerServer> servers, {
    VpnProtocol? protocolOverride,
  }) async {
    if (servers.isEmpty) {
      state = null;
      return;
    }
    final VpnProtocol protocol =
        protocolOverride ?? ref.read(vpnProtocolProvider);
    final filterTag = protocol.serverFilterTag;
    final supported = servers.where((s) => s.supports(filterTag)).toList();

    final saved = await _storage.getSelectedServerId();
    HundlerServer? picked;
    if (saved != null) {
      picked = supported.cast<HundlerServer?>().firstWhere(
            (s) => s?.id == saved,
            orElse: () => null,
          );
      // Если сохранённый сервер существует но не поддерживает протокол —
      // не используем его, перейдём ниже к авто-выбору.
    }
    picked ??= supported.isNotEmpty ? supported.first : servers.first;

    state = picked;
    // Сохраняем новый id только когда реально переключили на другой
    // сервер из-за смены протокола (иначе перетираем выбор юзера на
    // первом холодном старте).
    if (saved == null || saved != picked.id) {
      await _storage.setSelectedServerId(picked.id);
    }
  }

  Future<void> select(HundlerServer server) async {
    state = server;
    await _storage.setSelectedServerId(server.id);
  }
}
