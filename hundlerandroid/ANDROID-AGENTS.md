# ANDROID-AGENTS — свод правил Android-клиента Hundler VPN

> **Что это**: платформенный свод правил для проекта
> `hundlerandroid` (Flutter UI + Kotlin VPN-ядро на sing-box).
>
> **Не путать с `MINIAPP-AGENTS.md`** (Next.js бэкенд) и
> `AGENTS.md` (корневые общие правила монорепо).

Перед началом работы прочитай:

1. **`HundlerAll/AGENTS.md`** — общие правила бренда / API / VPN-протокола.
2. **`hundlerminiapp/MINIAPP-AGENTS.md`** — как работают серверы
   и подписка (формат sing-box JSON, SNI-пул, UUID-ротация).

Этот файл описывает **только** Android-специфику.

---

## Технический стек

- **UI**: Flutter (Dart, stable channel ≥ 3.24).
- **State**: `flutter_riverpod` + `freezed` + `json_serializable`.
- **HTTP**: `dio` с интерцепторами (auth, retry, logging).
- **Native VPN core**: **sing-box** через готовый Android-binding
  `libcore.aar` (форкаем у Hiddify-Next или собираем сами через `gomobile bind`).
- **Native язык**: Kotlin (только VPNService + JNI к sing-box).
- **Минимальный SDK**: 24 (Android 7.0). Ниже — нет VPNService API
  с `addDisallowedApplication`.
- **Target SDK**: 34 (Android 14). Требование Google Play на 2026.
- **Архитектуры**: `arm64-v8a`, `armeabi-v7a`, `x86_64` (для эмулятора).

### Зависимости pubspec (опорный список)

```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.6.0
  riverpod_annotation: ^2.6.0
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0
  dio: ^5.7.0
  shared_preferences: ^2.3.0
  flutter_secure_storage: ^9.2.0    # для sub_token и JWT
  url_launcher: ^6.3.0
  package_info_plus: ^8.1.0
  device_info_plus: ^11.1.0          # ANDROID_ID -> X-HWID
  lucide_icons_flutter: ^3.0.0       # консистентно с lucide-react в вебе
  google_fonts: ^6.2.0               # Inter + Syncopate
  flutter_animate: ^4.5.0            # дыхание тигра
  cached_network_image: ^3.4.0
```

dev-зависимости:

```yaml
dev_dependencies:
  build_runner: ^2.4.0
  freezed: ^2.5.0
  json_serializable: ^6.8.0
  riverpod_generator: ^2.6.0
  custom_lint: ^0.6.0
  riverpod_lint: ^2.6.0
  flutter_lints: ^5.0.0
```

---

## Структура проекта

```
hundlerandroid/
├── ANDROID-AGENTS.md
├── README.md
├── pubspec.yaml
├── analysis_options.yaml
├── android/                       ← нативный модуль
│   ├── app/
│   │   ├── build.gradle.kts
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   ├── kotlin/com/hundlervpn/android/
│   │   │   │   ├── MainActivity.kt
│   │   │   │   ├── vpn/
│   │   │   │   │   ├── HundlerVpnService.kt    ← VPNService + sing-box
│   │   │   │   │   ├── VpnChannel.kt           ← MethodChannel/EventChannel
│   │   │   │   │   └── ConfigStore.kt          ← хранит sing-box JSON
│   │   │   │   └── util/
│   │   │   └── res/
│   │   └── libs/
│   │       └── libcore.aar                     ← sing-box binding
│   └── build.gradle.kts
├── assets/
│   ├── images/
│   │   ├── tiger.png                  ← скопировать из hundlerminiapp/public/
│   │   └── tiger-source.png
│   └── fonts/                         ← если bundling, иначе через google_fonts
├── lib/
│   ├── main.dart
│   ├── app.dart                        ← MaterialApp + theme + router
│   ├── core/
│   │   ├── theme.dart                  ← Hundler ThemeData (red/black)
│   │   ├── colors.dart                 ← дизайн-токены
│   │   ├── typography.dart             ← Inter + Syncopate
│   │   ├── api_client.dart             ← Dio + interceptors
│   │   └── error.dart
│   ├── data/
│   │   ├── models/
│   │   │   ├── server.dart             ← @freezed
│   │   │   ├── subscription.dart
│   │   │   ├── user.dart
│   │   │   └── device.dart
│   │   └── repositories/
│   │       ├── auth_repository.dart
│   │       ├── subscription_repository.dart
│   │       └── server_repository.dart
│   ├── features/
│   │   ├── auth/
│   │   │   ├── login_screen.dart       ← Telegram / email / Google
│   │   │   └── auth_controller.dart
│   │   ├── home/
│   │   │   ├── home_screen.dart        ← тигр + Connect + статус
│   │   │   ├── widgets/
│   │   │   │   ├── tiger_logo.dart
│   │   │   │   ├── connect_button.dart
│   │   │   │   └── status_card.dart
│   │   │   └── home_controller.dart
│   │   ├── servers/
│   │   │   ├── servers_screen.dart
│   │   │   └── server_card.dart
│   │   ├── settings/
│   │   ├── payments/
│   │   └── devices/
│   ├── services/
│   │   ├── vpn_service.dart            ← обёртка над platform channel
│   │   ├── auth_service.dart
│   │   └── storage_service.dart        ← flutter_secure_storage
│   ├── l10n/
│   │   ├── app_ru.arb
│   │   └── app_en.arb
│   └── widgets/                        ← общие: Button, Card, Sheet
└── test/
```

