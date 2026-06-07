"""Quick smoke test: verify DB connection works and list plans + servers + uuid pool stats.

Run: bot-chat\venv\Scripts\python.exe bot-chat\_smoke_test.py

Delete this file after we're confident the bot is integrated.
"""
import db


def main() -> None:
    print("=== plans ===")
    plans = db.list_plans()
    print(f"count: {len(plans)}")
    for p in plans:
        print(
            f"  id={p['id']:>3}  name={p['name']!r:<25}  "
            f"days={p['duration_days']:>4}  price={p['price']!r}  "
            f"max_devices={p['max_devices']}"
        )

    print("\n=== servers (active) ===")
    servers = db.list_servers()
    for s in servers:
        print(f"  id={s['id']}  {s['country']:<3}  name={s['name']!r:<10}  host={s['host']}  port={s['port']}")

    print("\n=== sample referral_stats(user_id=1) ===")
    try:
        stats = db.get_referral_stats(1)
        print(stats)
    except Exception as e:
        print(f"(stats failed: {e})")


if __name__ == "__main__":
    main()
