import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../services/storage_service.dart';

/// Список серверов, тянем при первом обращении и при ручном refresh.
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
/// (`selected_server_id`); этот провайдер читает его при старте и
/// сохраняет при изменении.
///
/// Если в сторадже сервер не помечен или его ID нет в актуальном
/// списке — выбираем **первый активный**. Это даёт sensible default
/// для свежеустановленного приложения.
final selectedServerProvider = NotifierProvider<SelectedServerController,
    HundlerServer?>(SelectedServerController.new);

class SelectedServerController extends Notifier<HundlerServer?> {
  late final StorageService _storage;

  @override
  HundlerServer? build() {
    _storage = StorageService.instance;
    // Слушаем список серверов — как только он загрузится / обновится,
    // переустанавливаем выбранный (если текущего нет в списке).
    ref.listen<AsyncValue<List<HundlerServer>>>(serversProvider, (prev, next) {
      next.whenData(_reconcile);
    });
    // Первичная инициализация — если уже есть закешированный список.
    // `_reconcile` — async, поэтому build() возвращает initial null;
    // state установится позже из _reconcile(). НЕЛЬЗЯ читать `state`
    // внутри build() до того как он вернёт значение — иначе Riverpod
    // кинет "Tried to read the state of an uninitialized provider".
    final cached = ref.read(serversProvider).valueOrNull;
    if (cached != null) {
      _reconcile(cached);
    }
    return null;
  }

  /// Согласовать текущее значение с актуальным списком серверов.
  /// Вызывается каждый раз когда `serversProvider` отдаёт новые данные.
  Future<void> _reconcile(List<HundlerServer> servers) async {
    if (servers.isEmpty) {
      state = null;
      return;
    }
    final saved = await _storage.getSelectedServerId();
    HundlerServer? picked;
    if (saved != null) {
      picked = servers.cast<HundlerServer?>().firstWhere(
            (s) => s?.id == saved,
            orElse: () => null,
          );
    }
    picked ??= servers.first;
    state = picked;
  }

  /// Явный выбор пользователя — обновляем state + персистим.
  Future<void> select(HundlerServer server) async {
    state = server;
    await _storage.setSelectedServerId(server.id);
  }
}
