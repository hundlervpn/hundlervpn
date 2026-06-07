import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hundler/app.dart';

void main() {
  testWidgets('HundlerApp рисуется без исключений', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: HundlerApp()),
    );
    // Первый кадр — экран должен быть без ошибок.
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
