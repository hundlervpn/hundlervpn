# HundlerAll — корневой свод правил

Этот файл — **верхнеуровневые правила для всех проектов HundlerVPN**.
Каждый подпроект имеет свой собственный файл правил с платформенной
спецификой:

- `hundlerminiapp/MINIAPP-AGENTS.md`
- `hundlerandroid/ANDROID-AGENTS.md`
- `hundlerios/IOS-AGENTS.md` *(будет)*
- `hundlerwindows/WINDOWS-AGENTS.md` *(будет)*

Этот файл (`AGENTS.md` в корне `HundlerAll/`) описывает то, что
у них **общее**: бренд, API, протоколы, инфраструктура.

> **Почему имена разные?** Чтобы в IDE / Windsurf rules файлы не сливались в
> одно и то же отображаемое имя. Корневой остаётся `AGENTS.md` — он
> единственный с этим именем в монорепо.

При конфликте: подпроектный файл правил имеет приоритет над этим, но
**только для своей платформы**. Бренд и API-контракт менять без
согласования всех клиентов — нельзя.

---

## Структура монорепо

```
HundlerAll/
├── AGENTS.md                       ← этот файл, общие правила
├── hundlerminiapp/                 ← Next.js: web + Telegram Mini App + API + bot + сервер-скрипты
│   └── MINIAPP-AGENTS.md           ← Next.js, серверы Xray, БД, деплой Hostman
├── hundlerandroid/                 ← Flutter (Dart) + Kotlin (sing-box через libcore.aar)
│   └── ANDROID-AGENTS.md           ← VPNService, нативная интеграция, сборка AAB/APK
├── hundlerios/                     ← Flutter (Dart) + Swift (sing-box через NEPacketTunnelProvider)
│   └── IOS-AGENTS.md               ← Network Extension, App Store, 50 МБ memory cap
└── hundlerwindows/                 ← Flutter (Dart) + Rust/C++ (sing-box + wintun)
    └── WINDOWS-AGENTS.md           ← service / wintun, Microsoft Store, code signing
```

`hundlerminiapp` — **источник правды** для всего бэкенда. Все клиенты
ходят в его API. Никаких автономных бэкендов в нативных приложениях.

---

## Бренд

- **Название**: Hundler VPN
- **Слоган**: «VLESS + Reality, обход DPI»
- **Логотип**: красно-полигональная морда тигра на чёрном фоне с красным
  glow. Источник — `hundlerminiapp/public/tiger-source.png` (PNG, 600×600).
  Превью — `tiger.png` (готовый композит с alpha-маской и glow).
- **Дух**: тёмный, премиум, скоростной, дерзкий. Без синих градиентов
  «как у всех VPN». Чёрный фон + красные акценты + лёгкие оранжевые
  блики на ключевых элементах.

### Дизайн-токены (источник правды)

Цвета (везде должны совпадать пиксель-в-пиксель с мини-аппом):

| Токен              | Hex        | Назначение                             |
|--------------------|------------|----------------------------------------|
| `bg-primary`       | `#020202`  | основной фон                           |
| `bg-surface`       | `#0a0a0a`  | карточки, поверхности                  |
| `bg-elevated`      | `#141414`  | модалки, выпадашки                     |
| `text-primary`     | `#ffffff`  | основной текст                         |
| `text-secondary`   | `#a3a3a3`  | подписи, плейсхолдеры                  |
| `accent-red`       | `#ef4444`  | основной акцент (red-500)              |
| `accent-red-glow`  | `rgba(239,68,68,0.35)` | свечение / shadow              |
| `accent-orange`    | `#f97316`  | вторичный акцент (orange-500)          |
| `success`          | `#22c55e`  | подключено, оплачено                   |
| `danger`           | `#dc2626`  | ошибки, отключено                      |
| `border-subtle`    | `rgba(255,255,255,0.08)` | разделители, контуры карточек |

Шрифты:

- **Inter** — основной текст (sans-serif, regular/medium/semibold).
- **Syncopate** — заголовки и брендовые надписи (display, 400 / 700).

Радиусы: `8 / 12 / 16 / 24 px`. Карточки — `16`, кнопки — `12`, чипы — `8`.

Отступы: 4-точечная сетка (`4 / 8 / 12 / 16 / 20 / 24 / 32 / 48`).

Анимации: «дыхание» логотипа (4 с цикл, ±2 % scale + альфа 0.95→1).
Используй `motion/react` в вебе, `flutter_animate` или `AnimationController`
в Flutter. **Никаких** резких bounce-эффектов — только smooth ease.

### Иконки

- Веб: `lucide-react` (используется в мини-аппе).
- Flutter: **`lucide_icons_flutter`** (порт того же набора). Не мешать
  с Material Icons / Cupertino — должна быть консистентность с вебом.

---

## Локализация

- **Основной язык**: русский. Все строки UI пишутся сначала на русском,
  потом переводятся на английский (опционально на этапе MVP).
