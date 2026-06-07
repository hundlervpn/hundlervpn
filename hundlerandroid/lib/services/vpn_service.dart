import 'dart:async';

import 'package:flutter/services.dart';

/// Возможные состояния туннеля.
enum VpnConnectionStatus {
  disconnected,
  connecting,
  connected,
  disconnecting,
  error;

  static VpnConnectionStatus fromName(String? raw) {
    switch (raw) {
      case 'connecting':
        return VpnConnectionStatus.connecting;
      case 'connected':
        return VpnConnectionStatus.connected;
      case 'disconnecting':
        return VpnConnectionStatus.disconnecting;
      case 'error':
        return VpnConnectionStatus.error;
      case 'disconnected':
      default:
        return VpnConnectionStatus.disconnected;
    }
  }
}

/// Снимок статистики туннеля.
class VpnStats {
  const VpnStats({
    required this.uploadBytes,
    required this.downloadBytes,
    required this.sinceMs,
  });

  final int uploadBytes;
  final int downloadBytes;
  final int sinceMs;

  static const empty = VpnStats(uploadBytes: 0, downloadBytes: 0, sinceMs: 0);
}

/// Обёртка над platform channel `com.hundlervpn.android/vpn`.
///
/// Сейчас это **заглушка**: нативная сторона ещё не написана. Все
/// методы возвращают разумные дефолты, чтобы Flutter-код можно было
/// разрабатывать без рабочего sing-box.
///
/// Когда будет готов Kotlin-side (`HundlerVpnService` + `libcore.aar`),
/// этот класс не нужно будет переписывать — он просто начнёт получать
/// реальные ответы от MethodChannel.
class VpnService {
  VpnService._();

  static final VpnService instance = VpnService._();

  static const _method = MethodChannel('com.hundlervpn.android/vpn');
  static const _events = EventChannel('com.hundlervpn.android/vpn-events');

  final StreamController<VpnConnectionStatus> _statusController =
      StreamController<VpnConnectionStatus>.broadcast();

  Stream<VpnConnectionStatus> get statusStream => _statusController.stream;
  VpnConnectionStatus _lastStatus = VpnConnectionStatus.disconnected;
  VpnConnectionStatus get lastStatus => _lastStatus;

  StreamSubscription<dynamic>? _eventsSub;

  /// Подписывается на события от нативной стороны. Если нативной
  /// стороны нет (пока что и нет) — `EventChannel.receiveBroadcastStream`
  /// просто никогда не отправит событие, и мы тихо живём.
  void attach() {
    _eventsSub ??= _events.receiveBroadcastStream().listen(
      _onNativeEvent,
      onError: (Object _) {
        // Native-стороны нет — игнорим. В release-сборке нативная
        // часть всегда будет, поэтому ошибки тут — баг.
      },
    );
  }

  void dispose() {
    _eventsSub?.cancel();
    _eventsSub = null;
    _statusController.close();
  }

  void _onNativeEvent(dynamic raw) {
    if (raw is! Map) return;
    final type = raw['type'] as String?;
    if (type == 'status') {
      final status = VpnConnectionStatus.fromName(raw['value'] as String?);
      _lastStatus = status;
      _statusController.add(status);
    }
  }

  /// Запрашивает у системы разрешение на VPN. Показывается one-time диалог
  /// «Разрешить приложению создать VPN-туннель?». Результат кешируется
  /// системой — повторно показан не будет.
  Future<bool> prepare() async {
    try {
      final granted = await _method.invokeMethod<bool>('prepare');
      return granted ?? false;
    } on MissingPluginException {
      // Native не подключён — для разработки UI считаем что разрешение есть.
      return true;
    } on PlatformException {
      return false;
    }
  }

  /// Стартует туннель с переданным sing-box JSON конфигом.
  Future<void> connect({
    required String configJson,
    String profileName = 'Hundler VPN',
  }) async {
    try {
      _lastStatus = VpnConnectionStatus.connecting;
      _statusController.add(_lastStatus);
      await _method.invokeMethod<void>('start', <String, dynamic>{
        'config': configJson,
        'profileName': profileName,
      });
    } on MissingPluginException {
      // Stub: симулируем успешное подключение через 1 с.
      await Future<void>.delayed(const Duration(seconds: 1));
      _lastStatus = VpnConnectionStatus.connected;
      _statusController.add(_lastStatus);
    } on PlatformException catch (e) {
      _lastStatus = VpnConnectionStatus.error;
      _statusController.add(_lastStatus);
      throw VpnException(e.message ?? 'VPN start failed', e.code);
    }
  }

  Future<void> disconnect() async {
    try {
      _lastStatus = VpnConnectionStatus.disconnecting;
      _statusController.add(_lastStatus);
      await _method.invokeMethod<void>('stop');
    } on MissingPluginException {
      // Stub.
    } finally {
      _lastStatus = VpnConnectionStatus.disconnected;
      _statusController.add(_lastStatus);
    }
  }

  Future<VpnConnectionStatus> getStatus() async {
    try {
      final raw = await _method.invokeMethod<String>('getStatus');
      return VpnConnectionStatus.fromName(raw);
    } on MissingPluginException {
      return _lastStatus;
    }
  }

  Future<VpnStats> getStats() async {
    try {
      final raw = await _method
          .invokeMapMethod<String, dynamic>('getStats');
      if (raw == null) return VpnStats.empty;
      return VpnStats(
        uploadBytes: (raw['uploadBytes'] as num?)?.toInt() ?? 0,
        downloadBytes: (raw['downloadBytes'] as num?)?.toInt() ?? 0,
        sinceMs: (raw['sinceMs'] as num?)?.toInt() ?? 0,
      );
    } on MissingPluginException {
      return VpnStats.empty;
    }
  }
}

class VpnException implements Exception {
  const VpnException(this.message, [this.code]);
  final String message;
  final String? code;

  @override
  String toString() => 'VpnException($code): $message';
}
