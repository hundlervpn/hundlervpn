import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../data/repositories/subscription_repository.dart';
import '../auth/auth_controller.dart';

/// Singleton-провайдер репозитория подписки. Живёт всё приложение.
/// При logout надо вызвать `repo.clear()` — делается в [AuthController].
final subscriptionRepositoryProvider = Provider<SubscriptionRepository>((ref) {
  final repo = SubscriptionRepository();
  ref.onDispose(repo.dispose);
  return repo;
});

/// Загружает свежий sing-box JSON для подключения.
///
/// Возвращает `null` если у юзера нет подписки (нет `subscriptionUrl`)
/// — UI должен показать сообщение "оформите подписку".
///
/// Кидает [SubscriptionBlockedException] если бэкенд вернул блок-ответ
/// (лимит устройств / истекшая подписка) — UI показывает remark.
Future<SubscriptionResponse?> loadSubscription(WidgetRef ref) async {
  final auth = ref.read(authControllerProvider);
  if (auth is! AuthSignedIn) return null;

  final subToken = auth.state?.subToken;
  if (subToken == null || subToken.isEmpty) {
    return null;
  }

  final repo = ref.read(subscriptionRepositoryProvider);
  return repo.refresh(subToken);
}
