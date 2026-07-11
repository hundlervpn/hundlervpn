'use client';

import React, { useRef, useState } from 'react';
import { Reply, MoreHorizontal, Copy, Smile } from 'lucide-react';
import { haptic } from '@/lib/haptic';
import { TICKET_REACTION_EMOJIS, type TicketChatMsg } from '@/app/_shared/tickets';

function TicketMessageRow({
  msg,
  isOwn,
  mySide,
  quotedLabel,
  quotedText,
  bubbleClassName,
  meta,
  attachmentsNode,
  onReply,
  onReact,
  onCopy,
  onJumpToQuoted,
  lang,
}: {
  msg: TicketChatMsg;
  isOwn: boolean;
  mySide: 'user' | 'admin';
  quotedLabel: string | null;
  quotedText: string | null;
  bubbleClassName: string;
  meta: React.ReactNode;
  attachmentsNode?: React.ReactNode;
  onReply: (msg: TicketChatMsg) => void;
  onReact: (messageId: string, emoji: string) => void;
  onCopy: (text: string) => void;
  onJumpToQuoted?: (id: string) => void;
  lang: 'ru' | 'en';
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const swiped = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSystem = msg.sender_type === 'system';
  const actionable = !isSystem;

  const clearLongPress = () => {
    if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; }
  };
  const closeMenu = () => setMenuOpen(false);

  const doReply = () => { haptic('light'); onReply(msg); closeMenu(); };
  const doCopy = () => { onCopy(msg.message); closeMenu(); };
  const doReact = (emoji: string) => { onReact(msg.id, emoji); closeMenu(); };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!actionable) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
    swiped.current = false;
    clearLongPress();
    longPress.current = setTimeout(() => {
      dragging.current = false;
      setDragX(0);
      haptic('medium');
      setMenuOpen(true);
    }, 450);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearLongPress();
    if (Math.abs(dy) > Math.abs(dx)) { dragging.current = false; setDragX(0); return; }
    const clamped = Math.max(-72, Math.min(0, dx));
    setDragX(clamped);
    if (clamped <= -52 && !swiped.current) {
      swiped.current = true;
      dragging.current = false;
      setDragX(0);
      doReply();
    }
  };
  const handleTouchEnd = () => {
    clearLongPress();
    dragging.current = false;
    setDragX(0);
  };

  const myReaction = msg.reactions?.find((r) => r.reactor_type === mySide)?.emoji ?? null;

  return (
    <div id={`tmsg-${msg.id}`} className={`group relative flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      {actionable && dragX < -8 && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400" style={{ opacity: Math.min(1, -dragX / 52) }}>
          <Reply size={16} />
        </div>
      )}

      <div
        className="relative max-w-[85%]"
        style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: dragX ? 'none' : 'transform 0.18s ease' }}
      >
        {actionable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); haptic('light'); setMenuOpen((v) => !v); }}
            aria-label="Actions"
            className={`hidden md:flex absolute -top-2 ${isOwn ? '-left-7' : '-right-7'} w-6 h-6 rounded-full bg-zinc-800/90 border border-white/10 text-zinc-300 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:text-white z-10`}
          >
            <MoreHorizontal size={14} />
          </button>
        )}

        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={bubbleClassName}
        >
          {msg.reply_to_id && (quotedText || quotedLabel) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onJumpToQuoted?.(msg.reply_to_id as string); }}
              className="mb-1.5 w-full text-left rounded-md border-l-2 border-white/40 bg-black/20 px-2 py-1"
            >
              {quotedLabel && <span className="block text-[10px] font-medium text-white/70">{quotedLabel}</span>}
              <span className="block text-[11px] text-white/60 truncate">{quotedText || (lang === 'ru' ? '📷 Фото' : '📷 Photo')}</span>
            </button>
          )}

          {msg.message && (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.message}</p>
          )}
          {attachmentsNode}
          <div className="flex items-center gap-1 mt-1.5">
            <div className="flex-1 min-w-0">{meta}</div>
            {actionable && (
              <div className="flex items-center gap-2 shrink-0">
                {msg.message && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); doCopy(); }} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Copy"><Copy size={13} /></button>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); doReply(); }} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Reply"><Reply size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); haptic('light'); setMenuOpen((v) => !v); }} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="React"><Smile size={13} /></button>
              </div>
            )}
          </div>
        </div>

        {msg.reactions && msg.reactions.length > 0 && (
          <div className={`mt-1 flex gap-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            {msg.reactions.map((r) => (
              <button
                key={r.reactor_type}
                type="button"
                onClick={(e) => { e.stopPropagation(); if (r.reactor_type === mySide) onReact(msg.id, r.emoji); }}
                className={`px-1.5 py-0.5 rounded-full text-xs border ${r.reactor_type === mySide ? 'bg-white/15 border-white/30' : 'bg-black/30 border-white/10'}`}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={closeMenu} onTouchStart={closeMenu} />
            <div className={`absolute z-30 top-full mt-1 ${isOwn ? 'right-0' : 'left-0'} rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-md shadow-xl p-2 w-max`}>
              <div className="flex gap-1 mb-1">
                {TICKET_REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); doReact(emoji); }}
                    className={`w-8 h-8 rounded-full text-lg flex items-center justify-center hover:bg-white/10 ${myReaction === emoji ? 'bg-white/15' : ''}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="flex flex-col">
                <button type="button" onClick={(e) => { e.stopPropagation(); doReply(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-200 hover:bg-white/10">
                  <Reply size={15} /> {lang === 'ru' ? '\u041e\u0442\u0432\u0435\u0442\u0438\u0442\u044c' : 'Reply'}
                </button>
                {msg.message && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); doCopy(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-200 hover:bg-white/10">
                    <Copy size={15} /> {lang === 'ru' ? '\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c' : 'Copy'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TicketMessageRow;
