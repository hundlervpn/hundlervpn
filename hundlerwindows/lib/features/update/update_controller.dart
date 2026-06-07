import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../services/update_checker.dart';

/// AsyncProvider — проверяет обновления **один раз** при первом
/// `watch`. Если есть новая версия → `value != null`. Иначе `null`.
///
/// Не делает retry сам. Если хочешь повторить — `ref.invalidate(
/// updateInfoProvider)`. Это даст UI вернуться в loading и заново
/// дёрнуть endpoint.
final updateInfoProvider = FutureProvider<UpdateInfo?>((ref) async {
  return UpdateChecker.instance.check();
});