- В мини-аппе словарь — `app/page.tsx` константа `translations`.
- В нативных клиентах — `lib/l10n/` через `flutter_localizations` +
  `intl` (ARB-файлы), ключи **должны совпадать** с web-версией там, где
  фразы общие (имена платформ, кнопки оплаты, тексты ошибок). Это
  упрощает синхронизацию.

---

## Публичный API-контракт

**База**: `https://hundlervpn.xyz` (продакшн), `https://staging.hundlervpn.xyz`
(если развернёшь — пока нет). Все эндпоинты — JSON.

### Аутентификация

Сессия — JWT в cookie `hundler_session` (HttpOnly), либо в заголовке
`Authorization: Bearer <jwt>` для нативных клиентов.

Способы логина:

- **Telegram WebApp** (только из мини-аппа) — `/api/auth/telegram`,
  init-data из Telegram.
- **Telegram Login Widget** (для вне-мини-аппа, в т.ч. нативных
  клиентов) — `/api/auth/telegram-login`. Перенаправление в Telegram
  и обратно через deep link.
- **Email-код** — `/api/auth/send-code` → `/api/auth/verify-code`. Шестизначный
  код на e-mail. Триал 1 день при регистрации.
- **Google OAuth** — `/api/auth/google`.

Триал:

- Telegram-регистрация → 3 дня бесплатно, 1 устройство.
- Email-регистрация → 1 день бесплатно, 1 устройство.

### Подписка (главный эндпоинт для VPN-клиентов)

```
GET /api/sub/{token}
```

`token` = `sub_token` пользователя (выдаётся после логина в
`/api/auth/session`). Формат ответа определяется User-Agent клиента.
Подробности и реализация — в `hundlerminiapp/MINIAPP-AGENTS.md` секция
"Subscription Format Per Client" + `app/api/sub/[token]/route.ts`.

**Что должны слать нативные клиенты HundlerVPN**:

- `User-Agent: HundlerVPN/{version} ({platform}; {device-os}) sing-box/{singbox-version}`
  — мы детектим `sing-box` подстроку в UA и отдаём sing-box JSON.
- `X-Device-OS: android|ios|windows|macos|linux`
- `X-Device-Model: <модель>` — для красивого отображения в админке и
  в списке устройств у пользователя.
- `X-HWID: <уникальный hardware id, ANDROID_ID / identifierForVendor / MachineGuid>`
  — стабильный per-device идентификатор для квоты устройств.

Ответ — sing-box JSON со встроенными outbounds (VLESS+Reality+XUDP),
DNS, route rules. **Клиент НЕ строит конфиг сам** — берёт что прислали
и передаёт в core. Это даёт серверу полный контроль над протоколом,
SNI-пулом, маршрутизацией, и позволяет менять их без обновления
клиента.

Заголовки в ответе:

- `subscription-userinfo: upload=…; download=…; total=…; expire=<unix>`
  — стандарт sing-box, показывает остаток трафика и дату истечения.
- `profile-title: Hundler VPN` — отображаемое имя профиля.
- `profile-update-interval: 1` — интервал автообновления (часы).
  **Клиент должен** уважать это значение и поллить раз в час
  минимум — иначе при ротации UUID/SNI получит «invalid request user id».
- `routing: <base64>` — для Happ / v2RayTun. Свои клиенты на sing-box
  ИГНОРИРУЮТ этот заголовок.

### Список серверов (для UI выбора локации)

```
GET /api/servers
```

Возвращает `{ ok: true, servers: [{ id, name, country, host, port, is_active, ... }] }`.
Используется только для **отображения** списка локаций пользователю.
Сами VPN-параметры (UUID, public_key, short_id, sni) встраиваются в
sing-box-конфиг из `/api/sub/{token}`, не отдаются отдельно.

### Управление устройствами

```
GET    /api/users/devices       — список устройств пользователя
DELETE /api/users/devices       — кикнуть устройство (body: { sessionId })
```

Лимит устройств = `subscription.max_devices` (1 на триале, 3 на платной).
При превышении — `/api/sub/{token}` отдаёт sing-box-конфиг с
`{ outbounds: null, remarks: "⛔ Лимит устройств: X/X..." }`. Клиент
обязан показать этот remark пользователю и НЕ пытаться подключаться.

### Оплата

- `/api/payments/sbp/create` — создать инвойс СБП (только Россия).
- `/api/payments/crypto/create` — CryptoBot инвойс.
- `/api/invoice` — Telegram Stars (только из мини-аппа).
- `/api/services/*` — список тарифов и скидок.

Базовый тариф: **7 ₽ / день**, скидки 10 % на 6 месяцев, 15 % на год.

---

## VPN-протокол (что должен уметь нативный клиент)

Все нативные клиенты используют **sing-box** в роли VPN-движка:

