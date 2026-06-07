import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { parseSubTokenV2, parseSessionHy2Password } from '@/lib/sub-token';

/**
 * POST /api/hysteria/auth
 *
 * Auth callback для Hysteria2 server (`auth.type: http` в /etc/hysteria/config.yaml).
 *
 * Hysteria server вызывает этот endpoint на КАЖДЫЙ новый client connection
 * (не на каждый пакет — connection живёт долго). Мы смотрим, валиден ли
 * sub-token, есть ли активная подписка, и возвращаем 200 OK или 401.
 *
 * Это КЛЮЧЕВОЙ механизм отключения Hy2 при истечении подписки/кике
 * устройства: VLESS отключается через `uuid_pool` purge + xray restart,
 * Hy2 отключается потому что следующий reconnect не пройдёт auth check.
 *
 * **Body** (Hysteria 2 docs https://v2.hysteria.network/docs/advanced/Auth/):
 * ```
 * {
 *   "addr": "1.2.3.4:5678",   // client peer address
 *   "auth": "<sub-token>",    // password user provided in client config
 *   "tx":   0                  // bytes transferred so far (Hy2 internal)
 * }
 * ```
 *
 * **Response 200** (auth OK):
 * ```
 * {
 *   "ok": true,
 *   "id": "tg-1234567"        // optional, Hy2 puts this in trafficLog labels
 * }
 * ```
 *
 * **Response 200 with ok=false** (auth failed):
 * ```
 * {
 *   "ok": false
 * }
 * ```
 *
 * IMPORTANT: Hysteria expects HTTP 200 even on auth failure (с `ok: false`).
 * HTTP 4xx/5xx Hy2 трактует как "backend down, fail closed". Это окей для
 * нас — клиент в обоих случаях получит "auth rejected", но детали логируем.
 *
 * Auth shared secret: optional `X-Hysteria-Secret` header. Если задан
 * `HYSTERIA_AUTH_SECRET` env — проверяем, чтобы только наш Hy2-server мог
 * звать этот endpoint. Без secret — открыт всем (полагаемся на то, что
 * url раздаём только нашим Hy2 instances).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type AuthBody = {
  addr?: string;
  auth?: string;
  tx?: number;
};

type SubRow = {
  user_id: string;
  telegram_id: string | null;
  status: string;
  end_date: string | null;
};

export async function POST(req: Request) {
  // Optional shared secret check (если задан HYSTERIA_AUTH_SECRET)
  const sharedSecret = process.env.HYSTERIA_AUTH_SECRET;
  if (sharedSecret) {
    const provided = req.headers.get('x-hysteria-secret') || '';
    if (provided !== sharedSecret) {
      console.warn('[hysteria/auth] rejected: bad x-hysteria-secret');
      // 401 чтобы Hy2 знал что endpoint не наш — fail closed.
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let body: AuthBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, msg: 'bad json' }, { status: 200 });
  }

  const auth = (body.auth || '').trim();
  const addr = body.addr || '?';

  if (!auth) {
    console.log(`[hysteria/auth] reject addr=${addr} reason=empty-auth`);
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // v48 (2026-05-17): two password formats supported, in this order:
  //
  //   1. Per-session HMAC password `s<sessionId>.<sig12>` — issued by
  //      /api/sub/[token] starting in v48. The session row MUST still exist
  //      (= not kicked) in `device_sessions`, and that session's user MUST
  //      still have an active subscription. This is the path that makes
  //      owner-initiated kicks actually disconnect Hy2 within ~1 minute:
  //      DELETE FROM device_sessions → next reauth misses the session row →
  //      reject. No other path can revoke this device's Hy2 access without
  //      affecting the user's other devices.
  //
  //   2. User-level sub-token `<idPart><sig12>` or `u<idPart><sig12>` —
  //      legacy / fallback path used by:
  //        • clients that imported their config before v48 rolled out (their
  //          cached sing-box config still has `password: <sub-token>`);
  //        • browser admin previews of the subscription endpoint that never
  //          create a device_session row.
  //      No per-device revocation possible here — the password is good for
  //      every device of this user as long as the subscription is active.
  //      Once all clients have re-imported their profile (~ minutes after
  //      the next /api/sub/[token] poll, since `profile-update-interval=1`),
  //      every active password becomes session-scoped automatically.

  // 1a. Try per-session password first.
  const sessionId = parseSessionHy2Password(auth);
  if (sessionId !== null) {
    try {
      const sessRes = await dbQuery<{
        user_id: string;
        telegram_id: string | null;
        status: string;
        end_date: string | null;
        kicked_at: string | null;
      }>(
        `
        SELECT u.id::text AS user_id,
               u.telegram_id::text AS telegram_id,
               COALESCE(s.status, 'none') AS status,
               s.end_date::text,
               ds.kicked_at::text
        FROM device_sessions ds
        JOIN users u ON u.id = ds.user_id
        LEFT JOIN LATERAL (
          SELECT status, end_date
          FROM subscriptions
          WHERE user_id = u.id
            AND status = 'active'
            AND end_date > NOW()
          ORDER BY end_date DESC
          LIMIT 1
        ) s ON TRUE
        WHERE ds.id = $1
        LIMIT 1
        `,
        [sessionId],
      );
      const row = sessRes.rows[0];
      if (!row) {
        // Session was deleted (= owner kicked the device, or admin hard-kicked).
        // This is the v48 mechanism for instant Hy2 revocation.
        console.log(`[hysteria/auth] reject addr=${addr} reason=session-deleted sessionId=${sessionId}`);
        return NextResponse.json({ ok: false }, { status: 200 });
      }
      if (row.kicked_at) {
        // Belt-and-suspenders: if anything ever leaves a soft-kicked row in
        // place (legacy migration / admin tooling), still reject.
        console.log(
          `[hysteria/auth] reject addr=${addr} reason=session-kicked sessionId=${sessionId} `
          + `kicked_at=${row.kicked_at}`,
        );
        return NextResponse.json({ ok: false }, { status: 200 });
      }
      if (row.status !== 'active') {
        console.log(
          `[hysteria/auth] reject addr=${addr} sessionId=${sessionId} `
          + `user=${row.telegram_id ?? row.user_id} reason=expired (status=${row.status})`,
        );
        return NextResponse.json({ ok: false }, { status: 200 });
      }
      // last_seen_at update — keeps the device "alive" in the rank/limit
      // accounting so a Hy2-only client (rare, but possible if VLESS gets
      // blocked while Hy2 stays up) doesn't get pruned by the 30-day idle
      // sweep on the next /api/sub/[token] poll.
      dbQuery(
        `UPDATE device_sessions SET last_seen_at = NOW() WHERE id = $1`,
        [sessionId],
      ).catch((err) => console.warn('[hysteria/auth] last_seen_at update failed:', err));
      const id = row.telegram_id ? `tg-${row.telegram_id}` : `u-${row.user_id}`;
      console.log(
        `[hysteria/auth] accept addr=${addr} user=${id} sessionId=${sessionId} end_date=${row.end_date}`,
      );
      return NextResponse.json({ ok: true, id }, { status: 200 });
    } catch (err) {
      console.error('[hysteria/auth] DB error (per-session path):', err);
      return NextResponse.json({ ok: false }, { status: 200 });
    }
  }

  // 1b. Fall through to user-level sub-token (legacy / cached configs).
  const parsed = parseSubTokenV2(auth);
  if (!parsed) {
    console.log(`[hysteria/auth] reject addr=${addr} reason=bad-token`);
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // 2. Найти юзера и его активную подписку
  const where = parsed.telegramId ? 'u.telegram_id = $1' : 'u.id = $1';
  const param = parsed.telegramId ?? parsed.userId!;

  try {
    const subRes = await dbQuery<SubRow>(
      `
      SELECT u.id::text AS user_id,
             u.telegram_id::text AS telegram_id,
             COALESCE(s.status, 'none') AS status,
             s.end_date::text
      FROM users u
      LEFT JOIN LATERAL (
        SELECT status, end_date
        FROM subscriptions
        WHERE user_id = u.id
          AND status = 'active'
          AND end_date > NOW()
        ORDER BY end_date DESC
        LIMIT 1
      ) s ON TRUE
      WHERE ${where}
      LIMIT 1
      `,
      [param],
    );

    const row = subRes.rows[0];
    if (!row) {
      console.log(`[hysteria/auth] reject addr=${addr} reason=no-user`);
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    if (row.status !== 'active') {
      console.log(
        `[hysteria/auth] reject addr=${addr} `
        + `user=${row.telegram_id ?? row.user_id} reason=expired (status=${row.status})`,
      );
      return NextResponse.json({ ok: false }, { status: 200 });
    }

    // 3. Auth OK (legacy user-level token)
    const id = row.telegram_id
      ? `tg-${row.telegram_id}`
      : `u-${row.user_id}`;
    console.log(`[hysteria/auth] accept addr=${addr} user=${id} legacy=user-token end_date=${row.end_date}`);
    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (err) {
    console.error('[hysteria/auth] DB error:', err);
    // На случай DB-ошибки — fail closed.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

// Hy2 might also send GET for some health checks — handle gracefully.
export async function GET() {
  return NextResponse.json({
    ok: true,
    note: 'Hysteria HTTP auth endpoint. POST with {addr, auth, tx}.',
  });
}