---

## VPN-интеграция (платформенный канал)

### Каналы

```dart
// lib/services/vpn_service.dart
const _method = MethodChannel('com.hundlervpn.android/vpn');
const _events = EventChannel('com.hundlervpn.android/vpn-events');
```

### Методы (Dart → Kotlin)

| Метод            | Аргументы                            | Возврат                            |
|------------------|--------------------------------------|------------------------------------|
| `prepare`        | —                                    | `bool granted` (системное VPN-разрешение) |
| `start`          | `{ "config": "<sing-box JSON>", "profileName": "Hundler VPN" }` | `void` |
| `stop`           | —                                    | `void`                             |
| `getStatus`      | —                                    | `"disconnected" \| "connecting" \| "connected" \| "error"` |
| `getStats`       | —                                    | `{ uploadBytes, downloadBytes, sinceMs }` |
| `selectServer`   | `{ "tag": "<server tag>" }`          | `void` (sing-box selector outbound) |

### События (Kotlin → Dart, через EventChannel)

```kotlin
// VpnChannel.kt
sealed class VpnEvent {
  data class StatusChanged(val status: String): VpnEvent()
  data class StatsUpdate(val up: Long, val down: Long): VpnEvent()
  data class Error(val code: String, val message: String): VpnEvent()
}
```

### Важные правила

1. **`prepare` ВСЕГДА перед `start`**. На Android VPNService требует
   one-time системного диалога «Разрешить приложению создать VPN-туннель?».
   Если не вызвать — `start` упадёт с SecurityException. Кешируем результат —
   повторно диалог Android не покажет.
2. **`HundlerVpnService.onStartCommand` = `START_STICKY`**. Если систему
   убьёт сервис из-за нехватки памяти — он перезапустится, и можно
   восстановить туннель из сохранённого конфига.
3. **`Notification` в foreground service** — обязательно для Android 8+.
   Иначе VPNService прибьют через 5 секунд. Текст уведомления:
   «Hundler VPN — подключено к 🇩🇪 Германия». Иконка — белый тигр-силуэт.
4. **AndroidManifest.xml** должен объявлять:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" />
   <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

   <service
       android:name=".vpn.HundlerVpnService"
       android:permission="android.permission.BIND_VPN_SERVICE"
       android:foregroundServiceType="systemExempted"
       android:exported="false">
     <intent-filter>
       <action android:name="android.net.VpnService" />
     </intent-filter>
   </service>
   ```
5. **`POST_NOTIFICATIONS`** runtime-permission для Android 13+. Без этого
   foreground-service notification просто не покажется → сервис убьют.

### sing-box интеграция (libcore.aar)

Используем готовый `libcore.aar` от **sing-box-for-android**
(<https://github.com/SagerNet/sing-box-for-android>) или Hiddify
(<https://github.com/hiddify/hiddify-app>). Hiddify-вариант чуть толще
но активнее обновляется.

Минимальный API:

```kotlin
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.BoxService

class CoreManager(private val ctx: Context) {
  private var service: BoxService? = null

  fun start(configJson: String) {
    val service = Libbox.newService(configJson, platformInterface)
    service.start()
    this.service = service
  }

  fun stop() {
    service?.close()
    service = null
  }

