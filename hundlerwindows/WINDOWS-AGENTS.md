# WINDOWS-AGENTS — свод правил Windows-клиента Hundler VPN

> **Что это**: платформенный свод правил для проекта
> `hundlerwindows` (Flutter Desktop + sing-box.exe + wintun.dll).
>
> **Не путать с `MINIAPP-AGENTS.md`** (Next.js бэкенд) и
> `ANDROID-AGENTS.md` (Android-клиент).

Перед началом работы прочитай:

1. **`HundlerAll/AGENTS.md`** — общие правила бренда / API / VPN-протокола.
2. **`hundlerminiapp/MINIAPP-AGENTS.md`** — как работают серверы
   и подписка (формат sing-box JSON, SNI-пул, UUID-ротация).
3. **`hundlerandroid/ANDROID-AGENTS.md`** — Dart/Flutter код полностью
   переиспользуется (UI, API-client, репозитории) — Windows только
   меняет платформенную часть (VPN-core, auth flow, packaging).

Этот файл описывает **только** Windows-специфику.

---

## TL;DR — что реально работает сейчас (2026-05-15)

- ✅ Flutter UI собирается под Windows, frameless окно 420×720, premium
  тигр-кнопка в центре с status-кольцом.
- ✅ Авторизация: Google / Telegram через системный браузер + loopback
  HTTP server (RFC 8252, см. ниже). Email-код тоже работает.
- ✅ DPAPI Secure Storage через win32 FFI (`CryptProtectData`).
- ✅ Подписка фетчится с `/api/sub/{token}`, кэшируется на диск, поллинг
  раз в час.
- ✅ Servers screen — премиум-карточки с country-плашками,
  hover/select-эффекты, бейджи `PREMIUM · VLESS · REALITY`.
- ✅ VPN-движок: `sing-box.exe` + `wintun.dll` запускаются как
  child-процесс. UAC detection через `OpenProcessToken` + `TokenElevation`,
  плашка «Перезапустить от админа» через `ShellExecute` verb=runas.
- ✅ Selected server pin через патч `selector.default` в sing-box JSON
  по country (см. `lib/services/singbox_config_patch.dart`).
- ✅ System tray icon + контекстное меню `Show / Toggle VPN / Quit`,
  close (×) прячет в трей.

### Что НЕ делаем (изначальный план поменялся)

| Изначально планировалось | Сейчас | Почему |
|--------------------------|--------|--------|
| Rust helper-service под LocalSystem | ❌ — sing-box.exe запускается прямо из UI-процесса | MVP: достаточно UAC-elevation один раз на запуск. Helper — 2-я итерация. |
| MSIX + Microsoft Store | ❌ — пока только flutter run / debug exe | Дистрибуция позже, после стабилизации core. |
| `hundler://` deep-link через `protocol_handler` | ❌ — заменено на loopback HTTP server | Windows на deeplink запускает второй процесс exe, ломает flutter run device-connection и без named-mutex IPC не форвардит аргумент. Loopback (RFC 8252) проще и работает out of the box. |
| Single-instance lock (named mutex) | ❌ — не нужно | Без deeplink-flow второй процесс не появляется. |
| `flutter_secure_storage` | ❌ — заменено на свой DPAPI через win32 FFI | C++ плагина требует `atlstr.h` (ATL/MFC) которого нет в стандартной установке VS Build Tools. |
| `flutter_acrylic` (Mica/Acrylic) | ❌ — не используется | Хватает кастомного frameless + radial gradient. Acrylic — позже как косметика. |
| `tray_manager` 0.5+ | tray_manager **0.2.4** | 0.5+ ломает API. Если будем обновлять — придётся переписать `tray_service.dart`. |

---

## Технический стек

- **UI**: Flutter Desktop (Dart, stable channel ≥ 3.24, **windows** target).
- **State**: `flutter_riverpod` 2.6.x. Без `freezed` (пока проще без него).
- **HTTP**: `dio` 5.7+ с интерцепторами (`_AuthInterceptor` в `api_client.dart`).
- **VPN core**: **sing-box.exe** v1.10.7+ (официальный CLI от SagerNet),
  запускается как child-процесс из UI через `Process.start`.
