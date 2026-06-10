// Shared helpers for support-ticket photo attachments.
//
// Storage model: images live as BYTEA rows in `support_ticket_attachments`
// (see db/migrations/2026-06-10-ticket-attachments.sql). The mini-app sends
// them inline as base64 in the JSON request body, we decode + validate here,
// then INSERT the raw bytes. Reads stream the bytes back through the
// attachment GET routes.

import type { PoolClient } from 'pg';

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
// Decoded byte cap per image. 5 MB is plenty for a phone screenshot and keeps
// the DB small for the current low user count.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AttachmentMime = (typeof ALLOWED_ATTACHMENT_MIME)[number];

// Raw shape accepted from the client. `dataBase64` may be a bare base64
// string or a full data URL (data:image/png;base64,....). `mime`/`name`
// are optional when a data URL carries the mime.
export type IncomingAttachment = {
  mime?: string | null;
  name?: string | null;
  dataBase64?: string | null;
};

export type ParsedAttachment = {
  mime: AttachmentMime;
  name: string | null;
  bytes: Buffer;
};

export type ParseResult =
  | { ok: true; attachments: ParsedAttachment[] }
  | { ok: false; error: string };

const DATA_URL_RE = /^data:([^;,]+)(;base64)?,(.*)$/i;

function sanitizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : null;
}

function isAllowedMime(mime: string): mime is AttachmentMime {
  return (ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(mime);
}

/**
 * Validate + decode an array of incoming attachments. Returns typed buffers
 * ready to INSERT, or a human-readable error. An empty/absent list is OK
 * (returns an empty array) — callers decide whether a message needs text or
 * at least one image.
 */
export function parseIncomingAttachments(raw: unknown): ParseResult {
  if (raw === undefined || raw === null) {
    return { ok: true, attachments: [] };
  }

  if (!Array.isArray(raw)) {
    return { ok: false, error: 'attachments must be an array' };
  }

  if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: `Too many attachments (max ${MAX_ATTACHMENTS_PER_MESSAGE})` };
  }

  const parsed: ParsedAttachment[] = [];

  for (const item of raw as IncomingAttachment[]) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Invalid attachment entry' };
    }

    let mime = typeof item.mime === 'string' ? item.mime.trim().toLowerCase() : '';
    let base64 = typeof item.dataBase64 === 'string' ? item.dataBase64.trim() : '';

    if (!base64) {
      return { ok: false, error: 'Attachment has no data' };
    }

    // Support full data URLs — extract mime + payload if present.
    const match = base64.match(DATA_URL_RE);
    if (match) {
      if (!mime && match[1]) mime = match[1].trim().toLowerCase();
      base64 = match[3] ?? '';
    }

    if (!mime) {
      return { ok: false, error: 'Attachment mime type is required' };
    }

    if (!isAllowedMime(mime)) {
      return { ok: false, error: 'Only image attachments are allowed' };
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      return { ok: false, error: 'Invalid attachment encoding' };
    }

    if (bytes.length === 0) {
      return { ok: false, error: 'Attachment is empty' };
    }

    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: 'Image is too large (max 5 MB)' };
    }

    parsed.push({ mime, name: sanitizeName(item.name), bytes });
  }

  return { ok: true, attachments: parsed };
}

/**
 * Insert the parsed attachments for a freshly-created message. Must run on a
 * transaction client (same tx as the message INSERT) so a failure rolls the
 * message back too.
 */
export async function insertAttachments(
  client: PoolClient,
  ticketId: number | string,
  messageId: number | string,
  attachments: ParsedAttachment[],
): Promise<void> {
  for (const att of attachments) {
    await client.query(
      `
      INSERT INTO support_ticket_attachments
        (message_id, ticket_id, mime_type, file_name, byte_size, data)
      VALUES ($1, $2, $3, $4, $5, $6);
      `,
      [messageId, ticketId, att.mime, att.name, att.bytes.length, att.bytes],
    );
  }
}

// Metadata row returned to clients (NO bytes — those stream via the GET route).
export type AttachmentMeta = {
  id: string;
  message_id: string;
  mime_type: string;
  file_name: string | null;
  byte_size: number;
};

/**
 * Fetch attachment metadata for every message in a ticket, grouped by
 * message id. Used by the ticket-detail GET routes to enrich each message
 * with its `attachments[]`.
 */
export async function fetchAttachmentsByMessage(
  query: <T extends Record<string, unknown>>(text: string, params: unknown[]) => Promise<{ rows: T[] }>,
  ticketId: number | string,
): Promise<Map<string, AttachmentMeta[]>> {
  const result = await query<AttachmentMeta>(
    `
    SELECT
      id::text AS id,
      message_id::text AS message_id,
      mime_type,
      file_name,
      byte_size
    FROM support_ticket_attachments
    WHERE ticket_id = $1
    ORDER BY id ASC;
    `,
    [ticketId],
  );

  const map = new Map<string, AttachmentMeta[]>();
  for (const row of result.rows) {
    const list = map.get(row.message_id) ?? [];
    list.push(row);
    map.set(row.message_id, list);
  }
  return map;
}