  fun stats(): Pair<Long, Long> {
    val s = service ?: return 0L to 0L
    return s.queryStats("proxy", "uplink") to s.queryStats("proxy", "downlink")
  }
}
```

`platformInterface` — имплементация `io.nekohasekai.libbox.PlatformInterface`,
которая отдаёт sing-box контроль над TUN-устройством, DNS и роутингом
через нашу `HundlerVpnService`. Подробности — смотри референс в
hiddify-app/`platform/CoreVPNService.kt`.

### Откуда брать конфиг

```dart
// lib/data/repositories/subscription_repository.dart
final res = await dio.get(
  'https://hundlervpn.xyz/api/sub/$subToken',
  options: Options(
    headers: {
      'User-Agent':
          'HundlerVPN/${appVersion} (android; ${osVersion}) sing-box/${singboxVersion}',
      'X-Device-OS': 'android',
      'X-Device-Model': '$brand $model',
      'X-HWID': androidId,
    },
    responseType: ResponseType.plain,
  ),
);
final configJson = res.data as String;
final headers = res.headers;
final updateIntervalHours = int.tryParse(
  headers.value('profile-update-interval') ?? '1',
) ?? 1;
final userInfo = parseUserInfo(headers.value('subscription-userinfo'));
```

### Поллинг подписки

Запрос `/api/sub/{token}` нужно делать:

- При старте приложения.
- При нажатии Connect (свежий конфиг → меньше шансов «invalid request user id»).
- Раз в `profile-update-interval` часов (по умолчанию 1).
- При попытке Connect, если кешу > 5 минут.

Кешировать конфиг в `flutter_secure_storage`. **Не** в обычные
SharedPreferences — там UUID лежит в plain text.

---

## Дизайн-система

Берём токены из `HundlerAll/AGENTS.md` (корневой). Реализация в
`lib/core/theme.dart`:

```dart
final hundlerDarkTheme = ThemeData(
  useMaterial3: true,
  brightness: Brightness.dark,
  colorScheme: const ColorScheme.dark(
    surface: Color(0xFF020202),
    onSurface: Colors.white,
    primary: Color(0xFFEF4444),       // red-500, акцент
    onPrimary: Colors.white,
    secondary: Color(0xFFF97316),     // orange-500
    error: Color(0xFFDC2626),
  ),
  scaffoldBackgroundColor: const Color(0xFF020202),
  textTheme: GoogleFonts.interTextTheme(/* + Syncopate для display */),
);
```

### Логотип (тигр)

Файл — `assets/images/tiger.png` (копия `hundlerminiapp/public/tiger.png`).

Реализация — `lib/features/home/widgets/tiger_logo.dart`:

```dart
class TigerLogo extends StatelessWidget {
  final double size;
  const TigerLogo({super.key, this.size = 224});

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: Image.asset('assets/images/tiger.png')
          .animate(onPlay: (c) => c.repeat(reverse: true))
          .scale(begin: const Offset(1, 1), end: const Offset(1.02, 1.02),
                 duration: 4.seconds, curve: Curves.easeInOut)
          .fade(begin: 0.95, end: 1.0, duration: 4.seconds, curve: Curves.easeInOut),
    );
  }
}
```

Glow реализуется через `Container` с `BoxShadow` радиусом 42 и цветом
`Color(0x59EF4444)` (что = `rgba(239,68,68,0.35)`).

---

## Аутентификация в нативном клиенте

Доступные способы (в порядке приоритета для UX):

1. **Telegram Login Widget через браузер** — открываем
   `https://hundlervpn.xyz/login?platform=android&redirect=hundler%3A%2F%2Fauth%2Fcallback`
   в Custom Tabs, после логина мини-апп редиректит на
   `hundler://auth/callback?token=<jwt>` через app-link. Требует
   `intent-filter` на `MainActivity` для `hundler://`.
2. **Email-код** — встроенный экран `LoginScreen` с двумя полями
   (email → код). Дёргает `/api/auth/send-code` и `/api/auth/verify-code`.
3. **Google OAuth** — встроенный Google Sign-In SDK; токен шлём в
   `/api/auth/google` для обмена на наш JWT. Требует SHA-1 нашего
   release-keystore в Google Cloud Console.

Хранение JWT и `sub_token` — **только** `flutter_secure_storage`
(EncryptedSharedPreferences под капотом, AES-256 на основе Android Keystore).

---

## Сборка и подписка

### Локальная dev-сборка

```bash
flutter pub get
flutter run -d <android-device>     # debug-APK на подключённый телефон
```

### Release

Keystore — **никогда** не коммитим. Хранится в `~/.hundler/upload-key.jks`,
пароли — в env-переменных или `~/.hundler/keystore.properties` (тоже вне репо):