- **TUN driver**: **wintun.dll** v0.14.1 (https://www.wintun.net/) —
  user-mode библиотека, создаёт virtual network adapter без kernel-driver
  installer. WHQL-подписанная Microsoft'ом.
- **Secure storage**: DPAPI через `win32` 5.x + `ffi` 2.x
  (`lib/services/secure_storage.dart`).
- **System tray**: `tray_manager` 0.2.4. **Не обновлять** без переписи
  обвязки.
- **Window**: `window_manager` 0.4.x — frameless 420×720, DragToMoveArea,
  setPreventClose для hide-to-tray.
- **Auth**: системный браузер (`url_launcher`) + loopback HTTP server
  (`dart:io HttpServer`) для приёма OAuth callback (RFC 8252).
- **Минимальная ОС**: Windows 10 build 19041 (20H1, май 2020). Это первая
  версия с приличной wintun-совместимостью.
- **Архитектуры**: только `x64` (amd64). ARM64 — позже.
- **Подпись**: пока не подписываем. Authenticode — на этапе релиза
  (см. секцию «Подпись и дистрибуция»).

### Зависимости pubspec (реальный список)

См. `pubspec.yaml`. Опорный обзор:

```yaml
dependencies:
  flutter_riverpod: ^2.6.1     # state management
  dio: ^5.7.0                  # HTTP
  win32: ^5.5.0                # CryptProtectData, ShellExecuteEx, OpenProcessToken
  ffi: ^2.1.0                  # Pointer работа в FFI
  path_provider: ^2.1.4        # %APPDATA% / %LOCALAPPDATA%
  device_info_plus: ^11.2.0    # MachineGuid → X-HWID
  package_info_plus: ^8.1.1
  google_fonts: ^6.2.1
  lucide_icons_flutter: ^3.0.5
  flutter_animate: ^4.5.0
  window_manager: ^0.4.2       # frameless окно, hide-to-tray
  tray_manager: ^0.2.4         # ⚠️ не обновлять без миграции
  url_launcher: ^6.3.1         # открыть default браузер для OAuth
```

> **Замечание про `flutter_secure_storage`**: НЕ используется (см.
> таблицу выше). Своя обёртка над DPAPI в `lib/services/secure_storage.dart`.

---

## Структура проекта (фактическая)

```
hundlerwindows/
├── WINDOWS-AGENTS.md
├── README.md (минимальный)
├── pubspec.yaml
├── analysis_options.yaml
├── windows/                            ← нативный модуль Flutter Desktop
│   ├── runner/
│   │   └── resources/
│   │       └── app_icon.ico
│   ├── flutter/
│   └── CMakeLists.txt
├── assets/
│   └── images/
│       ├── tiger-source.png            ← исходник 600×600
│       ├── tiger.png                   ← готовый композит
│       └── tray_icon.ico               ← копия app_icon.ico для трея
├── lib/
│   ├── main.dart                       ← windowManager init + setPreventClose(true)
│   ├── app.dart                        ← MaterialApp + _TrayBridge + _AuthGate
│   ├── core/
│   │   ├── api_client.dart             ← HundlerApi с deviceHeaders + sub-fetch
│   │   ├── colors.dart                 ← дизайн-токены, копия из Android
│   │   ├── theme.dart
│   │   └── typography.dart
│   ├── data/
│   │   ├── models/
│   │   │   └── server.dart             ← HundlerServer DTO
│   │   └── repositories/
│   │       └── subscription_repository.dart  ← fetch + кеш + polling
│   ├── services/
│   │   ├── vpn_service.dart            ← запуск/остановка sing-box.exe
│   │   ├── singbox_config_patch.dart   ← патч selector.default по country
│   │   ├── admin_check.dart            ← isElevated + relaunchAsAdmin (win32 FFI)
│   │   ├── secure_storage.dart         ← DPAPI обёртка
│   │   ├── storage_service.dart        ← SharedPreferences-like API над secure_storage
│   │   ├── auth_service.dart           ← OAuth через браузер + loopback server
│   │   └── tray_service.dart           ← tray icon + меню Show/Toggle/Quit
│   └── features/
│       ├── auth/
│       │   ├── auth_controller.dart    ← Riverpod state machine
│       │   └── login_screen.dart       ← Google/Telegram/email tabs
│       ├── splash/
│       │   └── splash_screen.dart      ← while AuthBootstrapping
│       ├── home/
│       │   ├── home_screen.dart        ← title bar + ConnectTiger + ServerCard
│       │   └── widgets/
│       │       ├── tiger_logo.dart     ← дышащий тигр (общая копия с Android)
│       │       └── connect_tiger.dart  ← ★ тигр-кнопка с status-кольцом
│       ├── servers/
│       │   ├── servers_controller.dart ← serversProvider + selectedServerProvider
│       │   └── servers_screen.dart     ← премиум карточки с country badge
│       ├── subscription/
│       │   └── subscription_controller.dart
│       └── vpn/
│           └── vpn_controller.dart     ← connect/disconnect/toggle логика
```

> Helper-service / installer / msix-manifest НЕ существуют пока. Папок
> `helper/` и `installer/` в проекте нет.

---

## Архитектура VPN-стека (фактическая, без helper-сервиса)

```
┌─────────────────────────────────────────┐
│ hundler.exe (Flutter UI + Dart logic)   │   ← запущен пользователем
│                                          │     UAC-elevated на старте
│   - окно, tray icon                      │     (см. UAC detection ниже)
│   - Riverpod state                       │
│   - HTTP к API                           │
│   - запускает sing-box.exe child-process │
└─────────────────┬───────────────────────┘
                  │ Process.start + stdin/stdout pipes
                  ▼
┌─────────────────────────────────────────┐
│ sing-box.exe run -c current.json        │   ← child, наследует elevation
│   - читает sing-box JSON с диска         │     родителя (admin)
│   - создаёт TUN через wintun.dll         │
│   - проксирует traffic                   │
└─────────────────────────────────────────┘
```

### Почему так, а не helper-service

Изначально планировали Rust helper под LocalSystem (см. ANTI-MVP таблицу
выше). На практике для **MVP** оказалось проще: запросить admin **один
раз** при первом сетевом коннекте, и работать.

**UAC flow**:
1. Юзер открыл Hundler VPN.
2. `AdminCheck.isElevated()` смотрит `TokenElevation` текущего процесса.
3. Если **не elevated** — Home Screen показывает плашку «Нужны права
   администратора» с кнопкой «Перезапустить от админа».
4. Кнопка вызывает `AdminCheck.relaunchAsAdmin()` → `ShellExecuteExW`
   с `lpVerb = "runas"`. Windows показывает UAC-диалог.
5. После Yes — новый процесс exe стартует с admin-токеном, старый
   процесс закрывается (`windowManager.close()`).

**Минусы текущего подхода (исправим позже)**:
- UAC-prompt каждый раз когда пользователь зашёл без admin (а это
  большинство юзеров).
- VPN не живёт при logoff (нужно повторно логиниться чтобы запустить).
- Нет auto-reconnect если sing-box упал.

**План helper-service** (2-я итерация):
- Rust `hundler-helper.exe`, Windows Service, `LocalSystem` account.
- IPC через named pipe `\\.\pipe\hundler-helper` (msgpack-кадры).
- UI запускается БЕЗ admin, helper делает всю TUN-работу.
- Установка сервиса — один раз через `sc.exe create` (UAC).

---

## Auth flow — loopback HTTP server (RFC 8252)

`hundler://` deep-link **не используется** (см. таблицу выше). Вместо
этого:

1. `AuthService` поднимает `HttpServer.bind('127.0.0.1', 0)` — выбирает
   свободный порт (например 50000).
2. UI открывает в системном браузере:
   `https://hundlervpn.xyz/api/auth/google/start?nativeReturn=http://127.0.0.1:50000/auth/callback`
3. Бэкенд (`/api/auth/{google|telegram}/start`) **whitelist'ит**
   `http://127.0.0.1:PORT/...` и `http://localhost:PORT/...` для
   nativeReturn (см. `hundlerminiapp/lib/native-return.ts::LOOPBACK_PORT_RE`).
4. После OAuth-логина бэкенд редиректит браузер на
   `http://127.0.0.1:50000/auth/callback?token=<jwt>`.
5. Локальный `HttpServer` ловит запрос, читает `token` из query,
   отправляет браузеру HTML «Готово, можно закрыть вкладку», закрывает
   соединение.
6. AuthService резолвит Future с JWT → AuthController пишет в
   SecureStorage → AuthGate переключается на HomeScreen.

**Зачем `127.0.0.1` И `localhost`**: Hostman Caddy перед нашим Next.js
переписывает `127.0.0.1` → `localhost` в query-параметрах. Поэтому
бэкенд принимает обе формы. Клиент шлёт `127.0.0.1` (исключает DNS
mitm для loopback).

---

## sing-box.exe — путь, запуск, остановка

### Где лежит

`%APPDATA%\com.hundlervpn.hundler\bin\` (= `C:\Users\<USER>\AppData\Roaming\com.hundlervpn.hundler\bin\`). Путь определяется `path_provider::getApplicationSupportDirectory()` — на Windows это `%APPDATA%\<bundle_id>\` где `bundle_id = com.hundlervpn.hundler` (см. `windows/runner/Runner.rc`). Внутри ожидаются:
- `sing-box.exe` — последний stable release (1.10.7+) с
  `github.com/SagerNet/sing-box/releases`. Файл `sing-box-X.Y.Z-windows-amd64.zip`,
  внутри `sing-box.exe` ~32 МБ.
- `wintun.dll` — `wintun-0.14.1.zip` с `wintun.net`, путь
  `wintun/bin/amd64/wintun.dll` ~428 КБ.

### Как туда попадает

**Сейчас (MVP)**: вручную, юзер скачивает и кладёт сам. UI плашка
`_BinariesMissingCard` подсказывает путь + ссылка на GitHub.

**Позже (release)**: bundled в Inno Setup installer, копируется в
`%PROGRAMFILES%\Hundler VPN\bin\`.

### Запуск (см. `lib/services/vpn_service.dart`)

```dart
_proc = await Process.start(
  '${binDir}/sing-box.exe',
  ['run', '-c', '${configDir}/current.json', '-D', appRootDir],
  workingDirectory: binDir,         // ← важно: sing-box ищет wintun.dll в cwd
  runInShell: false,
  mode: ProcessStartMode.normal,
);
```

Stdout / stderr читаются и логируются. Сигнал «inbound up» детектится
по подстроке `started` в stderr (sing-box пишет `INFO inbound/tun-in
started` когда wintun-адаптер успешно создан).

### Остановка

```dart
await Process.run('taskkill', ['/T', '/F', '/PID', '${proc.pid}']);
```

`/T` — убивает всё дерево (sing-box может породить child'ов).
`/F` — без graceful shutdown (SIGINT не пройдёт через taskkill /F
на Windows, wintun сам отдаст адаптер через минуту).

---

## Selected server pin (важная деталь)

**Бэкенд** в `/api/sub/{token}` возвращает sing-box JSON со **всеми**
активными серверами + auto-selector outbound:

```json
{
  "outbounds": [
    { "type": "vless", "tag": "🇩🇪 Германия | ...", "server": "...", ... },
    { "type": "vless", "tag": "🇳🇱 Нидерланды | Обход Глушилок", ... },
    { "type": "selector", "tag": "proxy",
      "outbounds": ["🇩🇪 Германия | ...", "🇳🇱 Нидерланды | ..."],
      "default": "🇩🇪 Германия | ..." }
  ]
}
```

Юзер в UI может выбрать конкретную локацию. Тогда **клиент** перед
`vpn.start()` патчит JSON:

1. Ищет в `outbounds` запись типа `vless` чей `tag` содержит русское
   название страны выбранного сервера (`Германия` / `Нидерланды` /
   `Россия` / etc).
2. Подменяет в outbound `tag: 'proxy'` поле `default` на найденный tag.
3. Также обновляет `dns.servers[tag='dns-proxy'].detour` на этот же tag
   (DNS должен идти через выбранный сервер).

Реализация — `lib/services/singbox_config_patch.dart::pinSelectedServer`.
Вызывается из `VpnController.connect()` перед `vpn.start()`. На любой
ошибке парсинга — fallback на оригинальный JSON (auto-selector).

**Почему по country, а не по host'у**: `/api/servers` возвращает
`host: 'hidden'` (anti-detection, см. memory от 2026-05-12). Реальный IP
есть только внутри sing-box JSON. Match по country — самый стабильный.

---

## DPAPI Secure Storage (`lib/services/secure_storage.dart`)

Заменяет `flutter_secure_storage_windows` (см. таблицу проблем выше).

### API (совпадает с Android-обёрткой)

```dart
final s = SecureStorage.instance;
await s.write('session_token', '...');
final t = await s.read('session_token');     // null если нет
await s.delete('session_token');
await s.clearAll();
```

### Под капотом

- Каждый ключ — отдельный файл в
  `%APPDATA%\com.hundlervpn.hundler\hundler\secure\<sha256(key).hex>.bin`.
- Value шифруется `CryptProtectData` с `CRYPTPROTECT_LOCAL_MACHINE = 0`
  → ключ привязан к пользовательскому SID. Если юзер пересоздаст
  учётку Windows — расшифровка не пройдёт, storage gracefully вернёт
  null.
- `entropy` — pinned ASCII-строка `HundlerVPN/v1`. Даёт дополнительный
  слой против простого «прочитать DPAPI blob любым процессом текущего
  пользователя» (другой процесс должен знать эту entropy чтобы
  расшифровать).

### Что хранится

- `session_token` — JWT от `/api/auth/{telegram,google,email}/verify`.
- `sub_token` — токен подписки для `/api/sub/{token}` (Bearer).
- `selected_server_id` — int, выбранная локация.
- `user_id` / `user_email` / `user_name` — кэш для офлайн-UI.

---

## UAC detection и elevation (`lib/services/admin_check.dart`)

### isElevated()

`OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &h)` →
`GetTokenInformation(h, TokenElevation, ...)`. Если `TokenIsElevated`
DWORD равно 1 → admin. Любая ошибка → возвращаем `true` (fail-safe,
лучше не показать плашку чем показать её зря).

### relaunchAsAdmin()

`ShellExecuteExW` с `lpVerb = "runas"`. Windows показывает UAC-диалог.
**Без `package:win32` constants** — структура `SHELLEXECUTEINFOW`
собирается raw байтами с явными смещениями. Это устойчиво к
переименованиям в minor-версиях win32 5.x (которые ломали компиляцию
дважды).

После Yes — старый процесс закрывается через `windowManager.close()`,
новый стартует уже с admin-токеном.

---

## System tray (`lib/services/tray_service.dart`)

Иконка из `assets/images/tray_icon.ico` (= копия `app_icon.ico`).

### Контекстное меню

- **Открыть Hundler VPN** — `windowManager.show()` + focus + restore.
- **Подключить / Отключить** — вызывает `vpnControllerProvider.toggle()`.
  Лейбл меняется в `_rebuildMenu()` на каждом `updateStatus`.
- **Выход** — `setPreventClose(false)` → `close()` → процесс реально
  завершается, sing-box.exe убивается через taskkill в VpnService.dispose.

### Tooltip

`Hundler VPN — Защищено` / `Подключение...` / `Ошибка` / `Отключено`.

### close (×) → hide в трей

`main.dart::setPreventClose(true)` после `windowManager` init. Тогда
любой close (× в title-bar, Alt+F4, `windowManager.close()` из кода)
вызывает `TrayService.onWindowClose()` → `windowManager.hide()`.

Минимизировать (`_` кнопка) **НЕ** прячет в трей — оставляет в taskbar.
Это намеренно: hide-to-tray должен быть явным выбором юзера, а не
случайным side-effect минимизации.

### Riverpod связка (`lib/app.dart::_TrayBridge`)

TrayService — singleton, но получает доступ к Riverpod через
`_TrayBridge` widget внутри HundlerApp:
- `initState` → `TrayService.initialize(onToggleVpn: () => ref.read(vpnControllerProvider.notifier).toggle())`.
- `build` → `ref.listen<AsyncValue<VpnStatus>>` → `TrayService.updateStatus`.

Это нужно потому что `tray_manager` пакет — `WidgetsBindingObserver`-style
listener, ему нужен живой context для callbacks.

---

## UI — премиум видение (что есть сейчас)

### Home Screen — тигр-кнопка

`lib/features/home/widgets/connect_tiger.dart` — центральный
интерактивный элемент. Большой круг (260×260):

- **Внешнее status-кольцо**: цвет меняется по состоянию
  (`red` disconnected / `orange` connecting / `green` connected /
  `danger` error). Glow blurRadius 42 (60 для connected, ярче).
- **Внутренний радиальный градиент** (bgSurface → bgPrimary) — даёт
  depth, тигр «утоплен» в диск.
- **Тигр** — `TigerLogo` (общая копия с Android), 65% от внешнего
  размера, без своего glow (его роль играет status-ring).
- **Hover** — AnimatedScale 1.0 → 1.03. **Press** — 0.97.
- **Connecting** — кольцо вращается 1.4 с linear loop. **Connected** —
  «дыхание» scale 1.0 → 1.025 за 2 с easeInOut.
- **Subtitle** под тигром — AnimatedSwitcher между «Нажмите, чтобы
  подключиться» / «Подключение...» / «Защищено» / «Ошибка».

### Servers Screen — премиум-карточки

`lib/features/servers/servers_screen.dart`:

- Кастомный header с `DragToMoveArea` (frameless окно требует
  draggable зону, AppBar нативно её не даёт).
- Каждая карточка ~80 px высотой:
  - Круглая country-плашка (48×48) с двухбуквенным ISO внутри, красная
    обводка + glow. Эмодзи-флаги Microsoft на Windows не рендерит
    как национальные флаги (политическое решение), поэтому
    стилизованный двухбуквенный код.
  - Заголовок — русское название страны (`Германия`).
  - Subtitle — `server.name` (`Обход Глушилок` / `YouTube`) или
    `VLESS · Reality · uTLS` если name пустой.
  - 3 бейджа (`PREMIUM` / `VLESS` / `REALITY`) маленькими капс-пилюлями.
  - Зелёная online-точка справа от заголовка (с glow).
- Hover → красный glow + светлее фон + hint border.
- Select → красная рамка 1.5px + accentRedSoft фон + чек справа.

### Title bar

Frameless окно, своя полоска 44px высотой:
- Имя пользователя (auth.session.displayName) + дни подписки слева.
- Logout кнопка (LucideIcons.logOut).
- Minimize (`_`) + Close (`×`) справа в стиле Win11.
- Всё внутри `DragToMoveArea` (window_manager). Кнопки —
  `GestureDetector` ловят tap до того как DragToMoveArea успеет начать
  drag, иначе на каждый клик окно дёргалось бы.

---

## Что нужно от бэкенда (мини-апп)

Минимальные изменения, **уже сделанные**:

1. **`/api/auth/{google,telegram}/start`** принимает `nativeReturn`
   через whitelist в `hundlerminiapp/lib/native-return.ts`:
   ```ts
   const LOOPBACK_PORT_RE =
     /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})(?:\/[^\s]*)?$/i;
   ```
   Hostman Caddy переписывает 127.0.0.1 → localhost, поэтому оба
   варианта в whitelist.
2. **`/api/sub/{token}`** детектит User-Agent с подстрокой `sing-box`:
   `HundlerVPN/0.1.0 (windows; Windows 11 24H2) sing-box/embedded`.
3. **X-HWID** на Windows = `MachineGuid` из реестра
   `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` через
   `device_info_plus`.
4. **`display_host`** для серверов — Windows клиент использует его
   через `clientHost(server)` на бэкенде (это уже работает для всех
   клиентов).

Никаких **новых** эндпоинтов не требуется.

---

## Сборка

### Локальный dev

```powershell
cd hundlerwindows
flutter pub get
flutter run -d windows
```

При первом запуске UI попросит положить `sing-box.exe` и `wintun.dll`
в `%APPDATA%\com.hundlervpn.hundler\bin\`. После того как оба файла
там — перезапусти приложение (`r` Hot Restart в `flutter run`, либо
полный quit + restart), и Connect через тигр работает.

### Release-build (без подписи)

```powershell
flutter build windows --release
# → build/windows/x64/runner/Release/hundler.exe + DLLs
```

### Помещение sing-box / wintun в installer

**Сейчас (MVP)**: документация говорит юзеру скачать руками. UI
помогает (плашка с открытием папки и ссылкой на GitHub).

**Позже (release)**: Inno Setup installer бандлит `sing-box.exe` +
`wintun.dll` в `%PROGRAMFILES%\Hundler VPN\bin\`. VpnService изменится
чтобы искать там, а не в `%APPDATA%`.

### Подпись и дистрибуция (план)

- **Authenticode** EV-сертификат (~$300/год) или OV (~$80/год +
  накопление репутации SmartScreen).
- **Microsoft Store**: MSIX-пакет через `msix` Dart-пакет.
- **Прямая загрузка**: Inno Setup `.exe` с hundlervpn.xyz.

Подробнее — после стабилизации MVP.

---

## Тестирование (чек-лист перед релизом)

- [ ] Юзер без admin запускает hundler.exe → видит плашку → жмёт
      «Перезапустить от админа» → UAC-prompt → новая копия
      работает.
- [ ] sing-box.exe + wintun.dll лежат в bin/ → плашка
      `_BinariesMissingCard` скрывается, Connect работает.
- [ ] Connect через тигр: кольцо оранжевое → зелёное, subtitle
      «Защищено».
- [ ] Servers screen: выбор страны → возврат на Home → Connect →
      `selector.default` в JSON патчится → трафик идёт через выбранный
      сервер (проверить `curl ipinfo.io` после connect).
- [ ] Disconnect через тигр → sing-box.exe умер (`taskkill` в Task
      Manager не виден), tunnel-route ушёл.
- [ ] Tray icon виден после старта, tooltip и menu-лейблы меняются
      при connect/disconnect.
- [ ] × (close) → окно прячется в трей, sing-box.exe продолжает
      работать.
- [ ] Левый клик по трею → окно возвращается. Правый клик → меню.
- [ ] Tray → «Выход» → процесс реально завершается, sing-box.exe
      убивается.
- [ ] OAuth Google: открывается браузер на `accounts.google.com` →
      login → редирект на `127.0.0.1:PORT/auth/callback` → браузер
      пишет «Готово» → приложение получает JWT → Home Screen.
- [ ] OAuth Telegram: аналогично через Telegram Login Widget.
- [ ] Email-код: ввод email → код пришёл на почту → ввод 6 цифр →
      Home Screen.
- [ ] Reboot Windows → запустить exe → AuthGate сразу вылетает в
      Home (SecureStorage сохранил session).

---

## Известные грабли (заполняй по мере появления)

> Формат: заголовок проблемы, симптомы, root cause, фикс, дата.

### 2026-05-13 — Hostman Caddy переписывает `127.0.0.1` → `localhost`

**Симптом**: Windows-клиент шлёт OAuth-start с
`nativeReturn=http://127.0.0.1:50000/auth/callback`, бэкенд отвечает
«Недопустимый nativeReturn». Логи показывают что в Next.js приходит
`http://localhost:50000/auth/callback`.

