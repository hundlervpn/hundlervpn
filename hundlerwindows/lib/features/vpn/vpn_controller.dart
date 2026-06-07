import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../data/repositories/subscription_repository.dart';
import '../../services/singbox_config_patch.dart';
import '../../services/vpn_service.dart';
import '../auth/auth_controller.dart';
import '../servers/servers_controller.dart';
import '../subscription/subscription_controller.dart';
import 'vpn_mode_controller.dart';
import 'vpn_protocol_controller.dart';

/// Singleton — VpnService живёт всё приложение.
final vpnServiceProvider = Provider<VpnService>((ref) => VpnService.instance);

/// Текущий статус туннеля. Подписан на VpnService.statusStream.
final vpnStatusProvider = StreamProvider<VpnStatus>((ref) {
  final service = ref.read(vpnServiceProvider);
  // Стартовое значение + последующие изменения.
  return Stream<VpnStatus>.multi((controller) {
    controller.add(service.status);
    final sub = service.statusStream.listen(controller.add);
    controller.onCancel = () => sub.cancel();
  });
});

/// Контроллер логики Connect/Disconnect.
///
/// Делает три вещи:
///   1. При Connect — тянет свежий sing-box JSON через
///      [SubscriptionRepository.refresh] (либо берёт кеш если сеть
///      упала и кеш есть).
///   2. (опционально) Подменяет `selected` outbound в JSON на ID
///      выбранного юзером сервера. *(MVP: не подменяем — конфиг
///      бэкенда сам содержит auto-selector.)*
///   3. Запускает [VpnService.start].
final vpnControllerProvider =
    NotifierProvider<VpnController, VpnControllerState>(VpnController.new);

class VpnControllerState {
  const VpnControllerState({this.busy = false, this.lastError});

  /// `true` пока идёт Connect/Disconnect (запретить повторные клики).
  final bool busy;

  /// Последняя ошибка для UI-баннера. Очищается при следующем Connect.
  final String? lastError;

  VpnControllerState copyWith({bool? busy, String? lastError}) {
    return VpnControllerState(
      busy: busy ?? this.busy,
      lastError: lastError,
    );
  }
}

class VpnController extends Notifier<VpnControllerState> {
  @override
  VpnControllerState build() => const VpnControllerState();

