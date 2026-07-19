# Containerized HundlerVPN chat-only bot.
# Previously ran as the systemd unit `hundlervpn-bot-chat.service` on the
# host; now runs as the `bot-chat` service in the same docker-compose stack.
# Uses a DIFFERENT Telegram token than the `bot` service (they must never
# share a token or getUpdates long-polling collides).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the whole bot-chat package (main.py, config.py, db.py, handlers/, ...).
# .env is intentionally NOT copied (see .dockerignore) — config comes from
# the compose `environment:` block at runtime.
COPY . ./

ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
