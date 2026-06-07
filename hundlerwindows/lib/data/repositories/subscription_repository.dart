import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart' as pp;

import '../../core/api_client.dart';

/// Репозиторий подписки.
///
/// Поверх [HundlerApi.fetchSubscription] даёт:
///
/// - **Кеш sing-box JSON на диске** (`subscription.json` в
///   `getApplicationSupportDirectory()` = `%APPDATA%\com.hundlervpn.hundler\hundler\`).
///   При запуске приложения сразу видно прошлый конфиг — UI отзывчивее.
///
/// - **Поллинг** по `profile-update-interval` из заголовков ответа.
///   Минимум 1 час — иначе при ротации UUID/SNI клиент быстро устаревает.
///
/// - **Нормализацию ошибок**: бэкенд-блок «лимит устройств» приходит
///   как 200 с `outbounds: null` — этот кейс превращаем в
///   [SubscriptionBlockedException].
///
/// ⚠️ **Не храним конфиг в DPAPI** — DPAPI плохо работает с большими
/// values (>8 КБ). Файл на диске быстрее, а sensitive данные в конфиге
/// (UUID) защищены NTFS-permissions (только текущий user может читать
/// `%APPDATA%\com.hundlervpn.hundler\`).
///
/// Структура — копия из `hundlerandroid/lib/data/repositories/
/// subscription_repository.dart`. Логика идентична.
class SubscriptionRepository {
  SubscriptionRepository({HundlerApi? api}) : _api = api ?? HundlerApi();

  final HundlerApi _api;
  Timer? _pollTimer;
  SubscriptionResponse? _cached;

  static const _cacheFileName = 'subscription.json';

  SubscriptionResponse? get cached => _cached;

  /// Загрузить с диска — вызвать один раз при старте, чтобы Home мог
  /// показать кеш до первого сетевого запроса.
  Future<SubscriptionResponse?> loadCached() async {
    try {
      final f = await _cacheFile();
      if (!await f.exists()) return null;
      final raw = await f.readAsString();
      final meta = jsonDecode(raw) as Map<String, dynamic>;
      final config = meta['configJson'] as String? ?? '';
      if (config.isEmpty) return null;
      _cached = SubscriptionResponse(
        configJson: config,
        profileTitle: meta['profileTitle'] as String?,
        profileUpdateIntervalHours:
            (meta['profileUpdateIntervalHours'] as num?)?.toInt() ?? 1,
        userInfo: null,
      );
      return _cached;
    } catch (_) {
      return null;
    }
  }

  /// Запросить свежую подписку + обновить кеш.
  Future<SubscriptionResponse> refresh(String subToken) async {
    final res = await _api.fetchSubscription(subToken);

    if (res.isBlocked) {
      throw const SubscriptionBlockedException(
        'Лимит устройств или истекшая подписка — '
        'управление устройствами в мини-аппе hundlervpn.xyz.',
      );
    }

    _cached = res;
    await _writeCache(res);
    return res;
  }

  /// Запустить автополлинг.
  void startPolling({required String subToken}) {
    stopPolling();

    Future<void> tick() async {
      try {
        final res = await refresh(subToken);
        final hours = res.profileUpdateIntervalHours.clamp(1, 24);
        _pollTimer = Timer(Duration(hours: hours), tick);
      } catch (_) {
        _pollTimer = Timer(const Duration(hours: 1), tick);
      }
    }

    _pollTimer = Timer(const Duration(seconds: 1), tick);
  }

  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  /// Очистить всё — при logout.
  Future<void> clear() async {
    stopPolling();
    _cached = null;
    try {
      final f = await _cacheFile();
      if (await f.exists()) await f.delete();
    } catch (_) {
      // Не критично.
    }
  }

  Future<File> _cacheFile() async {
    final dir = await pp.getApplicationSupportDirectory();
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return File('${dir.path}${Platform.pathSeparator}$_cacheFileName');
  }

  Future<void> _writeCache(SubscriptionResponse res) async {
    try {
      final f = await _cacheFile();
      await f.writeAsString(
        jsonEncode({
          'configJson': res.configJson,
          'profileTitle': res.profileTitle,
          'profileUpdateIntervalHours': res.profileUpdateIntervalHours,
          'savedAt': DateTime.now().toIso8601String(),
        }),
        flush: true,
      );
    } catch (_) {
      // Кеш — это опциональная оптимизация.
    }
  }

  void dispose() {
    stopPolling();
  }
}

class SubscriptionBlockedException implements Exception {
  const SubscriptionBlockedException(this.message);
  final String message;
  @override
  String toString() => 'SubscriptionBlockedException: $message';
}
