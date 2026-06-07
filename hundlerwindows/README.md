# Hundler VPN — Windows client

Flutter Desktop клиент Hundler VPN под Windows 10/11.

VPN-стек: **sing-box.exe** (VLESS + Reality + XUDP) под управлением
elevated helper-сервиса, TUN через **wintun.dll**.

## Перед началом

Прочитай в таком порядке:

1. **`../AGENTS.md`** — общие правила HundlerAll (бренд, API, протокол).
2. **`../hundlerminiapp/MINIAPP-AGENTS.md`** — как работает бэкенд и
   подписка (источник правды для VPN-конфига).
3. **`WINDOWS-AGENTS.md`** — Windows-специфика (архитектура helper-сервиса,
   wintun, packaging, code signing).

## Текущий статус (2026-05-14)

🚧 **Скаффолд.** Готовы:

- Flutter Desktop проект (`flutter create --platforms=windows`)
- Дизайн-токены (`lib/core/colors.dart`, `theme.dart`, `typography.dart`)
- Логотип «дышащий тигр» (`lib/features/home/widgets/tiger_logo.dart`)
- Home-screen заглушка с Connect-кнопкой (без реального VPN)
- `window_manager` — frameless окно 420×720, hide title-bar
- Базовая структура `lib/` под расширение

Ещё **не** сделано:

- helper-сервис (Rust) — управление sing-box.exe через named pipe
- интеграция sing-box.exe + wintun.dll
- auth-flow (Telegram-login / Google через системный браузер + `hundler://`)
- system tray + hide-to-tray
- subscription poll → /api/sub
- installer (Inno Setup) + MSIX для Microsoft Store

Полный план — в `WINDOWS-AGENTS.md` секция «План работ».

## Запуск (dev)

Требуется:

- **Flutter** stable ≥ 3.24 (`flutter doctor`)
- **Visual Studio 2022** с Workload «Desktop development with C++» —
  Flutter Windows runner собирается через MSBuild.
- **Developer Mode** в Windows Settings (Settings → Privacy & Security →
  For developers → Developer Mode = On) — Flutter Desktop с plugins
  использует symlinks для нативных pieces.

```powershell
flutter pub get
flutter analyze        # должен быть "No issues found!"
flutter run -d windows # запустит окно с тигром
```

## Структура

См. `WINDOWS-AGENTS.md` секция «Структура проекта».

Краткий обзор:

```
lib/
  main.dart              ← entry, window_manager init
  app.dart               ← MaterialApp + theme
  core/                  ← дизайн-токены, theme, api_client (TODO)
  features/
    home/                ← главный экран (заглушка)
  services/              ← VPN, auth, storage (TODO)
  platform/windows/      ← deeplink, single-instance (TODO)
helper/                  ← Rust helper-service (TODO)
windows/                 ← Flutter Windows runner (C++ wrapper, не трогаем)
```
