import { NextResponse } from 'next/server';
import { dbQuery, getDbPool } from '@/lib/db';

// API для синхронизации статистики от VPN серверов
// Каждый VPN сервер периодически вызывает этот endpoint
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = authHeader.replace('Bearer ', '');
    
    // Проверяем api_key сервера
    const serverResult = await dbQuery<{ id: number; host: string }>(
      `SELECT id, host FROM servers WHERE api_key = $1 AND is_active = true LIMIT 1`,
      [apiKey]
    );

    if (!serverResult.rows[0]) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    const serverId = serverResult.rows[0].id;
    const body = await req.json();
    const { connections } = body;

    // connections: [{ keyHash, deviceType, connectedAt }]
    if (!Array.isArray(connections)) {
      return NextResponse.json({ error: 'connections array required' }, { status: 400 });
    }

    const pool = getDbPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      let updated = 0;
      for (const conn of connections) {
        if (!conn.keyHash) continue;

        let result;
        
        // Формат tg-TELEGRAM_ID из логов Xray
        if (conn.keyHash.startsWith('tg-')) {
          const telegramId = conn.keyHash.replace('tg-', '');
          result = await client.query(
            `UPDATE vpn_keys 
             SET last_connected_at = COALESCE($2::timestamptz, NOW()),
                 device_type = COALESCE($3, device_type),
                 device_name = COALESCE($3, device_name),
                 server_id = $4
             WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1 LIMIT 1)
               AND is_active = true
             RETURNING id`,
            [telegramId, conn.connectedAt || null, conn.deviceType || null, serverId]
          );
        } else {
          // Формат UUID key_hash
          result = await client.query(
            `UPDATE vpn_keys 
             SET last_connected_at = COALESCE($2::timestamptz, NOW()),
                 device_type = COALESCE($3, device_type),
                 device_name = COALESCE($3, device_name),
                 server_id = $4
             WHERE key_hash = $1
             RETURNING id`,
            [conn.keyHash, conn.connectedAt || null, conn.deviceType || null, serverId]
          );
        }
        
        if (result.rowCount && result.rowCount > 0) updated++;
      }

      // Обновляем last_sync_at сервера
      await client.query(
        `UPDATE servers SET last_sync_at = NOW() WHERE id = $1`,
        [serverId]
      );

      await client.query('COMMIT');

      console.log(`VPN sync: server=${serverId}, connections=${connections.length}, updated=${updated}`);

      return NextResponse.json({ ok: true, updated });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('VPN sync error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET для получения списка ключей которые нужно синхронизировать на сервер
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = authHeader.replace('Bearer ', '');
    
    const serverResult = await dbQuery<{ id: number }>(
      `SELECT id FROM servers WHERE api_key = $1 AND is_active = true LIMIT 1`,
      [apiKey]
    );

    if (!serverResult.rows[0]) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    // Возвращаем все активные ключи в формате tg-TELEGRAM_ID для Xray
    const keysResult = await dbQuery<{ telegram_id: string; expires_at: string | null }>(
      `SELECT u.telegram_id, 
              COALESCE(s.end_date, vk.expires_at) as expires_at
       FROM vpn_keys vk
       JOIN users u ON u.id = vk.user_id
       LEFT JOIN subscriptions s ON s.id = vk.subscription_id
       WHERE vk.is_active = true 
         AND u.is_banned = false
         AND (
           (s.id IS NOT NULL AND s.status = 'active' AND s.end_date > NOW())
           OR (s.id IS NULL AND (vk.expires_at IS NULL OR vk.expires_at > NOW()))
         )`
    );

    return NextResponse.json({ 
      ok: true, 
      keys: keysResult.rows.map(k => ({
        email: `tg-${k.telegram_id}`,
        expiresAt: k.expires_at
      }))
    });
  } catch (error) {
    console.error('VPN sync GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