```
storeFile=/home/user/.hundler/upload-key.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

```bash
flutter build appbundle --release       # → build/app/outputs/bundle/release/app-release.aab
flutter build apk --release --split-per-abi   # → 3 APK для side-load (arm64, armv7, x86_64)
```

Загрузка:

- **Google Play** — AAB через Play Console (Internal Testing → Closed Testing → Production).
- **RuStore** — AAB через rustore.ru/console. Принимают AAB ИЛИ APK.
- **Сайт hundlervpn.xyz** — `arm64-v8a` APK как «прямая загрузка».
  Размер ~30–50 МБ против ~12–15 МБ из Play (за счёт mono-architecture
  и отсутствия Play-оптимизаций — это норма).

### Версионирование

`versionCode` = монотонно растёт на каждый релиз (даже на dev).
`versionName` = semver `1.0.0`. В User-Agent `HundlerVPN/${versionName}`.

---

## Тестирование

### Где тестировать

- **Android Studio Emulator** — для UI и без-VPN частей. VPNService
  работает в эмуляторе **только** через `arm64-v8a` x86 эмулятор
  с включённым Google APIs образ; быстрый x86_64 emulator может
  отказать. Если ломается — тестим на физике.
- **Физический Android-телефон** — обязательно для VPN. Желательно
  два разных вендора (Samsung — One UI, Xiaomi — MIUI/HyperOS) +
  один Pixel со стоковой Android для baseline. У Xiaomi есть особенности
  с убийством foreground-сервисов (MIUI battery saver) — чек на
  «приложение не убивается через 30 минут после включения экрана».

### Чек-лист перед релизом

- [ ] APK не пишет логи с UUID/токеном в Logcat в release-сборке
      (включить `proguard` + минификацию).
- [ ] Подключение работает на 4G/5G российских операторов (МТС, Билайн,
      Мегафон, Tele2). Особенно важно — TSPU дропает «странные» TCP/UDP.
- [ ] VPN переживает переключение Wi-Fi ↔ LTE без ручного перезапуска.
- [ ] Foreground-уведомление не убивается на Xiaomi (MIUI Auto-start).
- [ ] При смене языка системы — UI перерендеривается без перезапуска.
- [ ] Скоупы Reality SNI — клиент правильно подхватывает `serverName`
      из конфига сервера (а не хардкодит `www.microsoft.com`).
- [ ] `kill` основного процесса (через task switcher) → VPN продолжает
      работать (`START_STICKY` + foreground-service делают своё).

---

## Известные грабли (заполняй по мере появления)

> Сюда копируем фиксы. Формат как в `hundlerminiapp/MINIAPP-AGENTS.md`:
> заголовок проблемы, симптомы, root cause, фикс, дата.

### TODO: Xiaomi MIUI убивает foreground-сервис

(Пока не наблюдали — но почти точно столкнёмся при тестах. План: добавить
on-boarding экран «Разрешите автозапуск в настройках MIUI».)

### TODO: Reality handshake падает на Android < 7

Не наблюдали (minSdk 24 = Android 7), но если кто-то попытается
запустить через старый эмулятор — `libcore.aar` от sing-box не
поддерживает API 23 и ниже.

---

## Что ещё НЕ сделано (порядок задач)

1. ✅ Скаффолд Flutter-проекта + дизайн-токены + Home screen UI.
2. ✅ Platform channel + Kotlin VPN-сторона (`VpnChannel.kt` + `HundlerVpnService.kt` — stub без core).
3. ✅ Google OAuth через Custom Tabs (`flutter_web_auth_2` + `nativeReturn` на бэкенде).
4. ✅ AuthService + Riverpod-контроллер + Splash/Login/Home навигация по сессии.
5. ✅ HundlerApi с `fetchSession` / `fetchUserState` / `fetchSubscription`.
6. ✅ SubscriptionRepository с дисковым кешем sing-box JSON и автополлингом.
7. ✅ CoreManager скаффолд с планом интеграции libcore.aar (см. комментарии в файле).
8. ⏳ Авторизация (Telegram-redirect + email-код).
9. ⏳ Интеграция `libcore.aar` (sing-box) — самый тяжёлый шаг.
10. ⏳ Экран выбора сервера + статистика (трафик / время сессии).
11. ⏳ Экран оплаты (открыть мини-апп в Custom Tabs).
12. ⏳ Управление устройствами (`/api/users/devices`).
13. ⏳ Уведомление о превышении лимита устройств (парсим `remarks` из конфига).
14. ⏳ Подпись + загрузка в Play Internal Testing.

---

## Реально собранное сейчас (2026-05-11)

### Flutter (Dart)

- `lib/main.dart` — `ProviderScope` + edge-to-edge dark overlay.
- `lib/app.dart` — `_AuthGate` роутер: `AuthBootstrapping → Splash`,
  `AuthSignedOut → LoginScreen`, `AuthSignedIn → HomeScreen`.
- `lib/core/api_client.dart` — `HundlerApi`:
  - `fetchSession(token)` → `/api/auth/session?token=...`
  - `fetchUserState(userId)` → `/api/users/state?userId=...`
  - `fetchSubscription(subToken)` → `/api/sub/{subToken}` с
    User-Agent = `HundlerVPN/x.x.x (android; Android N) sing-box/embedded`
    и `X-Device-OS/Model/HWID` заголовками.
- `lib/core/theme.dart` + `colors.dart` + `typography.dart` — дизайн-токены.
- `lib/services/storage_service.dart` — `FlutterSecureStorage`
  (EncryptedSharedPreferences) для `session_token`, `sub_token`, user info.
- `lib/services/auth_service.dart` — Google OAuth через
  `flutter_web_auth_2` + `bootstrap()` для холодного старта.
- `lib/services/vpn_service.dart` — Dart-обёртка над MethodChannel/EventChannel.
- `lib/features/auth/auth_controller.dart` — `Notifier<AuthState>`.
- `lib/features/auth/login_screen.dart` — экран с тигром + Google-кнопка.
- `lib/features/home/home_screen.dart` — Home со StatusCard + ConnectButton
  + `_UserHeader` (имя/email/бейдж дней из `HundlerUserState.daysLeft`).
- `lib/data/repositories/subscription_repository.dart` — дисковый кеш
  sing-box JSON (`path_provider` → `getApplicationSupportDirectory`) +
  таймер-поллер.

### Kotlin (android/app/src/main/kotlin/com/hundlervpn/hundler)

- `MainActivity.kt` — `FlutterActivity` + регистрирует `VpnChannel` +
  форвардит `onActivityResult` для VPN-prepare диалога.
- `vpn/VpnChannel.kt` — `MethodChannel` + `EventChannel` + local-broadcast
  из `HundlerVpnService`.
- `vpn/HundlerVpnService.kt` — `VpnService` **stub**. Не открывает TUN,
  только foreground notification + симулирует `connecting→connected`
  за 1 сек для отладки UI.
- `vpn/CoreManager.kt` — скаффолд под sing-box `libcore.aar`
  (вся реализация — заглушки + подробный план в kdoc).

### AndroidManifest.xml зарегистрировано

- Permissions: INTERNET, ACCESS_NETWORK_STATE, FOREGROUND_SERVICE,
  FOREGROUND_SERVICE_SYSTEM_EXEMPTED, POST_NOTIFICATIONS.
- `MainActivity` — `singleTop` + intent-filter на `hundler://` для deep links.
- `HundlerVpnService` — `BIND_VPN_SERVICE` + `foregroundServiceType=systemExempted`.
- `com.linusu.flutter_web_auth_2.CallbackActivity` — `hundler://auth/...`
  для перехвата OAuth-redirect'а.

