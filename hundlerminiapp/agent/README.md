# hundler-xray-agent

Drop-in замена `/opt/xray-sync.sh` (bash + jq + cron) и `/opt/xray-webhook.py`
(Python) — единый Node.js/Bun-бинарь, который синхронизирует клиентов
Xray через **gRPC `HandlerService.AlterInbound`** вместо перезаписи
`config.json` и `systemctl restart xray`.

## Зачем это нужно

| Проблема legacy bash | Решение в agent |
|----------------------|-----------------|
| `jq --argjson clients $X` падает с `Argument list too long` (ARG_MAX) когда пул > ~1500 UUID. Silent failure. | gRPC принимает structured messages. Никаких argv-лимитов. |
| Каждый change UUID-set → `systemctl restart xray` → drop ВСЕХ TCP-сессий на 5–15 секунд. | `AlterInbound{add_user/remove_user}` — hot reload в running memory. NO restart, NO drop. |
| 5-минутный лаг (cron) до synca + race conditions с webhook. | Webhook + 5-мин cron остаются, но добавление user'а инстант — gRPC roundtrip ~5 ms к localhost. |
| Bash silent fail. Диагностика по 1.5 часа (инцидент 2026-05-24 DE: 4 дня терялись UUIDs). | Structured JSON-логи, type-safe ошибки, observability через `journalctl -u hundler-xray-agent`. |
| Фрагментированные скрипты: `xray-sync.sh`, `xray-webhook.py`, `xray-webhook.service`, `setup-*-server.sh` (3 копии sync-скрипта). | Один бинарь + один systemd unit + один env-файл. |

## Архитектура

```
┌──────────────────────┐                            ┌──────────────────────────────┐
│  mini-app (Hostman)  │                            │       VPN-нода (DE/NL/RU)    │
│                      │  HTTPS POST :9999/sync     │                              │
│  lib/xray-webhook.ts │ ─────────────────────────► │  hundler-xray-agent (:9999)  │
│  triggerXraySync()   │                            │      │                       │
│                      │ ◄───────────────────────── │      │ (1) GET /api/xray/    │
│  /api/xray/clients   │  (1) HTTPS pull            │      │     clients?token=    │
│                      │                            │      │                       │
└──────────────────────┘                            │      │ (2) gRPC localhost    │
                                                    │      │     127.0.0.1:10085   │
                                                    │      ▼                       │
                                                    │  ┌─────────────────────┐     │
                                                    │  │  Xray (running)     │     │
                                                    │  │  HandlerService:    │     │
                                                    │  │  • ListInbounds     │     │
                                                    │  │  • AlterInbound     │     │
                                                    │  │    (add/rm user)    │     │
                                                    │  └─────────────────────┘     │
                                                    │      │                       │
                                                    │      │ (3) write snapshot    │
                                                    │      ▼                       │
                                                    │  /usr/local/etc/xray/        │
                                                    │  config.json (для recovery)  │
                                                    └──────────────────────────────┘
```

### Что НЕ меняется

- mini-app endpoint `/api/xray/clients` — agent его дёргает с теми же
  параметрами (`?token=...`, header `X-Server-Host`). Нет изменений в
  `app/api/xray/`.
- mini-app webhook layer `lib/xray-webhook.ts` — агент слушает на том же
  порту 9999 и принимает тот же `POST /sync?token=...&async=1`. mini-app
  даже не узнает, что на ноде уже не Python.
- VLESS+Reality wire-протокол — клиенты (sing-box на Android/iOS/Windows)
  работают неизменно.

### Что меняется

| Раньше | Теперь |
|---------|--------|
| `/opt/xray-sync.sh` (bash) | `/opt/hundler-xray-agent` (Bun-binary) |
| `/opt/xray-webhook.py` (Python webhook listener) | встроен в тот же бинарь |
| `/etc/systemd/system/xray-webhook.service` | `/etc/systemd/system/hundler-xray-agent.service` |
| `*/5 * * * * /opt/xray-sync.sh` (cron) | встроенный 5-мин таймер внутри agent |
| `jq` patch + `systemctl restart xray` | `AlterInbound` gRPC, no restart |

## Сборка

Сборка использует **Bun** для single-file бинаря (~70 МБ, включает Node
runtime, `@grpc/grpc-js`, `@grpc/proto-loader`, и наш TS-код).

```bash
cd hundlerminiapp/agent
bun install
bun run build:linux       # → dist/xray-sync (Linux x64, дефолт прод)
# опционально:
bun run build:linux-arm64 # → dist/xray-sync-arm64 (ARM-серверы, если будут)
```

Альтернатива (без Bun) — `pkg`, но Bun проще и быстрее.

## Deploy на одну ноду (поэтапный rollout)

**Безопасно**: оба пути (legacy bash + новый agent) могут сосуществовать,
но в один момент времени работает только один. Скрипт `install-on-vps.sh`
автоматически отключает legacy перед запуском нового.