  Future<void> connect() async {
    if (state.busy) return;
    state = state.copyWith(busy: true, lastError: null);

    try {
      final auth = ref.read(authControllerProvider);
      if (auth is! AuthSignedIn) {
        state =
            state.copyWith(busy: false, lastError: 'Сначала войдите в аккаунт');
        return;
      }

      final subToken = auth.state?.subToken;
      if (subToken == null || subToken.isEmpty) {
        state = state.copyWith(
          busy: false,
          lastError:
              'У вас нет активной подписки. Активируйте триал в мини-аппе.',
        );
        return;
      }

      // 1. Свежий sing-box JSON.
      final repo = ref.read(subscriptionRepositoryProvider);
      SubscriptionResponse sub;
      try {
        sub = await repo.refresh(subToken);
      } on SubscriptionBlockedException catch (e) {
        state = state.copyWith(busy: false, lastError: e.message);
        return;
      } catch (e) {
        // Сеть упала — пробуем кеш.
        final cached = repo.cached ?? await repo.loadCached();
        if (cached != null) {
          sub = cached;
        } else {
          state = state.copyWith(
            busy: false,
            lastError: 'Не удалось загрузить подписку: $e',
          );
          return;
        }
      }

      // 2. Проверяем доступность выбранного протокола в конфиге.
      //    Если юзер выбрал Hysteria, но бэкенд не отдал hysteria2
      //    outbound (например Hy2 сейчас удалён со стека) — показываем
      //    понятную ошибку вместо FATAL от sing-box.
      final protocol = ref.read(vpnProtocolProvider);
      if (!SingboxConfigPatch.hasOutboundOfType(
          sub.configJson, protocol.singboxType)) {
        state = state.copyWith(
          busy: false,
          lastError:
              'Протокол ${protocol.displayName} недоступен на этом аккаунте. '
              'Выберите VLESS или попросите администратора добавить '
              '${protocol.singboxType} outbound в /api/sub.',
        );
        return;
      }

      // 3. Фильтруем outbound'ы по выбранному протоколу — иначе
      //    selector default будет указывать на VLESS-tag и трафик
      //    пойдёт через VLESS даже если юзер выбрал Hy2.
      var configJson = SingboxConfigPatch.filterOutboundsByProtocol(
        configJson: sub.configJson,
        keepType: protocol.singboxType,
      );

      // 4. Если юзер выбрал конкретную локацию — патчим JSON: подменяем
      //    selector.default на outbound нужной страны. Если selectedServer
      //    == null (auto) — оставляем оригинальный конфиг с auto-selector
      //    бэкенда (он сам выберет proxyTags[0]).
      final selected = ref.read(selectedServerProvider);
      if (selected != null) {
        configJson = SingboxConfigPatch.pinSelectedServer(
          configJson: configJson,
          countryIso: selected.country,
          protocolType: protocol.singboxType,
        );
      }

      // КРИТИЧНО: бэкенд отдаёт конфиг без inbound (он клиент-
      // специфичный). Что инжектить — зависит от режима VPN:
      //   - tun: системный туннель (default, перехватывает весь трафик ОС)
      //   - proxy: HTTP+SOCKS5 на 127.0.0.1:7890 (юзер сам прописывает
      //           в браузере / приложении)
      final mode = ref.read(vpnModeProvider);
      if (mode == VpnMode.proxy) {
        configJson = SingboxConfigPatch.injectProxyInbound(configJson);
      } else {
        configJson = SingboxConfigPatch.injectTunInboundIfMissing(configJson);
      }

      // КРИТИЧНО: серверные домены (de.hundlervpn.xyz и т.п.) должны
      // резолвиться через bootstrap-DNS (1.1.1.1 → direct), иначе
      // chicken-and-egg: dns-proxy идёт через VLESS, но VLESS не
      // подключен потому что не знает IP сервера → timeout.
      configJson = SingboxConfigPatch.injectServerDomainBootstrap(configJson);

      // sing-box 1.12+ ужесточил валидацию detour в DNS серверах:
      // `detour: "direct"` ссылающийся на пустой direct-outbound
      // приводит к FATAL "detour to an empty direct outbound makes
      // no sense". Чистим эти ссылки — sing-box использует дефолтный
      // route (= direct) когда detour не указан.
      configJson = SingboxConfigPatch.applySingbox12Compat(configJson);

      // 3. Запуск sing-box.
      final vpn = ref.read(vpnServiceProvider);
      final ok = await vpn.start(configJson: configJson);
      if (!ok) {
        state = state.copyWith(
          busy: false,
          lastError: vpn.lastError ?? 'Не удалось запустить туннель',
        );
        return;
      }

      // 4. Запустить поллинг — раз в час подтянем новый конфиг и
      //    запишем кеш. На текущий sing-box.exe это не повлияет
      //    (он уже работает с прошлым конфигом), новый будет
      //    использован при следующем Connect.
      repo.startPolling(subToken: subToken);

      state = state.copyWith(busy: false);
    } catch (e) {
      state = state.copyWith(busy: false, lastError: 'Ошибка: $e');
    }
  }

  Future<void> disconnect() async {
    if (state.busy) return;
    state = state.copyWith(busy: true, lastError: null);
    try {
      await ref.read(vpnServiceProvider).stop();
    } catch (e) {
      state = state.copyWith(busy: false, lastError: 'Ошибка отключения: $e');
      return;
    }
    state = state.copyWith(busy: false);
  }

  Future<void> toggle() async {
    final s = ref.read(vpnStatusProvider).value ?? VpnStatus.disconnected;
    if (s == VpnStatus.connected || s == VpnStatus.connecting) {
      await disconnect();
    } else {
      // selectedServer читается внутри connect() — там же делается
      // SingboxConfigPatch.pinSelectedServer перед vpn.start.
      await connect();
    }
  }
}
