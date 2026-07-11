'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronLeft, X, ArrowUp, Plus, Mail, Pencil, Paperclip, Image as ImageIcon, Reply } from 'lucide-react';
import { motion } from 'motion/react';
import { haptic } from '@/lib/haptic';
import TicketAttachmentGrid from '@/components/ui/TicketAttachmentGrid';
import TicketMessageRow from '@/components/ui/TicketMessageRow';
import PendingImagesStrip from '@/components/ui/PendingImagesStrip';
import { type SupportTicket, type TicketAttachmentMeta, type PendingTicketImage, type TicketReaction, fileToTicketAttachment, acceptTicketImages } from '@/app/_shared/tickets';
import TicketImageLightbox from '@/components/ui/TicketImageLightbox';
import { pageVariants } from '@/app/_shared/constants';
import type { UserIdentifier } from '@/app/_shared/types';

type SupportTicketDetails = {
  id: string;
  subject: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type SupportTicketMessage = {
  id: string;
  sender_type: 'user' | 'admin' | 'system';
  message: string;
  created_at: string;
  attachments?: TicketAttachmentMeta[];
  reply_to_id?: string | null;
  reactions?: TicketReaction[];
};

export default function SupportView({ t, direction, userIdentifier, lang, onHideNav, onMarkRead }: { t: any; direction: number; userIdentifier: UserIdentifier | null; lang: 'ru' | 'en'; onHideNav?: (hide: boolean) => void; onMarkRead?: () => void }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketDetails | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportTicketMessage[]>([]);
  const [ticketDetailsLoading, setTicketDetailsLoading] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyTo, setReplyTo] = useState<SupportTicketMessage | null>(null);
  const [replySending, setReplySending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Photo attachments: picked-but-unsent images for the create form + reply box,
  // plus the fullscreen viewer URL.
  const [createImages, setCreateImages] = useState<PendingTicketImage[]>([]);
  const [replyImages, setReplyImages] = useState<PendingTicketImage[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const createFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);

  const userQuery = userIdentifier
    ? (userIdentifier.type === 'telegram'
      ? `telegramId=${encodeURIComponent(String(userIdentifier.telegramId))}`
      : `userId=${encodeURIComponent(String(userIdentifier.userId))}`)
    : '';

  const buildAttachmentUrl = useCallback(
    (ticketId: string, att: TicketAttachmentMeta) =>
      `/api/tickets/${ticketId}/attachments/${att.id}?${userQuery}`,
    [userQuery],
  );

  const handlePickImages = (
    files: FileList | null,
    target: 'create' | 'reply',
  ) => {
    if (!files || files.length === 0) return;
    const setter = target === 'create' ? setCreateImages : setReplyImages;
    setter((prev) => {
      const { accepted, error } = acceptTicketImages(files, prev.length);
      if (error) {
        if (target === 'create') setSubmitError(error);
        else setTicketsError(error);
      }
      return [...prev, ...accepted];
    });
  };

  const removePendingImage = (key: string, target: 'create' | 'reply') => {
    const setter = target === 'create' ? setCreateImages : setReplyImages;
    setter((prev) => {
      const found = prev.find((p) => p.key === key);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  };

  const requestBody = userIdentifier
    ? (userIdentifier.type === 'telegram'
      ? { telegramId: userIdentifier.telegramId }
      : { userId: userIdentifier.userId })
    : null;

  const loadTickets = useCallback(async () => {
    if (!userQuery) {
      setTickets([]);
      setTicketsError(null);
      setSelectedTicketId(null);
      setSelectedTicket(null);
      setTicketMessages([]);
      return;
    }

    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/tickets?${userQuery}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || t.supportLoadError);
      }

      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch (error) {
      setTickets([]);
      setTicketsError(error instanceof Error ? error.message : t.supportLoadError);
    } finally {
      setTicketsLoading(false);
    }
  }, [userQuery, t.supportLoadError]);

  const loadTicketDetails = useCallback(async (ticketId: string) => {
    if (!userQuery) return;

    setTicketDetailsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}?${userQuery}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || t.supportLoadError);
      }

      setSelectedTicket(data.ticket ?? null);
      setTicketMessages(Array.isArray(data.messages) ? data.messages : []);
      // GET /api/tickets/[id] auto-marks the ticket as read on the server,
      // so refresh the global unread badge to clear it.
      onMarkRead?.();
    } catch (error) {
      setSelectedTicket(null);
      setTicketMessages([]);
      setTicketsError(error instanceof Error ? error.message : t.supportLoadError);
    } finally {
      setTicketDetailsLoading(false);
    }
  }, [userQuery, t.supportLoadError, onMarkRead]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  // Hide navigation when in chat
  useEffect(() => {
    onHideNav?.(!!selectedTicketId);
    return () => onHideNav?.(false);
  }, [selectedTicketId, onHideNav]);

  const handleCreateTicket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    haptic('medium');

    if (!requestBody) {
      setSubmitError(t.supportCreateError);
      return;
    }

    const messageValue = message.trim();
    if (!messageValue && createImages.length === 0) {
      setSubmitError(t.supportMessageRequired);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const attachments = await Promise.all(createImages.map((img) => fileToTicketAttachment(img.file)));
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          subject: subject.trim() || undefined,
          message: messageValue,
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.supportCreateError);
      }

      setSubject('');
      setMessage('');
      createImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setCreateImages([]);
      setShowCreateForm(false);

      const newTicketId = typeof data.ticket?.id === 'string' ? data.ticket.id : null;
      if (newTicketId) {
        setSelectedTicketId(newTicketId);
        await Promise.all([loadTickets(), loadTicketDetails(newTicketId)]);
      } else {
        await loadTickets();
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t.supportCreateError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenTicket = (ticketId: string) => {
    haptic('light');
    setSelectedTicketId(ticketId);
    setReplyMessage('');
    void loadTicketDetails(ticketId);
  };

  const handleSendMessage = async () => {
    haptic('medium');
    if (!requestBody || !selectedTicketId) return;

    const messageValue = replyMessage.trim();
    if (!messageValue && replyImages.length === 0) {
      setTicketsError(t.supportMessageRequired);
      return;
    }

    setReplySending(true);
    setTicketsError(null);

    try {
      const attachments = await Promise.all(replyImages.map((img) => fileToTicketAttachment(img.file)));
      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          message: messageValue,
          attachments: attachments.length > 0 ? attachments : undefined,
          replyToId: replyTo?.id ?? null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.supportTicketActionError);
      }

      setReplyMessage('');
      setReplyTo(null);
      replyImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setReplyImages([]);
      await Promise.all([loadTicketDetails(selectedTicketId), loadTickets()]);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.supportTicketActionError);
    } finally {
      setReplySending(false);
    }
  };

  const handleReactMessage = async (messageId: string, emoji: string) => {
    if (!requestBody || !selectedTicketId) return;
    haptic('light');
    try {
      const res = await fetch(`/api/tickets/${selectedTicketId}/messages/${messageId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, emoji }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.supportTicketActionError);
      setTicketMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions ?? [] } : m)));
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.supportTicketActionError);
    }
  };

  const handleCopyMessage = async (text: string) => {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      haptic('light');
    } catch { /* ignore */ }
  };

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`tmsg-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleTicketStatus = async (status: 'open' | 'closed') => {
    haptic('medium');
    if (!requestBody || !selectedTicketId) return;

    setStatusUpdating(true);
    setTicketsError(null);

    try {
      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          status,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || t.supportTicketActionError);
      }

      await Promise.all([loadTicketDetails(selectedTicketId), loadTickets()]);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : t.supportTicketActionError);
    } finally {
      setStatusUpdating(false);
    }
  };

  const senderLabel = (senderType: 'user' | 'admin' | 'system') => {
    if (senderType === 'admin') return t.supportSenderAdmin;
    if (senderType === 'system') return t.supportSenderSystem;
    return t.supportSenderUser;
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB');
  };

  return (
    <motion.div custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="flex flex-col flex-1 items-center w-full">
      <div className="w-full max-w-xs lg:max-w-[560px] space-y-3">
        {!showCreateForm && !selectedTicketId && (
          <button
            onClick={() => {
              setShowCreateForm(true);
              setSubmitError(null);
            }}
            className="w-full rounded-full border border-white/20 bg-zinc-900/40 px-5 py-3 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <Plus size={18} strokeWidth={2} />
            <span>{t.supportNewTicket}</span>
          </button>
        )}

        {showCreateForm ? (
          <>
            <button onClick={() => setShowCreateForm(false)} className="text-zinc-400 hover:text-white text-sm inline-flex items-center gap-2 mb-2 transition-colors">
              <ChevronRight size={14} className="rotate-180" /> {t.supportBackToList}
            </button>

            {/* 2026-05-06 premium redesign: glass-on-dark with crisp white outline,
                  no red glow blobs, no airplane icon, uppercase micro-labels.
                  Header uses a Pencil compose chip on a neutral white/10 surface. */}
            <form onSubmit={handleCreateTicket} className="relative rounded-2xl border border-white/15 bg-zinc-900/60 backdrop-blur-sm p-5 lg:p-6 overflow-hidden">
              {/* Subtle red halo (one, top-right) — premium accent without dominating */}
              <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-red-500/[0.06] blur-3xl pointer-events-none" />

              <div className="relative">
                {/* Header */}
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
                  <div className="w-11 h-11 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0">
                    <Pencil size={17} strokeWidth={1.75} className="text-zinc-200" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-white font-semibold text-base lg:text-lg leading-tight">{t.supportCreateTitle}</h3>
                    <p className="text-zinc-500 text-xs mt-0.5">{t.supportSubjectHint}</p>
                  </div>
                </div>

                {/* Subject */}
                <div className="mb-4">
                  <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">{t.supportSubject}</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t.supportSubjectPlaceholder}
                    maxLength={120}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors"
                  />
                </div>

                {/* Message */}
                <div className="mb-5">
                  <label className="block text-zinc-400 text-[10px] font-semibold uppercase tracking-[0.12em] mb-2">
                    {t.supportMessage} <span className="text-red-400 normal-case">*</span>
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t.supportMessagePlaceholder}
                    rows={5}
                    maxLength={4000}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white placeholder:text-zinc-600 outline-none focus:border-white/30 transition-colors resize-none min-h-[160px]"
                  />
                </div>

                {/* Photo attachments */}
                <div className="mb-5">
                  <input
                    ref={createFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handlePickImages(e.target.files, 'create');
                      e.target.value = '';
                    }}
                  />
                  <PendingImagesStrip images={createImages} onRemove={(k) => removePendingImage(k, 'create')} />
                  <button
                    type="button"
                    onClick={() => createFileRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <ImageIcon size={16} /> {t.supportAttachPhoto}
                  </button>
                </div>

                {submitError && (
                  <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                    <X size={16} />
                    {submitError}
                  </div>
                )}

                {/* Submit button — solid red, no gradient, no airplane */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold py-3.5 active:scale-[0.99] transition-all disabled:opacity-50 disabled:hover:bg-red-500"
                >
                  {submitting ? t.supportSending : t.supportSend}
                </button>
              </div>
            </form>
          </>
        ) : selectedTicketId ? (
          <div className="fixed inset-0 z-30 bg-black flex flex-col">
            {/* Header — premium glass card with white outline, no red glow blob, no chat-icon clutter */}
            <div className="shrink-0 px-4 pb-3 border-b border-white/10 bg-zinc-950/95 backdrop-blur-md" style={{ paddingTop: 'calc(var(--sat) + 3.5rem)' }}>
              {selectedTicket && (
                <div className="rounded-2xl border border-white/15 bg-zinc-900/60 backdrop-blur-sm p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => {
                          setSelectedTicketId(null);
                          setSelectedTicket(null);
                          setTicketMessages([]);
                          setReplyMessage('');
                          setTicketsError(null);
                        }}
                        className="w-9 h-9 shrink-0 rounded-lg border border-white/15 bg-white/[0.04] flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <ChevronLeft size={18} className="text-white" />
                      </button>
                      <div className="min-w-0">
                        <h3 className="text-white font-semibold text-sm truncate">{selectedTicket.subject || t.supportNoSubject}</h3>
                        <span className={`mt-0.5 inline-flex items-center gap-1.5 text-[11px] ${selectedTicket.status === 'closed' ? 'text-zinc-500' : 'text-emerald-300'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${selectedTicket.status === 'closed' ? 'bg-zinc-500' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'}`} />
                          {selectedTicket.status === 'closed' ? t.supportClosedStatus : t.supportOpenStatus}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleTicketStatus(selectedTicket.status === 'open' ? 'closed' : 'open')}
                      disabled={statusUpdating}
                      className={`shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all active:scale-95 ${selectedTicket.status === 'open' ? 'border-white/15 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]' : 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15'} disabled:opacity-40`}
                    >
                      {selectedTicket.status === 'open' ? t.supportCloseTicket : t.supportReopenTicket}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {ticketsError && (
              <div className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                <X size={16} />
                {ticketsError}
              </div>
            )}

            {ticketDetailsLoading || !selectedTicket ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white/70 animate-spin" />
              </div>
            ) : (
              <>
                {/* Messages — refined bubbles with asymmetric corner for chat-y feel */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {ticketMessages.length === 0 ? (
                    <div className="text-zinc-600 text-sm py-8 text-center">{t.supportTicketNoMessages}</div>
                  ) : (
                    <div className="space-y-2.5">
                      {ticketMessages.map((msg) => {
                        const quoted = msg.reply_to_id ? ticketMessages.find((m) => m.id === msg.reply_to_id) : null;
                        const isOwn = msg.sender_type === 'user';
                        return (
                          <TicketMessageRow
                            key={msg.id}
                            msg={msg}
                            isOwn={isOwn}
                            mySide="user"
                            quotedLabel={quoted ? senderLabel(quoted.sender_type) : null}
                            quotedText={quoted ? quoted.message : null}
                            bubbleClassName={`px-4 py-2.5 ${isOwn ? 'rounded-2xl rounded-br-md bg-red-500/15 border border-red-500/30 text-white' : 'rounded-2xl rounded-bl-md bg-white/[0.04] border border-white/10 text-zinc-100'}`}
                            attachmentsNode={
                              <TicketAttachmentGrid
                                attachments={msg.attachments}
                                buildUrl={(att) => buildAttachmentUrl(selectedTicket.id, att)}
                                onOpen={setLightboxUrl}
                              />
                            }
                            meta={
                              <p className={`text-[10px] mt-1.5 ${isOwn ? 'text-red-200/60' : 'text-zinc-500'}`}>
                                {senderLabel(msg.sender_type)} · {formatDate(msg.created_at)}
                              </p>
                            }
                            onReply={(m) => { setReplyTo(m as SupportTicketMessage); }}
                            onReact={handleReactMessage}
                            onCopy={handleCopyMessage}
                            onJumpToQuoted={jumpToMessage}
                            lang={lang}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Fixed input at bottom — premium pill textarea + circular ArrowUp send (no airplane) */}
                <div className="shrink-0 px-4 pt-3 border-t border-white/10 bg-zinc-950/95 backdrop-blur-md" style={{ paddingBottom: 'calc(var(--sab) + 0.75rem)' }}>
                  {replyTo && (
                    <div className="flex items-center gap-2 mb-2 rounded-xl border-l-2 border-red-400/70 bg-white/[0.04] px-3 py-2">
                      <Reply size={14} className="text-red-300 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium text-red-300">{lang === 'ru' ? 'Ответ' : 'Reply'} · {senderLabel(replyTo.sender_type)}</p>
                        <p className="text-[11px] text-zinc-400 truncate">{replyTo.message || (lang === 'ru' ? '📷 Фото' : '📷 Photo')}</p>
                      </div>
                      <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="shrink-0 text-zinc-400 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <PendingImagesStrip images={replyImages} onRemove={(k) => removePendingImage(k, 'reply')} />
                  <div className="flex items-end gap-2">
                    <input
                      ref={replyFileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handlePickImages(e.target.files, 'reply');
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => replyFileRef.current?.click()}
                      aria-label={t.supportAttachPhoto}
                      title={t.supportAttachPhoto}
                      className="shrink-0 w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.08] flex items-center justify-center active:scale-90 transition-all"
                    >
                      <Paperclip size={19} strokeWidth={2} />
                    </button>
                    <textarea
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      placeholder={t.supportReplyPlaceholder}
                      rows={1}
                      maxLength={4000}
                      className="flex-1 rounded-2xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30 focus:bg-white/[0.05] transition-colors resize-none"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={replySending || (!replyMessage.trim() && replyImages.length === 0)}
                      aria-label={t.supportSend}
                      className="shrink-0 w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center active:scale-90 transition-all disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
                    >
                      <ArrowUp size={20} strokeWidth={2.25} />
                    </button>
                  </div>
                </div>
                <TicketImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {ticketsError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {ticketsError}
              </div>
            )}

            {ticketsLoading ? (
              <div className="rounded-[28px] border border-white/10 bg-zinc-900/40 px-5 py-10 text-center text-zinc-400 text-sm">
                {t.supportLoading}
              </div>
            ) : tickets.length === 0 ? (
              <div className="rounded-[28px] border border-white/10 bg-zinc-900/35 px-6 py-14 text-center min-h-[260px] flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl border border-white/15 bg-white/[0.03] flex items-center justify-center mb-5">
                  <Mail size={30} strokeWidth={1.8} className="text-zinc-300" />
                </div>
                <p className="text-zinc-300 text-lg leading-snug mb-2">{t.supportNoTicketsTitle}</p>
                <p className="text-zinc-500 text-sm leading-snug max-w-[280px]">{t.supportNoTicketsHint}</p>
              </div>
            ) : (
              tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => handleOpenTicket(ticket.id)}
                  className={`w-full text-left rounded-2xl border p-4 transition-colors ${ticket.unread_count > 0 ? 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10' : 'border-white/10 bg-zinc-900/45 hover:bg-zinc-900/70'}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                      {ticket.subject || t.supportNoSubject}
                      {ticket.unread_count > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                          {ticket.unread_count > 99 ? '99+' : ticket.unread_count}
                        </span>
                      )}
                    </h3>
                    <span className={`px-2 py-1 rounded-full text-[10px] uppercase tracking-wider ${ticket.status === 'closed' ? 'bg-zinc-700/60 text-zinc-300' : 'bg-white/10 text-zinc-200'}`}>
                      {ticket.status === 'closed' ? t.supportClosedStatus : t.supportOpenStatus}
                    </span>
                  </div>

                  {ticket.last_message ? (
                    <p className="text-zinc-300 text-sm leading-relaxed mb-3">{ticket.last_message}</p>
                  ) : null}

                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span>{t.supportLastUpdate}: {formatDate(ticket.last_message_at)}</span>
                    <span>{ticket.messages_count} {t.supportMessagesCount}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
