'use client';

import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

export default function TicketImageLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
      >
        <X size={22} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="attachment" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>,
    document.body,
  );
}