**Root cause**: Hostman ставит Caddy как reverse proxy. Caddy
переписывает `127.0.0.1` → `localhost` в query-параметрах до того
как запрос попадает в Next.js. Наш whitelist принимал только
IP-литерал.

**Фикс**: `hundlerminiapp/lib/native-return.ts::LOOPBACK_PORT_RE`
принимает обе формы. Безопасность не пострадала: Flutter HttpServer
связан только с loopback IPv4, и браузер получит ECONNREFUSED если
DNS подменит `localhost` на чужой хост.

**Коммит**: a7daf05 (`fix(auth): accept http://localhost in nativeReturn
whitelist`).

### 2026-05-13 — `flutter_secure_storage_windows` требует `atlstr.h`

**Симптом**: `flutter build windows` падает:
```
flutter_secure_storage_windows_plugin.cpp(6,10): error C1083:
не удаётся открыть файл включения: atlstr.h: No such file or directory
```

**Root cause**: плагин требует ATL/MFC компонент VS Build Tools которого
нет в стандартной установке Flutter Desktop tooling.

**Фикс**: написали свою DPAPI-обёртку через win32 FFI
(`lib/services/secure_storage.dart`), убрали `flutter_secure_storage`
из pubspec. Тот же API, тот же уровень security
(per-user `CryptProtectData`).

