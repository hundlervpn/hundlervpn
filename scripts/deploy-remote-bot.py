import os
from pathlib import Path
import time

import paramiko


def run(client: paramiko.SSHClient, cmd: str) -> str:
    stdin, stdout, stderr = client.exec_command(cmd)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', 'ignore')
    err = stderr.read().decode('utf-8', 'ignore')
    if exit_code != 0:
        raise RuntimeError(f"Command failed ({exit_code}): {cmd}\nSTDERR:\n{err}\nSTDOUT:\n{out}")
    return out.strip()


def run_with_retry(client: paramiko.SSHClient, cmd: str, retries: int = 60, delay_seconds: int = 10) -> str:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return run(client, cmd)
        except RuntimeError as error:
            last_error = error
            message = str(error)
            if 'Could not get lock /var/lib/dpkg/lock-frontend' not in message:
                raise
            if attempt == retries:
                raise
            time.sleep(delay_seconds)

    if last_error:
        raise last_error
    raise RuntimeError('Unknown retry failure')


def main() -> None:
    host = os.environ['BOT_DEPLOY_HOST']
    user = os.environ['BOT_DEPLOY_USER']
    password = os.environ['BOT_DEPLOY_PASSWORD']

    app_url = os.getenv('BOT_APP_URL', 'https://mihanyazaretsky-hundlervpn-4333.twc1.net/')
    bot_token = os.getenv('BOT_TELEGRAM_TOKEN', '').strip()

    local_main = Path('bot/main.py').resolve()
    if not local_main.exists():
        raise FileNotFoundError(f'Bot file not found: {local_main}')

    remote_dir = '/opt/hundler-bot'

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, look_for_keys=False, allow_agent=False, timeout=20)

    try:
        run_with_retry(client, 'apt-get update -y')
        run_with_retry(client, 'DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv python3-pip')
        run(client, f'mkdir -p {remote_dir}')

        sftp = client.open_sftp()
        try:
            sftp.put(str(local_main), f'{remote_dir}/main.py')
        finally:
            sftp.close()

        env_text = f'APP_URL={app_url}\nTELEGRAM_BOT_TOKEN={bot_token}\n'
        run(client, f"cat > {remote_dir}/.env <<'EOF'\n{env_text}EOF")

        run(client, f'python3 -m venv {remote_dir}/.venv')
        run(client, f'{remote_dir}/.venv/bin/pip install --upgrade pip')
        run(client, f'{remote_dir}/.venv/bin/pip install aiogram')

        service = f'''[Unit]
Description=Hundler Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory={remote_dir}
EnvironmentFile={remote_dir}/.env
ExecStart={remote_dir}/.venv/bin/python {remote_dir}/main.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
'''
        run(client, "cat > /etc/systemd/system/hundler-bot.service <<'EOF'\n" + service + "EOF")
        run(client, 'systemctl daemon-reload')
        run(client, 'systemctl enable hundler-bot.service')

        if bot_token:
            run(client, 'systemctl restart hundler-bot.service')
            status = run(client, 'systemctl is-active hundler-bot.service')
            print('SERVICE_STATUS=' + status)
        else:
            run(client, 'systemctl stop hundler-bot.service || true')
            print('SERVICE_STATUS=stopped')
            print('BOT_TELEGRAM_TOKEN is empty; set it and restart service.')

        print(run(client, 'systemctl status hundler-bot.service --no-pager | head -n 14'))
    finally:
        client.close()


if __name__ == '__main__':
    main()