- **VLESS + Reality** + **XUDP** packet encoding (для UDP через TCP/443).
- **uTLS chrome fingerprint** — обязательно, иначе DPI палит.
- **TUN режим** через системный VPN API (VPNService / NEPacketTunnelProvider /
  wintun).
- DNS — bootstrap 1.1.1.1 (UDP/53 direct, до поднятия туннеля), потом
  DoH 8.8.8.8 через прокси для зарубежных доменов и DoH 77.88.8.8
  напрямую для `*.ru / *.su / .рф`.

Почему sing-box, а не xray-core напрямую:

- Готовый Android binding (`libcore.aar` от Hiddify, ~30 МБ APK delta).
- Готовый iOS binding (sing-box-for-ios, через NetworkExtension).
- Один и тот же конфиг-формат на всех платформах.
- Уже умеет всё что нам надо: Reality, XUDP, TUN, sniffing, routing.
- **Бэкенд уже отдаёт готовый sing-box JSON** — нативные клиенты просто
  передают его в core без преобразований.

Важно про память (iOS / 50 МБ memory cap внутри Network Extension):

- Не загружать большие geosite/geoip файлы. Бэкенд отдаёт конфиг с
  inline-CIDR и keyword-rules, без `geosite:`/`geoip:` ссылок (см.
  v49 заметку в `hundlerminiapp/MINIAPP-AGENTS.md`).
- На Windows / Android ограничение мягче, но всё равно: тяни geo-файлы
  только если пользователь явно включил «расширенные правила».

---

## Архитектурный принцип нативных клиентов

```
┌─────────────────────────────────────────┐
│  Flutter (Dart)                         │  ← UI, навигация, локализация
│  - дизайн-система Hundler               │
│  - state management (riverpod)          │
│  - Dio для API мини-аппа                │
└──────────────┬──────────────────────────┘
               │  platform channel
               │  (MethodChannel + EventChannel)
┌──────────────▼──────────────────────────┐
│  Native (Kotlin / Swift / Rust)         │  ← VPN core, системные API
│  - sing-box core                        │
│  - VPNService / NEPacketTunnel / wintun │
│  - keychain / keystore                  │
└─────────────────────────────────────────┘
```

**Правило**: ничего критичного для VPN не делается во Flutter.
Авторизация и управление подпиской — Flutter. Туннель, ключи,
конфиг — нативная сторона. Это нужно потому что:

- На iOS Network Extension работает в **отдельном процессе** с
  собственной 50 МБ-кучей. Flutter туда не запихаешь.
- На Android VPNService может пережить kill основного приложения,
  и должен работать сам.
- Безопаснее — секреты не пляшут через Dart-runtime.

---

## Git-стратегия

Один монорепо на `HundlerAll/` (если ещё не сделано — мигрировать
`hundlerminiapp/.git` на верхний уровень):

```bash
# из HundlerAll/
mv hundlerminiapp/.git .git
git add hundlerminiapp/ hundlerandroid/ hundlerios/ hundlerwindows/ AGENTS.md
git commit -m "monorepo: split clients into per-platform folders"
```

Бранчи:

- `main` — продакшн мини-аппа (Hostman автодеплой).
- `client/android`, `client/ios`, `client/windows` — фичебранчи
  для нативных клиентов. Сливаются в `main` после ревью.

CI per-папка (когда дойдут руки):

- `hundlerminiapp/**` → деплой на Hostman.
- `hundlerandroid/**` → сборка AAB + APK, релиз через Fastlane.
- `hundlerios/**` → сборка IPA, TestFlight через Fastlane.
- `hundlerwindows/**` → сборка `.msix` + standalone `.exe`.

Pre-commit для всего монорепо: запретить коммит `node_modules/`,
`.gradle/`, `Pods/`, `build/`, `*.keystore`, `*.p12`.

---

## Конвенции коммитов

```
<scope>: <message>
```

`scope` = одно из `web`, `bot`, `xray`, `android`, `ios`, `windows`,
`shared`, `infra`, `docs`. Примеры:

```
android: home screen + tiger logo skeleton
shared: bump SNI pool to include yastatic.net
xray: setup-rf-server.sh -- pin to BBR + fq
docs: AGENTS.md -- describe subscription format
```

---

## Что делать перед началом работы в любом клиенте

1. Прочитать **этот** файл целиком (`HundlerAll/AGENTS.md`).
2. Прочитать `hundlerminiapp/MINIAPP-AGENTS.md` — для контекста по
   серверам и API.
3. Прочитать **свой** `<client>/<PLATFORM>-AGENTS.md`
   (например `hundlerandroid/ANDROID-AGENTS.md`) — он перебивает
   общие правила только в платформо-специфичной части.
4. Если меняется API — править **сначала**
   `hundlerminiapp/MINIAPP-AGENTS.md` (раздел Subscription Format /
   Per Client), **потом** код мини-аппа, **потом** клиентов.
   Несоблюдение порядка ломает существующих пользователей.