```bash
# 1. (один раз) Убедись что нода имеет API inbound на 127.0.0.1:10085.
#    Свежие ноды (после v68 setup-*.sh) уже имеют. Старые — патчим:
ssh root@<vps> 'bash -s' < agent/deploy/add-api-inbound.sh

# 2. Скопируй бинарь, proto/, systemd unit и установщик:
#    proto/ нужен потому что bun --compile НЕ embed'ит .proto-файлы,
#    agent резолвит их через process.execPath на runtime.
scp dist/xray-sync \
    agent/deploy/hundler-xray-agent.service \
    agent/deploy/install-on-vps.sh \
    root@<vps>:/tmp/
scp -r agent/proto root@<vps>:/tmp/

# 3. Запусти install с реальными значениями из БД (servers таблица):
ssh root@<vps> "bash /tmp/install-on-vps.sh \
  --sync-token '<DB.servers.sync_token>' \
  --server-host '<DB.servers.host>' \
  --api-url 'https://hundlervpn.xyz/api/xray/clients'"

# 4. Smoke test — health endpoint должен вернуть JSON c "ok": true:
curl -fsS http://<vps>:9999/health
# {"ok":true,"version":"hundler-xray-agent/0.1","sync_script":"grpc",...}

# 5. Из mini-app: триггерни sync и проверь логи:
#    На прод сервере (через webhook ручкой или просто открыв админку),
#    создай нового user'а — agent должен инстант увидеть webhook,
#    сделать gRPC AddUser, и в логах появится structured JSON-line:
ssh root@<vps> 'journalctl -u hundler-xray-agent -f --no-pager'
# {"ts":"...","level":"info","msg":"sync: done","added":1,"removed":0,...}
```

## Rollback

Безопасный — возвращает legacy bash + python webhook back online:

```bash
ssh root@<vps> 'bash /tmp/install-on-vps.sh --uninstall'
```

Скрипт:
1. Останавливает + дизаблит `hundler-xray-agent.service`.
2. Удаляет бинарь и env-файл.
3. Реактивирует `xray-webhook.service` (если файл сохранился).
4. Восстанавливает cron `*/5 * * * * /opt/xray-sync.sh` если был удалён.

`/opt/xray-sync.sh` и `/opt/xray-webhook.py` физически НЕ удаляются при
deploy — остаются как safety net. Удаляем их только в **финальной**
фазе миграции (после успешного rollout на всех нодах + 1 неделя
мониторинга).

## ENV переменные (см. `agent/src/config.ts`)

| Имя | Дефолт | Описание |
|-----|--------|----------|
| `SYNC_TOKEN` | (required) | Per-server token из `servers.sync_token`. |
| `WEBHOOK_TOKEN` | = `SYNC_TOKEN` | Token для входящих POST `/sync`. |
| `API_URL` | `https://hundlervpn.xyz/api/xray/clients` | mini-app endpoint. |
| `INBOUND_TAG` | `vless-in` | Тэг VLESS inbound в config.json. |
| `GRPC_TARGET` | `127.0.0.1:10085` | Адрес локального HandlerService. |
| `WEBHOOK_PORT` | `9999` | HTTP listener для mini-app push. |
| `PULL_INTERVAL_MS` | `300000` | Periodic safety-net pull. |
| `SERVER_HOST` | `''` | Header `X-Server-Host` для правильного flow. |
| `XRAY_CONFIG_PATH` | `/usr/local/etc/xray/config.json` | Куда писать snapshot. |
| `SANITY_FLOOR` | `1` | Минимум desired clients. < этого = abort. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |

## Observability

```bash
# Tail логов (structured JSON):
journalctl -u hundler-xray-agent -f --no-pager

# Парсинг через jq:
journalctl -u hundler-xray-agent --since '1 hour ago' -o cat | jq -r '.msg'

# Health probe:
curl -fsS http://127.0.0.1:9999/health | jq

# Список текущих клиентов в Xray (через сам agent):
# (TODO: добавить /clients debug endpoint в webhook-server.ts)
```

## Снятие риска

- **Sanity floor** — agent отказывается применять snapshot где < N
  desired clients (та же логика что в bash version, защищает от
  пустого ответа API во время Hostman-deploy).
- **xray -test** перед каждым `mv` config.json.new → config.json — если
  Xray откажется парсить, файл не перезаписывается.
- **Hot apply через gRPC** — даже если config.json snapshot упадёт,
  running Xray уже в нужном состоянии. Snapshot — только для recovery
  после рестарта, и при следующем successful tick'е agent его повторит.
- **5-мин cron-fallback** — если webhook от mini-app потерялся
  (network blip, deploy), agent сам подтянется максимум через 5 минут.
- **Rollback одной командой** (см. выше).

## Будущие улучшения (Phase 2)

После того как Phase 1 (drop-in replacement) стабилизируется, можно:

1. **Push delta from mini-app** — `lib/xray-grpc.ts` в mini-app дёргает
   агент с `POST /v1/add-user` или `/v1/remove-user` напрямую (вместо
   force-refetch всего пула). Уберёт нагрузку на `/api/xray/clients`
   и сократит instant-add latency с ~150 ms до ~30 ms.
2. **gRPC mTLS** — если решим открыть management plane наружу
   (e.g. для multi-region admin actions). Сейчас 127.0.0.1 only,
   TLS не нужен.
3. **Stats endpoint** — `GetInboundUsersCount` через gRPC возвращает
   живой counter без парсинга `xray-traffic.sh` output. Полезно для
   admin dashboard.
4. **Reload self** — agent умеет читать новый бинарь и перезапускать
   себя (`SIGUSR2`-style hot reload), чтобы deploy не дропал webhook
   listener даже на 100ms.