### 2026-05-13 — `hundler://` deep-link ломает `flutter run`

**Симптом**: после регистрации `hundler://` в реестре HKCU, OAuth-callback
запускает **второй** процесс hundler.exe. flutter device-connection
рвётся, а первый процесс не знает что нужно прочитать JWT из argv
второго.

**Root cause**: для deeplink-flow на Windows нужен single-instance lock
(named mutex) + IPC между копиями (named pipe) чтобы форвардить
аргумент в живой инстанс. Это сложно и хрупко.

**Фикс**: вместо `hundler://` — loopback HTTP server на `127.0.0.1:PORT`,
браузер сам редиректит на наш порт, токен ловится напрямую без
вторичного процесса (RFC 8252, см. секцию «Auth flow»).

### 2026-05-14 — `win32` 5.x переименовал `TOKEN_ELEVATION`, `SEE_MASK_NOCLOSEPROCESS`

**Симптом**: после обновления `win32` пакета — ошибки компиляции
`The name 'TOKEN_ELEVATION' isn't a type`, `Undefined name
'SEE_MASK_NOCLOSEPROCESS'`.

**Root cause**: `package:win32` иногда меняет неймспейсы и переименовывает
generated-структуры в minor-версиях.

**Фикс**: `lib/services/admin_check.dart` использует **raw byte layout**
для `SHELLEXECUTEINFOW` с явными смещениями (cbSize=112 на x64). Для
`TokenElevation` — числовой константа 20, для `SEE_MASK_NOCLOSEPROCESS`
— `0x00000040`. Это устойчиво к будущим переименованиям.

