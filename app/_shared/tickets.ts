// Support-ticket shared types, constants, and helpers.
// Extracted from app/page.tsx (used by SupportView, AdminTicketsView,
// and the ticket leaf components in components/ui/).

export type SupportTicket = {
  id: string;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string;
  messages_count: number;
  unread_count: number;
};

// ---------------------------------------------------------------------------
// Support-ticket photo attachments (shared by user + admin ticket views).
// Images are uploaded inline as base64 in the JSON request body and stored as
// BYTEA in Postgres; they stream back through the attachment GET routes.
// ---------------------------------------------------------------------------

export const TICKET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const TICKET_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const TICKET_IMAGE_MAX_COUNT = 5;

// Metadata for a stored attachment (no bytes — URL points at the GET route).
export type TicketAttachmentMeta = {
  id: string;
  message_id?: string;
  mime_type: string;
  file_name: string | null;
  byte_size: number;
};

// A picked-but-not-yet-sent image (local preview before upload).
export type PendingTicketImage = {
  key: string;
  file: File;
  previewUrl: string;
};

// Encode a File as { name, mime, dataBase64 } for the request body.
export async function fileToTicketAttachment(file: File): Promise<{ name: string; mime: string; dataBase64: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { name: file.name, mime: file.type, dataBase64: btoa(binary) };
}

// Validate + dedupe newly picked files against the current pending list.
// Returns the accepted PendingTicketImage[] and an optional error string.
export function acceptTicketImages(
  files: FileList | File[],
  existingCount: number,
): { accepted: PendingTicketImage[]; error: string | null } {
  const accepted: PendingTicketImage[] = [];
  let error: string | null = null;
  let count = existingCount;
  for (const file of Array.from(files)) {
    if (count >= TICKET_IMAGE_MAX_COUNT) {
      error = `Можно прикрепить не более ${TICKET_IMAGE_MAX_COUNT} фото`;
      break;
    }
    if (!TICKET_IMAGE_TYPES.includes(file.type)) {
      error = 'Можно прикреплять только изображения';
      continue;
    }
    if (file.size > TICKET_IMAGE_MAX_BYTES) {
      error = 'Изображение слишком большое (макс. 5 МБ)';
      continue;
    }
    accepted.push({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    });
    count += 1;
  }
  return { accepted, error };
}

export const TICKET_REACTION_EMOJIS = ['👍', '👎', '❤️', '😊', '😮', '🎉'] as const;

export type TicketReaction = { reactor_type: 'user' | 'admin'; emoji: string };

export type TicketChatMsg = {
  id: string;
  sender_type: 'user' | 'admin' | 'system';
  message: string;
  created_at: string;
  attachments?: TicketAttachmentMeta[];
  reply_to_id?: string | null;
  reactions?: TicketReaction[];
};