### Что нужно на бэкенде (мини-апп)

Два файла патча в `hundlerminiapp/app/api/auth/google/`:

- `start/route.ts` — принимает `?nativeReturn=hundler%3A%2F%2Fauth%2Fcallback`,
  whitelist схемы (`hundler://` / `hundlervpn://`), пишет в httpOnly cookie
  `g_oauth_native_return`.
- `callback/route.ts` — читает cookie, редиректит на
  `{nativeReturn}?token=<sessionToken>` вместо `/login?tg_session=...`.

Эти изменения **ещё не задеплоены** — нужно `git commit && git push` в
`hundlervpn/hundlervpn` (Hostman подхватит автоматически через 2 минуты).

### Сборка / установка (Windows, рабочая комбинация)

- Flutter 3.41.9 stable.
- Eclipse Temurin JDK 17.0.19 → `C:\Java\jdk-17`.
- Android SDK: cmdline-tools 13114758, platform-tools 37,
  build-tools 35+36, platforms android-35+36 → `C:\Android`.
- Env vars (User scope): `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`
  + PATH дописан.
- `minSdk=24`, `targetSdk=36`, `compileSdk=flutter.compileSdkVersion=36`.
- ABI filter `arm64-v8a / armeabi-v7a / x86_64`.

```powershell
flutter pub get
flutter analyze          # должен быть "No issues found!"
flutter build apk --debug --target-platform android-arm64
adb -s <device> install -r -t build\app\outputs\flutter-apk\app-debug.apk
adb -s <device> shell am start -n com.hundlervpn.hundler/.MainActivity
```

Debug APK получается **~156 МБ** (из-за Flutter debug-рантайма). Release
после ProGuard/R8 должен быть ~20-30 МБ на arm64.
