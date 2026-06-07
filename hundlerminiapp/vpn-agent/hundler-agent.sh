#!/bin/bash
# Hundler VPN Agent - универсальный скрипт для VPN серверов
# Устанавливается один раз на каждый VPN сервер
# Периодически отправляет статистику подключений на центральный API

# ===== КОНФИГУРАЦИЯ =====
API_URL="${HUNDLER_API_URL:-https://hundler.ru/api/vpn/sync}"
API_KEY="${HUNDLER_API_KEY:-}"
XRAY_LOG="${XRAY_ACCESS_LOG:-/var/log/xray/access.log}"
SYNC_INTERVAL="${SYNC_INTERVAL:-60}"  # секунд
STATE_FILE="/var/lib/hundler-agent/last_pos"

# ===== ФУНКЦИИ =====

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

check_config() {
    if [ -z "$API_KEY" ]; then
        log "ERROR: HUNDLER_API_KEY not set"
        exit 1
    fi
}

init_state() {
    mkdir -p /var/lib/hundler-agent
    if [ ! -f "$STATE_FILE" ]; then
        echo "0" > "$STATE_FILE"
    fi
}

# Парсим User-Agent или другие данные для определения устройства
detect_device_type() {
    local info="$1"
    local ua=$(echo "$info" | tr '[:upper:]' '[:lower:]')
    
    if [[ "$ua" == *"iphone"* ]]; then
        echo "iPhone"
    elif [[ "$ua" == *"ipad"* ]]; then
        echo "iPad"
    elif [[ "$ua" == *"android"* ]]; then
        echo "Android"
    elif [[ "$ua" == *"mac"* ]] || [[ "$ua" == *"darwin"* ]]; then
        echo "Mac"
    elif [[ "$ua" == *"windows"* ]]; then
        echo "Windows"
    elif [[ "$ua" == *"linux"* ]]; then
        echo "Linux"
    else
        echo ""
    fi
}

# Парсим логи Xray и извлекаем подключения
parse_xray_log() {
    local last_pos=$(cat "$STATE_FILE" 2>/dev/null || echo "0")
    local current_size=$(stat -c%s "$XRAY_LOG" 2>/dev/null || echo "0")
    
    # Если лог был ротирован (размер меньше позиции)
    if [ "$current_size" -lt "$last_pos" ]; then
        last_pos=0
    fi
    
    # Читаем новые строки
    local connections="[]"
    local count=0
    
    if [ -f "$XRAY_LOG" ] && [ "$current_size" -gt "$last_pos" ]; then
        # Парсим логи - ищем строки с email (который содержит key_hash)
        # Формат Xray: ... email: <key_hash> ...
        while IFS= read -r line; do
            # Извлекаем email (key_hash) из строки
            if [[ "$line" =~ email:\ *([a-zA-Z0-9_-]+) ]]; then
                local key_hash="${BASH_REMATCH[1]}"
                local device_type=$(detect_device_type "$line")
                local timestamp=$(echo "$line" | grep -oP '\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}' | head -1)
                
                # Добавляем в JSON
                if [ "$count" -gt 0 ]; then
                    connections="${connections%]},{ \"keyHash\": \"$key_hash\", \"deviceType\": \"$device_type\", \"connectedAt\": \"$timestamp\" }]"
                else
                    connections="[{ \"keyHash\": \"$key_hash\", \"deviceType\": \"$device_type\", \"connectedAt\": \"$timestamp\" }]"
                fi
                ((count++))
            fi
        done < <(tail -c +$((last_pos + 1)) "$XRAY_LOG" 2>/dev/null | grep -i "accepted")
        
        # Сохраняем позицию
        echo "$current_size" > "$STATE_FILE"
    fi
    
    echo "$connections"
}

# Отправляем статистику на центральный API
sync_connections() {
    local connections="$1"
    
    if [ "$connections" == "[]" ]; then
        return 0
    fi
    
    local response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"connections\": $connections}" \
        --connect-timeout 10 \
        --max-time 30)
    
    local http_code=$(echo "$response" | tail -1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" == "200" ]; then
        log "Sync OK: $body"
        return 0
    else
        log "Sync FAILED ($http_code): $body"
        return 1
    fi
}

# Основной цикл
main_loop() {
    log "Starting Hundler VPN Agent"
    log "API: $API_URL"
    log "Log: $XRAY_LOG"
    log "Interval: ${SYNC_INTERVAL}s"
    
    while true; do
        local connections=$(parse_xray_log)
        local count=$(echo "$connections" | grep -o "keyHash" | wc -l)
        
        if [ "$count" -gt 0 ]; then
            log "Found $count new connections"
            sync_connections "$connections"
        fi
        
        sleep "$SYNC_INTERVAL"
    done
}

# ===== MAIN =====
check_config
init_state
main_loop