---

## План работ (порядок задач, оставшихся к релизу)

### Сделано (MVP)

- [x] Скаффолд Flutter Desktop проекта.
- [x] Auth flow (Google / Telegram / email) через loopback HTTP server.
- [x] DPAPI Secure Storage (своя обёртка).
- [x] Subscription repository + поллинг + кэш на диск.
- [x] Servers screen с премиум-карточками.
- [x] VPN Service: запуск/остановка sing-box.exe.
- [x] Selected server pin через патч sing-box JSON.
- [x] UAC detection + relaunch as admin.
- [x] System tray + hide-to-tray + контекстное меню.
- [x] Тигр как Connect-кнопка с status-кольцом.
- [x] Frameless premium UI.

### Следующая итерация (production)

- [ ] **Auto-update sing-box.exe** — поллить `github.com/SagerNet/sing-box/releases`
      раз в день, скачивать новую stable, заменять в bin/.
- [ ] **Auto-reconnect** — listener на `NetworkInformation` события,
      рестарт sing-box если WiFi → Ethernet.
- [ ] **Stats** — sing-box `clash-api` inbound + WebSocket к нему для
      live up/down.
- [ ] **Helper-сервис под LocalSystem** — Rust, IPC через named pipe.
      Убирает UAC-prompt на каждый старт, добавляет auto-reconnect и
      переживает logoff.
