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
///   `getApplicationSupportDirectory()`). Зачем: при запуске приложения
///   мы можем сразу поднять туннель с прошлого конфига — не ждать ответа
///   сервера. Позже в фоне дёрнем свежий и перезапишем.
///
/// - **Поллинг** по `profile-update-interval` из заголовков ответа.
///   Таймер живёт пока жив репозиторий — пересоздавать при logout
///   через `dispose()`.
///
/// - **Нормализацию ошибок**: бэкенд-блок «лимит устройств» приходит
///   как 200 с `outbounds: null` — этот кейс превращаем в
///   [SubscriptionBlockedException] чтобы UI мог показать сообщение.
///
/// ⚠️ **Не храним конфиг в `flutter_secure_storage`**. Он может быть
/// 30-50 КБ, а `EncryptedSharedPreferences` заметно тормозит на значениях
/// > 8 КБ (каждая запись шифруется целиком). Файл на диске быстрее, а
/// sensitive данные в конфиге (UUID) защищены тем же Android Keystore
/// через FBE (file-based encryption) — уровень безопасности сравним.
class SubscriptionRepository {
  SubscriptionRepository({HundlerApi? api}) : _api = api ?? HundlerApi();

  final HundlerApi _api;
  Timer? _pollTimer;
  SubscriptionResponse? _cached;

  static const _cacheFileName = 'subscription.json';

  /// Текущий закешированный ответ (если был). Null если никогда не
  /// подтягивали.
  SubscriptionResponse? get cached => _cached;

  /// Загрузить с диска — вызвать ОДИН раз при старте приложения, чтобы
  /// экран Home мог показать `_cached` до первого сетевого запроса.
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
        userInfo: null, // userInfo не кешируем — пусть подтянется с сетью
      );
      return _cached;
    } catch (_) {
      return null;
    }
  }

  /// Запросить свежую подписку + обновить кеш.
  ///
  /// Кидает [SubscriptionBlockedException] если бэкенд вернул блок-ответ
  /// (например лимит устройств). UI должен показать сообщение и НЕ
  /// пытаться запустить туннель.
  Future<SubscriptionResponse> refresh(String subToken) async {
    final res = await _api.fetchSubscription(subToken);

    if (res.isBlocked) {
      throw const SubscriptionBlockedException(
        'Лимит устройств или истекшая подписка — '
        'см. управление устройствами в мини-аппе.',
      );
    }

    _cached = res;
    await _writeCache(res);
    return res;
  }

  /// Запустить автополлинг. Дёргается сразу + потом каждые N часов
  /// (N из `profile-update-interval`, минимум 1 час).
  void startPolling({required String subToken}) {
    stopPolling();

    Future<void> tick() async {
      try {
        final res = await refresh(subToken);
        // Пересчитать интервал — сервер может его менять.
        final hours = res.profileUpdateIntervalHours.clamp(1, 24);
        _pollTimer = Timer(Duration(hours: hours), tick);
      } catch (_) {
        // Не падаем — пробуем ещё через час.
        _pollTimer = Timer(const Duration(hours: 1), tick);
      }
    }

    // Первый запуск — через секунду чтобы дать UI отрисоваться.
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
    return File('${dir.path}/$_cacheFileName');
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
      // Не падаем — кеш это опциональная оптимизация.
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
