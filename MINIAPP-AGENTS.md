# Hundler Mini App — Свод Правил (MINIAPP-AGENTS)

Этот файл — краткий путеводитель по кодовой базе и базовым правилам `hundlerminiapp`. 
Детальная информация о компонентах системы вынесена в папку `docs/`.

## Индекс документации (Память)

> **Агент, открой нужный файл из `hundlerminiapp/docs/` только когда это требуется для текущей задачи:**

- `docs/architecture.md` — Tech Stack, общая архитектура.
- `docs/vpn.md` — Архитектура VPN серверов, Hysteria2, роутинг (UDP bypass), синхронизация Xray/sing-box (UUID Pool), настройка узлов.
- `docs/billing.md` — Подписки, платежи, трекинг устройств и сессий, лимиты и кики.
- `docs/bot.md` — Telegram-боты (основной Mini App бот и chat-only бот).
- `docs/frontend.md` — Структура интерфейса, авторизация (Google, Email, Telegram).
- `docs/database.md` — Подключение к базе данных.
- `docs/deployment.md` — Деплой на собственный VPS через Docker Compose, переменные окружения.
- `docs/planned.md` — Запланированные фичи, TODO, оптимизация.

## Структура проекта
```
hundlerminiapp/
├── app/                  ← Next.js App Router (pages, api)
│   ├── api/              ← Бэкенд API (auth, sub, payments, xray)
│   └── page.tsx          ← Главная SPA-страница (Mini App + Web)
├── components/           ← React-компоненты
├── lib/                  ← Бизнес-логика, утилиты, генерация подписок
├── db/                   ← Схема БД (schema.sql)
├── bot/                  ← Основной Telegram-бот
├── bot-chat/             ← Дополнительный бот только для чатов
├── scripts/              ← Скрипты настройки серверов (bash) и миграций (js)
└── docs/                 ← Подробная документация проекта
```

## Критичные ограничения (MUST READ)
1. **Docker / Деплой на свой VPS (2026-07):** Проект переехал с Hostman на
   собственный сервер `159.195.58.174`. Автодеплоя по git push **больше нет** —
   деплой это ручной `docker compose -f docker-compose.yml -f docker-compose.selfhosted.yml up -d --build`
   на сервере (подробно в `docs/deployment.md`).
   ⚠️ Базовый образ строго зафиксирован на `node:20.18-alpine3.20` (в новых версиях баг экспорта BuildKit). Не менять без проверки полной сборки и деплоя.
2. **База данных:** Postgres теперь **контейнер на том же VPS** (`hundler-postgres`, из `docker-compose.selfhosted.yml`, том `pgdata`, автоприменение схемы). Приложение ходит по внутренней Docker-сети (`POSTGRESQL_HOST=postgres`, `sslmode=disable`). Старые Timeweb и Hostman Managed PG мертвы — не подключаться. **НИКОГДА не коммитить пароли от БД** — только `.env` (в .gitignore).
3. **Обновление UUID (Instant Connect):** VPN клиенты не ждут рестарта Xray. Мы используем предзаполненный `uuid_pool` в Xray. `api/sub/[token]` просто переименовывает уже существующий UUID. Не ломать этот механизм синхронизации.
4. **v2rayTun Совместимость:** Клиент v2rayTun падает от обычного Xray JSON. Для него API (`api/sub/[token]`) отдает только `base64 VLESS URIs`.
5. **UDP Роутинг (Discord Voice / Звонки):** VLESS (vision) работает только по TCP. Чтобы звонки работали, в конфигах клиентов используется правило `network: udp → direct` (обход VPN для UDP-трафика).

## Правила Кодстайла
- Используем React 18 / Next.js 14+ (App Router). Фронт и API в одном приложении.
- Стили: TailwindCSS. Мобильная верстка первостепенна (`viewport-fit=cover`, padding-ы для челок).
- Темная тема — основная (`bg-zinc-950`).
- Локализация: интерфейс пишется в первую очередь на русском языке, переводы хранятся в коде (`translations.ru`, `translations.en`).
- Строгая типизация: TypeScript для API ответов и пропсов компонентов.

## Команды Сборки
- `npm install` — установка зависимостей.
- `npm run dev` — запуск локально на `http://localhost:3000`.
- `npm run build` — продакшен сборка Next.js.
- `npm start` — запуск продакшен билда.
- `docker build -t hundler-app .` — сборка образа для проверки перед пушем в Hostman.

## Git
- Репозиторий: `https://github.com/hundlervpn/hundlervpn.git` (main).
- Пуш идет в `origin/main`. Автодеплоя больше нет — после пуша нужно вручную
  задеплоить на сервере (`git pull` + `docker compose ... up -d --build app`,
  см. `docs/deployment.md`).
