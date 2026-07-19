# Containerized HundlerVPN Telegram launcher + broadcast bot.
# Previously ran as the systemd unit `hundlervpn-bot.service` on the host;
# now runs as the `bot` service in the same docker-compose stack so it
# shares the internal `web` network with `app` and `postgres` (no more
# host->container DB reachability / sslmode surprises that broke broadcasts).
FROM python:3.12-slim

# psycopg2-binary ships manylinux wheels, so no build toolchain is needed.
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the bot source (main.py + welcome.png). .env is intentionally NOT
# copied (see .dockerignore) — all config comes from the compose
# `environment:` block at runtime.
COPY . ./

# Unbuffered stdout so logs stream to `docker compose logs` in real time.
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