- [ ] **Inno Setup installer** — bundled sing-box + wintun, registry
      cleanup при uninstall.
- [ ] **MSIX manifest** для Microsoft Store.
- [ ] **Code signing pipeline** в GitHub Actions (EV-сертификат).
- [ ] **Single-instance lock** через named mutex (если вернёмся к
      deep-link для каких-нибудь features).
- [ ] **Crash reporter** — Sentry или собственный endpoint
      `/api/crashes/windows`.
- [ ] **Per-app exclusion** (как в Android: банковские приложения
      обходят VPN). На Windows реализуется через `tun.exclude_uid`
      sing-box по PID процесса — сложнее чем на Android, отдельная
      исследовательская задача.

---

## Реально собранное сейчас (2026-05-15)

Всё что в чек-листе «Сделано (MVP)» выше — собрано, `flutter analyze`
чистый, `flutter build windows --debug` проходит, exe запускается и
работает.

Текущая верификация:
- `flutter analyze --no-pub` → `No issues found!`
- Auth flow → JWT приходит, AuthGate переключается на Home.
- Servers fetch → карточки рисуются.
- VPN-движок: тестируется только когда юзер вручную положил sing-box.exe
  + wintun.dll в `%APPDATA%\com.hundlervpn.hundler\bin\`.

Прогресс будет дописываться сюда внизу по мере реализации, как в
`ANDROID-AGENTS.md`.

---

## Батч 2026-05-15 (UI-полиш + Hysteria infrastructure)

### Что добавлено

1. **SVG-флаги стран** через пакет `country_flags` 3.2.0+. Заменили
   двухбуквенные ISO-кружки на настоящие флаги в круглой обводке.
   Файлы:
   - `lib/features/home/home_screen.dart::_CountryBadge` (на главной).
   - `lib/features/servers/servers_screen.dart::_CountryBadge`
     (в списке локаций).
   На Windows встроенный Segoe UI Emoji **не** рендерит regional-
   indicator pairs как национальные флаги — пакет лечит это SVG'ами.

2. **TUN/Proxy переключатель** (`_VpnModeSwitch`). Хранится в
   `StorageService.vpn_mode`, провайдер `vpnModeProvider`. Логика
   инжекта inbound в sing-box JSON:
   - **TUN**: `injectTunInboundIfMissing` — системный туннель через
     wintun, весь трафик ОС.
   - **Proxy**: `injectProxyInbound` — `mixed` inbound на
     `127.0.0.1:7890` (HTTP+SOCKS5). Юзер вручную прописывает в
     браузере / Telegram Desktop. Не требует admin для proxy mode
     (UAC всё равно есть, но wintun не используется).
   UI — компактный segment control из двух кнопок без hint-подписей.
   Disabled пока VPN подключён.

3. **VLESS/Hysteria переключатель** (`_ProtocolSwitch`). Хранится в
   `StorageService.vpn_protocol`, провайдер `vpnProtocolProvider`.
   Файлы:
   - `lib/features/vpn/vpn_protocol_controller.dart` — enum + provider.
   - `lib/services/singbox_config_patch.dart::filterOutboundsByProtocol`
     удаляет все proxy-outbound'ы кроме выбранного типа, чистит
     selector `outbounds[]` от удалённых tag'ов и переписывает
     `default` если он указывал на удалённый.
   - `lib/services/singbox_config_patch.dart::hasOutboundOfType` —
     проверка что бэкенд отдал нужный тип. Если нет — `vpn_controller`
     показывает понятную ошибку вместо FATAL от sing-box.
   - `lib/services/singbox_config_patch.dart::pinSelectedServer` теперь
     принимает `protocolType` параметром.

4. **Кнопка «Продлить подписку»** (`_RenewButton`). Полноширинная,
   красно-оранжевый градиент в брендовом стиле (см.
   `MEMORY[AGENTS.md]` бренд-токены). Hover → glow `0.55`, press →
   scale `0.98`. Tap → открывает `https://hundlervpn.xyz`. Вставлена
   на главной сразу под `_SubscriptionCard`. Старая иконка
   `externalLink` из title bar убрана (избыточная теперь).

