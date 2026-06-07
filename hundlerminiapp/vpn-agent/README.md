# Hundler VPN Agent

Универсальный агент для VPN серверов. Автоматически синхронизирует статистику подключений с центральным API.

## Быстрая установка

```bash
# Замени YOUR_API_KEY на ключ из админки
curl -sSL https://raw.githubusercontent.com/hundlervpn/hundlervpn/main/vpn-agent/install.sh | bash -s YOUR_API_KEY
```

## Ручная установка

```bash
# 1. Создать директории
mkdir -p /opt/hundler-agent /var/lib/hundler-agent

# 2. Скопировать скрипт
cp hundler-agent.sh /opt/hundler-agent/
chmod +x /opt/hundler-agent/hundler-agent.sh

# 3. Настроить сервис
cp hundler-agent.service /etc/systemd/system/
# Отредактировать HUNDLER_API_KEY в сервисе
nano /etc/systemd/system/hundler-agent.service

# 4. Запустить
systemctl daemon-reload
systemctl enable hundler-agent
systemctl start hundler-agent
```

## Конфигурация

Переменные окружения в `/etc/systemd/system/hundler-agent.service`:

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `HUNDLER_API_KEY` | API ключ сервера из БД | - |
| `HUNDLER_API_URL` | URL центрального API | https://hundler.ru/api/vpn/sync |
| `XRAY_ACCESS_LOG` | Путь к логу Xray | /var/log/xray/access.log |
| `SYNC_INTERVAL` | Интервал синхронизации (сек) | 60 |

## Управление

```bash
# Статус
systemctl status hundler-agent

# Логи
journalctl -u hundler-agent -f

# Перезапуск
systemctl restart hundler-agent

# Остановка
systemctl stop hundler-agent
```

## Получение API ключа

1. Добавить сервер в админке или через БД
2. Сгенерировать api_key для сервера:

```sql
UPDATE servers SET api_key = 'sk_' || encode(gen_random_bytes(24), 'hex') WHERE id = 1;
```

## Требования к Xray

Для корректной работы агента, в конфиге Xray должно быть включено логирование:

```json
{
  "log": {
    "access": "/var/log/xray/access.log",
    "loglevel": "info"
  }
}
```

И в inbound должен быть указан email с key_hash:

```json
{
  "inbounds": [{
    "settings": {
      "clients": [{
        "id": "uuid",
        "email": "KEY_HASH_HERE"
      }]
    }
  }]
}
```
