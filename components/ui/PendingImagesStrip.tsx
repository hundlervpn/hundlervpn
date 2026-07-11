'use client';

import { X } from 'lucide-react';
import type { PendingTicketImage } from '@/app/_shared/tickets';

function PendingImagesStrip({
  images,
  onRemove,
}: {
  images: PendingTicketImage[];
  onRemove: (key: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pb-2">
      {images.map((img) => (
        <div key={img.key} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.previewUrl}
            alt={img.file.name}
            className="h-16 w-16 rounded-lg object-cover border border-white/15"
          />
          <button
            type="button"
            onClick={() => onRemove(img.key)}
            aria-label="Remove"
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-900 border border-white/20 text-zinc-300 hover:text-white flex items-center justify-center"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default PendingImagesStrip;