5. **Auto-update banner** (`_UpdateBanner`). При старте Home
   `updateInfoProvider` дёргает `UpdateChecker.instance.check()`,
   который тянет
   `GET https://hundlervpn.xyz/api/clients/windows/latest.json`.
   Если версия из манифеста новее `package_info` → показывается
   оранжевый/красный (`mandatory`) баннер с release_notes. Tap →
   `launchUrl` на `url` манифеста (юзер качает installer вручную).
   Полная спека эндпоинта в `hundlerminiapp/MINIAPP-AGENTS.md`
   секция «TODO: Native Client Update Manifest Endpoint (2026-05-15)».

6. **Secure-delete `current.json`**. После старта sing-box (через 3 с
   успешного connect) клиент **перезаписывает файл нулями** и удаляет.
   Sing-box уже распарсил конфиг в память — файл больше не нужен.
   Также вызывается в `stop()` для подстраховки. Защищает от утечки
   `uuid` (личный VPN-ключ юзера) при компрометации `%APPDATA%`.
   Файл: `lib/services/vpn_service.dart::_secureDeleteConfig`.

### Hysteria — состояние

**В клиенте**: UI и фильтрация outbounds готовы. Юзер может
переключиться на Hysteria — клиент попытается достать `hysteria2`
outbound из sing-box JSON. Если бэкенд его не отдал → ошибка:

> Протокол Hysteria недоступен на этом аккаунте. Выберите VLESS или
> попросите администратора добавить hysteria2 outbound в /api/sub.

**В бэкенде**: Hy2 outbound emission был удалён 2026-05-09
(см. `hundlerminiapp/app/api/sub/[token]/route.ts::buildSingboxConfig`
комментарий «XUDP migration, v60»). Технический аргумент: VLESS+Reality
с `packet_encoding: xudp` уже несёт UDP внутри TCP/443 — отдельный
Hy2 как outbound в sing-box не даёт скоростного выигрыша на 99%
сетей. **Чтобы вернуть** Hy2 в подписке для Windows-клиента нужно:

1. Иметь живой Hy2-сервер с известным `auth password` и `obfs`.
   В памяти зафиксирован NL Hysteria инстанс на `213.182.213.183:8443`
   (см. `hundlerminiapp/MINIAPP-AGENTS.md` secret про `/etc/hysteria/
   .password`). Проверить что он ещё живой, BBR включён, sync-script
   не сломан.
2. В `buildSingboxConfig` (route.ts) добавить второй блок outbound'ов
   рядом с `vlessOutbounds`:
   ```ts
   const hy2Outbounds = activeServers
     .filter(s => s.hy2_password) // отдельная колонка в БД
     .map(s => ({
       type: 'hysteria2',
       tag: `${flag(s.country)} ${countryName(s.country)} (Hy2)`,
       server: s.host,
       server_port: s.hy2_port ?? 8443,
       password: s.hy2_password,
       tls: { enabled: true, server_name: s.hy2_sni ?? s.host },
     }));
   ```
3. Добавить hy2-tag'и в `proxy` selector `outbounds[]` рядом с VLESS.
4. Клиентский patch `filterOutboundsByProtocol` дальше всё разрулит —
   удалит VLESS-outbound'ы при выборе Hysteria и оставит чистый
   Hy2-only конфиг.

**Решение оставляется на product-уровне**: возвращать Hy2 или нет.
Архитектурно клиент готов.

### Файлы (новые / изменённые)

```
hundlerwindows/
├── pubspec.yaml                                  +country_flags 3.2.0
├── lib/services/
│   ├── singbox_config_patch.dart                 +injectProxyInbound,
│   │                                              +filterOutboundsByProtocol,
│   │                                              +hasOutboundOfType
│   ├── update_checker.dart                       NEW (manifest fetch)
│   ├── vpn_service.dart                          +_secureDeleteConfig
│   └── storage_service.dart                      +vpn_mode, +vpn_protocol
├── lib/features/
│   ├── update/update_controller.dart             NEW (FutureProvider)
│   ├── vpn/vpn_mode_controller.dart              NEW
│   ├── vpn/vpn_protocol_controller.dart          NEW
│   ├── vpn/vpn_controller.dart                   +protocol/mode integration
│   ├── home/home_screen.dart                     SVG flags, _RenewButton,
│   │                                              _UpdateBanner,
│   │                                              _ProtocolSwitch,
│   │                                              _VpnModeSwitch
│   └── servers/servers_screen.dart               SVG flags
hundlerminiapp/
└── MINIAPP-AGENTS.md                             +TODO update manifest spec
```

### Verification

```powershell
flutter pub get
flutter analyze --no-pub   # → No issues found! (ran in 6.7s)
flutter run -d windows
```

Sanity check после connect:
```powershell
Test-Path "$env:APPDATA\com.hundlervpn\hundler\config\current.json"
# → False (secure-delete отработал)
```

