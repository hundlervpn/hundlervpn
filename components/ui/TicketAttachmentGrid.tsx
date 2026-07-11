'use client';

import type { TicketAttachmentMeta } from '@/app/_shared/tickets';

function TicketAttachmentGrid({
  attachments,
  buildUrl,
  onOpen,
}: {
  attachments?: TicketAttachmentMeta[];
  buildUrl: (att: TicketAttachmentMeta) => string;
  onOpen: (url: string) => void;
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att) => {
        const url = buildUrl(att);
        return (
          <button
            key={att.id}
            type="button"
            onClick={() => onOpen(url)}
            className="block overflow-hidden rounded-lg border border-white/10 active:scale-95 transition-transform"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={att.file_name ?? 'image'}
              loading="lazy"
              className="h-36 w-36 object-cover bg-black/20"
            />
          </button>
        );
      })}
    </div>
  );
}

export default TicketAttachmentGrid;
