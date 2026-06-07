import { NextResponse } from 'next/server';
import { dbQuery } from '@/lib/db';
import { connect } from 'net';

type ServerRow = { id: number; host: string; port: number };

async function tcpPing(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = connect({ host, port, timeout: timeoutMs });
    
    socket.on('connect', () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve(latency);
    });
    
    socket.on('error', () => {
      socket.destroy();
      resolve(null);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

export async function GET() {
  try {
    const result = await dbQuery<ServerRow>(
      `SELECT id, host, port FROM servers WHERE is_active = true`
    );

    const pingResults: Record<number, number | null> = {};

    await Promise.all(
      result.rows.map(async (server) => {
        pingResults[server.id] = await tcpPing(server.host, server.port);
      })
    );

    return NextResponse.json({ ok: true, ping: pingResults });
  } catch (error) {
    console.error('Server ping error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
