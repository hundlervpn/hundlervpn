#!/usr/bin/env python3
"""
xray-webhook — tiny HTTP endpoint that triggers maintenance scripts on demand.

Listens on 0.0.0.0:$LISTEN_PORT. Accepts (token-protected):
  POST /sync     — fire-and-forget /opt/xray-sync.sh (used by main API on UUID changes).
                   Optional ?async=1 returns 202 instantly without waiting.
  POST /traffic  — synchronously runs /opt/xray-traffic.sh and /opt/hy2-traffic.sh
                   (whichever exist), waits for them to finish, returns 200 with
                   per-script results. Used by admin "Обновить" button so freshly
                   collected stats are visible right after the request returns.

All logs go to stderr (captured by systemd / journalctl) plus the sync log file.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
import sys

SYNC_TOKEN = os.environ.get("SYNC_TOKEN", "")
SYNC_SCRIPT = os.environ.get("SYNC_SCRIPT", "/opt/xray-sync.sh")
# Comma-separated list of traffic collector scripts. Missing entries are
# silently skipped — a node that runs only Xray (no Hy2) won't have
# /opt/hy2-traffic.sh and that's fine.
TRAFFIC_SCRIPTS = [
    s.strip() for s in os.environ.get(
        "TRAFFIC_SCRIPTS", "/opt/xray-traffic.sh,/opt/hy2-traffic.sh"
    ).split(",") if s.strip()
]
TRAFFIC_TIMEOUT = int(os.environ.get("TRAFFIC_TIMEOUT", "25"))
LISTEN_HOST = os.environ.get("LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "9999"))
LOG_FILE = os.environ.get("LOG_FILE", "/var/log/xray-sync.log")

if not SYNC_TOKEN:
    print("FATAL: SYNC_TOKEN env is required", file=sys.stderr)
    sys.exit(1)


def _parse_query(query: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for pair in query.split("&"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            out[k] = v
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "xray-webhook/1.1"

    def _respond(self, status: int, body: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write((body + "\n").encode())

    def do_GET(self) -> None:
        # Health check: GET /health -> 200 with capability list so the main API
        # can introspect what this node supports.
        path = self.path.split("?", 1)[0]
        if path == "/health":
            present = [s for s in TRAFFIC_SCRIPTS if os.access(s, os.X_OK)]
            return self._respond(
                200,
                json.dumps({
                    "ok": True,
                    "version": "xray-webhook/1.1",
                    "sync_script": SYNC_SCRIPT,
                    "traffic_scripts": present,
                }),
            )
        return self._respond(404, '{"error":"not found"}')

    def do_POST(self) -> None:
        parts = self.path.split("?", 1)
        path = parts[0]
        query = parts[1] if len(parts) > 1 else ""
        params = _parse_query(query)

        if params.get("token") != SYNC_TOKEN:
            return self._respond(403, '{"error":"forbidden"}')

        if path == "/sync":
            return self._handle_sync(params)
        if path == "/traffic":
            return self._handle_traffic()
        return self._respond(404, '{"error":"not found"}')

    def _handle_sync(self, params: dict[str, str]) -> None:
        try:
            with open(LOG_FILE, "a") as f:
                f.write(f"[webhook] /sync triggered by {self.client_address[0]}\n")
                subprocess.Popen(
                    [SYNC_SCRIPT],
                    stdout=f,
                    stderr=subprocess.STDOUT,
                    close_fds=True,
                )
        except Exception as exc:  # noqa: BLE001
            return self._respond(500, f'{{"error":"spawn failed: {exc}"}}')

        self._respond(202, '{"ok":true,"queued":true}')

    def _handle_traffic(self) -> None:
        # Synchronous: caller (admin "Обновить" button) waits for fresh data.
        # ThreadingHTTPServer handles each request in its own thread so this
        # doesn't block /sync calls happening in parallel.
        present = [s for s in TRAFFIC_SCRIPTS if os.access(s, os.X_OK)]
        if not present:
            return self._respond(
                404,
                '{"error":"no traffic collector installed","tried":'
                + json.dumps(TRAFFIC_SCRIPTS) + '}',
            )

        results = []
        try:
            with open(LOG_FILE, "a") as f:
                f.write(f"[webhook] /traffic triggered by {self.client_address[0]}\n")
                for script in present:
                    try:
                        proc = subprocess.run(
                            [script],
                            stdout=f,
                            stderr=subprocess.STDOUT,
                            timeout=TRAFFIC_TIMEOUT,
                            check=False,
                        )
                        results.append({"script": script, "rc": proc.returncode})
                    except subprocess.TimeoutExpired:
                        results.append({"script": script, "rc": -1, "error": "timeout"})
                    except Exception as exc:  # noqa: BLE001
                        results.append({"script": script, "rc": -1, "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._respond(500, json.dumps({"error": f"log open: {exc}"}))

        ok = all(r.get("rc") == 0 for r in results)
        self._respond(200 if ok else 207, json.dumps({"ok": ok, "results": results}))

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        sys.stderr.write(
            "[%s] %s - %s\n"
            % (self.log_date_time_string(), self.client_address[0], format % args)
        )


def main() -> None:
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"xray-webhook listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
