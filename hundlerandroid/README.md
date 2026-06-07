# Hundler VPN — Android

Нативный Android-клиент Hundler VPN. **Flutter** для UI + **Kotlin** для VPN-туннеля (sing-box через `libcore.aar` + `VPNService`).

> Перед началом работы прочитай:
> 1. `../AGENTS.md` — корневые общие правила (бренд, API, протокол).
> 2. `ANDROID-AGENTS.md` (рядом с этим файлом) — Android-специфика.
> 3. `../hundlerminiapp/MINIAPP-AGENTS.md` — серверы, БД, формат подписки.

---

## Текущее состояние

✅ **Сделано (UI-only)**:

- Скелет Flutter-проекта (Dart-сторона).
- Дизайн-система: цвета, типографика, тема (Inter + Syncopate, чёрный фон, красный акцент).
- Главный экран: тигр с дыхательной анимацией, Connect-кнопка, статус-карточка, bottom-bar.
- API-клиент `HundlerApi` для `hundlervpn.xyz` с правильным `User-Agent` и `X-HWID`.
- Модель `HundlerServer`, базовая обёртка `VpnService` с MethodChannel/EventChannel.

⏳ **TODO (по приоритету)**:

1. Сгенерить нативный Android-модуль через `flutter create .` (см. ниже).
2. Авторизация (Telegram-redirect + email-код).
3. Загрузка подписки → передача sing-box JSON в нативную сторону.
4. **Kotlin-сторона**: `HundlerVpnService` (extends `VpnService`) + интеграция `libcore.aar` (sing-box).
5. Экран выбора серверов, оплаты, профиля.

---

## Установка зависимостей

### 1. Поставь Flutter SDK (если ещё не стоит)

Самый простой способ на Windows — через `fvm` (Flutter Version Management) либо вручную:

```powershell
# Вручную
git clone https://github.com/flutter/flutter.git -b stable C:\flutter
$env:Path += ";C:\flutter\bin"
flutter --version
flutter doctor
```

`flutter doctor` должен показать всё зелёным, кроме (опционально) Visual Studio для desktop. Для Android нужны:

- **Android Studio** (или хотя бы Android SDK + Platform Tools).
- **JDK 17** (Android Gradle Plugin 8.x требует именно 17).
- Подключённое устройство или эмулятор API ≥ 24.

### 2. Сгенерируй нативный Android-модуль

В этом репо лежит **только** Dart-сторона (`lib/`, `pubspec.yaml`, `assets/`). Папки `android/` ещё нет — её создаст Flutter:

```powershell
# из hundlerandroid/
flutter create . `
  --org com.hundlervpn `
  --project-name hundler `
  --platforms=android `
  --description "Hundler VPN — VLESS+Reality VPN client"
```

Это **не перезапишет** существующие `lib/`, `pubspec.yaml`, `assets/` — Flutter увидит, что они уже на месте. Будут созданы:

- `android/` — Gradle, `MainActivity.kt`, манифест.
- `test/` — каркас тестов.
- `.metadata` — служебный файл Flutter.

> ⚠️ После генерации нужно **поправить** `android/app/build.gradle.kts`:
> - `minSdk = 24` (Android 7.0).
> - `targetSdk = 34` (требование Google Play 2026).
> - `applicationId = "com.hundlervpn.android"`.
> - VersionName из pubspec — должно подхватываться автоматически.

### 3. Установи Dart-зависимости

```powershell
flutter pub get
```

---

## Запуск

### Debug на физическом устройстве

```powershell
flutter devices                # увидишь свой телефон
flutter run -d <device-id>     # горячая перезагрузка работает
```

### Debug-APK для side-load

```powershell
flutter build apk --debug
# build\app\outputs\flutter-apk\app-debug.apk
```

### Release-сборка (для тестов)

```powershell
flutter build apk --release --split-per-abi
# 3 APK: arm64, armv7, x86_64 в build\app\outputs\flutter-apk\
```

### Release-сборка для Google Play (AAB)

См. `ANDROID-AGENTS.md` секцию "Сборка и подписка" — нужен keystore. Команда:

```powershell
flutter build appbundle --release
# build\app\outputs\bundle\release\app-release.aab
```

---

## Архитектура (короткая версия)

```
┌─────────────────────────────────────┐
│  Flutter (lib/)                     │
│  - features/home → HomeScreen       │
│  - core/api_client → HundlerApi     │
│  - services/vpn_service → MethodCh. │
└──────────────┬──────────────────────┘
               │  MethodChannel
               │  com.hundlervpn.android/vpn
┌──────────────▼──────────────────────┐
│  Kotlin (android/app/src/main/)     │
│  - MainActivity.kt                  │
│  - vpn/HundlerVpnService.kt         │  ← ещё не написано
│  - vpn/VpnChannel.kt                │
│  - libs/libcore.aar (sing-box)      │
└─────────────────────────────────────┘
```

UI ничего не знает про sing-box. Bекенд (мини-апп) отдаёт готовый sing-box JSON — Flutter передаёт его в нативную сторону as-is. Это даёт серверу полный контроль над протоколом без обновления приложения.

---

## Дизайн-токены

Все значения должны совпадать с `hundlerminiapp` пиксель-в-пиксель. Источник правды — `../AGENTS.md` (корневой) секция "Дизайн-токены". В коде они в `lib/core/colors.dart`.

| Токен              | Hex / RGBA               |
|--------------------|--------------------------|
| `bgPrimary`        | `#020202`                |
| `bgSurface`        | `#0A0A0A`                |
| `accentRed`        | `#EF4444` (red-500)      |
| `accentRedGlow`    | `rgba(239,68,68,0.35)`   |
| `accentOrange`     | `#F97316` (orange-500)   |
| `success`          | `#22C55E`                |
| `danger`           | `#DC2626`                |

Шрифты: **Inter** (sans) + **Syncopate** (display) — через `google_fonts`.

---

## Дальше по плану

После того как базовая сборка заработает на твоём телефоне (можно даже с stub-VPN — кнопка переключает статус локально), идём по следующим задачам:

1. **Авторизация** — открываем `https://hundlervpn.xyz/login?platform=android` в Custom Tabs, ловим callback через `hundler://auth/callback?token=...`.
2. **Подписка** — `HundlerApi.fetchSubscription(subToken)` → JSON в `flutter_secure_storage` → передаём в `VpnService.connect()`.
3. **sing-box интеграция** — самый тяжёлый шаг. Берём `libcore.aar` (либо официальный sing-box-for-android, либо форк Hiddify) и пишем `HundlerVpnService.kt`.
4. **Загрузка в Play Store / RuStore** — настраиваем keystore, signing config, Internal Testing track.

Комментарии и PR'ы — в monorepo `HundlerAll`, ветки `client/android`.
