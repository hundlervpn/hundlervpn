import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';

// API для регистрации подключения устройства от VPN сервера
// Вызывается скриптом на VPN сервере при подключении клиента
export async function POST(req: Request) {
  try {
    // Проверка секретного ключа (accepts both SYNC_TOKEN and VPN_WEBHOOK_SECRET)
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') || '';
    const validTokens = [process.env.VPN_WEBHOOK_SECRET, process.env.XRAY_SYNC_TOKEN].filter(Boolean);
    
    if (!validTokens.includes(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { keyHash, email, deviceType, userAgent } = body;

    if (!keyHash && !email) {
      return NextResponse.json({ error: 'keyHash or email is required' }, { status: 400 });
    }

    // Определяем тип устройства из User-Agent если не передан явно
    let detectedDeviceType = deviceType;
    if (!detectedDeviceType && userAgent) {
      const ua = userAgent.toLowerCase();
      if (ua.includes('iphone')) {
        detectedDeviceType = 'iPhone';
      } else if (ua.includes('ipad')) {
        detectedDeviceType = 'iPad';
      } else if (ua.includes('android')) {
        detectedDeviceType = 'Android';
      } else if (ua.includes('mac')) {
        detectedDeviceType = 'Mac';
      } else if (ua.includes('windows')) {
        detectedDeviceType = 'Windows';
      } else if (ua.includes('linux')) {
        detectedDeviceType = 'Linux';
      }
    }

    // Обновляем vpn_key по key_hash или по email (tg-XXXXX format)
    let result;
    if (keyHash) {
      result = await dbQuery(
        `UPDATE vpn_keys 
         SET last_connected_at = NOW(),
             device_type = COALESCE($2, device_type),
             device_name = COALESCE($2, device_name)
         WHERE key_hash = $1
         RETURNING id, user_id`,
        [keyHash, detectedDeviceType]
      );
    } else if (email) {
      // Email format from Xray: tg-TELEGRAM_ID
      const match = email.match(/^tg-(\d+)$/);
      if (match) {
        const telegramId = match[1];
        result = await dbQuery(
          `UPDATE vpn_keys vk
           SET last_connected_at = NOW(),
               device_type = COALESCE($2, device_type),
               device_name = COALESCE($2, device_name)
           FROM users u
           WHERE u.id = vk.user_id
             AND u.telegram_id = $1
             AND vk.is_active = TRUE
           RETURNING vk.id, vk.user_id`,
          [telegramId, detectedDeviceType]
        );
      }
    }

    if (!result || result.rowCount === 0) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }

    console.log(`VPN connect: ${keyHash ? 'key=' + keyHash.substring(0, 8) + '...' : 'email=' + email}, device=${detectedDeviceType || 'unknown'}`);

    return NextResponse.json({ ok: true, updated: result.rows[0] });
  } catch (error) {
    console.error('VPN connect error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