---

## Батч 2026-05-15-v2 (Hysteria production + protocol moved into ServersScreen)

После первого батча юзер потребовал:
1. **Убрать** отдельный VLESS/Hysteria switch с главной — он повторяет
   функцию TUN/Proxy switch'а и захламляет экран.
2. **Перенести** выбор протокола **внутрь** экрана выбора локаций
   (`ServersScreen`) — логически юзер сначала решает протокол, потом
   видит список тех серверов, что его поддерживают.
3. **На главной** в `_ServerCard` показывать активный протокол —
   `Локация · VLESS` / `Локация · Hysteria`.
4. **Реально включить Hysteria** на бэкенде, чтобы DE 213.182.213.183
   снова отдавался клиенту.

### Что сделано

#### Бэкенд (`hundlerminiapp`, v62)

- `app/api/servers/route.ts` — добавлено поле `protocols: string[]`
  (значения `'vless'` всегда + `'hysteria'` если у сервера заполнены
  все четыре `hysteria2_*` колонки в БД). **Не** возвращает
  `hysteria2_password` / `_cert_sha256` — только бинарный факт
  поддержки.
- `app/api/sub/[token]/route.ts::buildSingboxConfig` — Hy2 outbound
  emission **возвращена** (была удалена 2026-05-09 в v60). Сейчас
  отдаётся `type: 'hysteria2'` outbound с tag-суффиксом `(Hy2)`,
  для каждого сервера у которого заполнен `hysteria2_*` блок.
  TLS-pin через `tls.pin_sha256: [<lowercase-hex-sha256>]`. **Без**
  возвращения route-rule «TG-CIDR → hy2Tags[0]» (юзер сам решает).
- Подробности — `hundlerminiapp/MINIAPP-AGENTS.md` секция «v62
  (2026-05-15)».

#### Клиент (`hundlerwindows`)

- `lib/data/models/server.dart` — `HundlerServer.protocols: List<String>`
  + helper `supports(String protocol)`. Парсится из JSON, fallback
  `['vless']` если бэкенд не вернул поле.
- `lib/features/vpn/vpn_protocol_controller.dart` — добавлен
  `serverFilterTag` геттер (`'vless'` / `'hysteria'`) для матчинга
  с `HundlerServer.protocols`. `singboxType` остаётся как есть
  (`'vless'` / `'hysteria2'`) — он уже используется
  `SingboxConfigPatch.filterOutboundsByProtocol`.
- `lib/features/servers/servers_controller.dart::SelectedServerController` —
  слушает `vpnProtocolProvider`. При смене протокола вызывает
  `_reconcile` с новым protocol и **авто-переселектит** первый
  поддерживаемый сервер если текущий не подходит. Persist в
  `StorageService.selected_server_id`.
- `lib/features/servers/servers_screen.dart` — новый
  `_ProtocolToggle` widget в шапке (segment control VLESS/Hysteria,
  стиль идентичен `_VpnModeSwitch`). Список серверов фильтруется
  через `s.supports(protocol.serverFilterTag)`. Если фильтр оставил
  пустоту — показываем `_ProtocolEmptyState` с кнопкой «Переключиться
  на VLESS». Pills на карточке сервера — динамические (`VLESS · REALITY`
  для VLESS-only, `+ HYSTERIA` для Hy2-серверов).
- `lib/features/home/home_screen.dart`:
  - `_ProtocolSwitch` **удалён** с главной.
  - `_ServerCard` принимает `protocol: VpnProtocol` и показывает
    overline `Локация · ${protocol.displayName}`. Pixel-perfect
    под фигму юзера: `Локация · Hysteria` сразу даёт понять что
    выбрано.
- `lib/services/singbox_config_patch.dart::injectServerDomainBootstrap` —
  whitelist расширен до `{vless, trojan, hysteria, hysteria2, tuic,
  shadowsocks, vmess}`. Сейчас DE Hy2 идёт по IP, но при будущей
  миграции на DNS-имя bootstrap всё ещё будет работать.

### UX flow

1. Юзер открывает приложение → видит главную с тигром, server-card
   `Локация · VLESS`, режим Туннель.
2. Тапает по server-card → `ServersScreen`.
3. В шапке экрана видит segment control `[VLESS] [Hysteria]`. Снизу
   — список локаций, отфильтрованный под VLESS (все 3 страны).
4. Тапает Hysteria → segment перекрашивается, список фильтруется
   до 1 сервера (DE), `SelectedServerController` авто-переключает
   выбранный сервер на DE если был не он.
5. Тапает по DE → `ServersScreen` закрывается, возврат на главную.
   server-card теперь `Локация · Hysteria` с DE флагом.
6. Жмёт ConnectTiger → клиент дёргает `/api/sub/{token}`, фильтрует
   outbounds по `hysteria2`, pin'ит DE как default selector,
   запускает sing-box. Тигр зелёный, IP немецкий, трафик идёт через
   QUIC/UDP на 8443 а не TCP/443.

### Verification

```powershell
flutter pub get
flutter analyze --no-pub  # → No issues found! (ran in 5.2s)
```

Smoke на бэкенде (когда он будет задеплоен с v62):
```powershell
$tok = "<sub_token>"
$r = Invoke-RestMethod -Headers @{ "User-Agent" = "HundlerVPN/0.2.0 (Windows; Windows 11) sing-box/1.13.11" } "https://hundlervpn.xyz/api/sub/$tok"
$r.outbounds | Where-Object { $_.type -eq 'hysteria2' } | Select-Object tag, server, server_port
# → 🇩🇪 Германия | Pro (Hy2)  213.182.213.183  8443
```

```powershell
$srv = Invoke-RestMethod "https://hundlervpn.xyz/api/servers"
$srv.servers | ForEach-Object { "$($_.country): $($_.protocols -join ', ')" }
# → DE: vless, hysteria
# → NL: vless
# → RU: vless
```
