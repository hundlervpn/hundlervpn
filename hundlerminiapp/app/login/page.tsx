'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, ArrowRight, ChevronLeft, Loader2, AlertTriangle } from 'lucide-react';
import ParticlesBackground from '@/components/ParticlesBackground';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const TELEGRAM_CLIENT_ID = '8649972278';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<'main' | 'email' | 'code'>('main');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [checkingSession, setCheckingSession] = useState(true);
  // Handle Telegram callback token or existing session
  useEffect(() => {
    const tgSession = searchParams.get('tg_session');
    const tgError = searchParams.get('tg_error');

    if (tgError) {
      setError(tgError);
      setCheckingSession(false);
      window.history.replaceState({}, '', '/login');
      return;
    }

    if (tgSession) {
      localStorage.setItem('hvpn_session', tgSession);
      window.history.replaceState({}, '', '/login');
      router.replace('/');
      return;
    }

    const token = localStorage.getItem('hvpn_session');
    if (token) {
      fetch(`/api/auth/session?token=${token}`)
        .then(r => r.json())
        .then(data => {
          if (data.ok) {
            router.replace('/');
          } else {
            localStorage.removeItem('hvpn_session');
            setCheckingSession(false);
          }
        })
        .catch(() => { setCheckingSession(false); });
    } else {
      setCheckingSession(false);
    }
  }, [router, searchParams]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Telegram OIDC redirect (full page, not popup)
  const openTelegramLogin = useCallback(() => {
    const origin = window.location.origin;
    const redirectUri = `${origin}/api/auth/telegram/callback`;
    const state = Math.random().toString(36).slice(2);
    const url = `https://oauth.telegram.org/auth?client_id=${TELEGRAM_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid profile telegram:bot_access')}&state=${state}`;
    window.location.href = url;
  }, []);

  // Google OAuth 2.0 — server initiates the flow (state kept in httpOnly cookie)
  const openGoogleLogin = useCallback(() => {
    window.location.href = '/api/auth/google/start';
  }, []);

  const handleSendCode = async () => {
    if (!email || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.ok) {
        setStep('code');
        setCooldown(60);
      } else {
        setError(data.error || 'Ошибка отправки кода');
      }
    } catch {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (data.ok && data.sessionToken) {
        localStorage.setItem('hvpn_session', data.sessionToken);
        router.replace('/');
      } else {
        setError(data.error || 'Неверный код');
      }
    } catch {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen w-full bg-[#020202] flex items-center justify-center">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <ParticlesBackground />
        </div>
        <div className="relative z-10 text-zinc-500 text-sm">...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#020202] flex flex-col items-center justify-center overflow-hidden relative px-4">
      {/* Background — same as main app */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <ParticlesBackground />
        <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-red-500/8 blur-[80px]" />
        <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-red-500/5 blur-[100px]" />
        <div className="absolute bottom-[10%] left-[20%] w-[30vw] h-[30vw] max-w-[250px] max-h-[250px] rounded-full bg-orange-500/5 blur-[70px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm lg:max-w-xl flex flex-col items-center">
        {/* Logo — same style as main app */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="mb-10 lg:mb-14 text-center"
        >
          <h1 className="font-syncopate font-bold text-xl lg:text-3xl tracking-[0.12em] text-white">
            HUNDLER
            <span className="relative inline-block ml-1.5">
              <span className="absolute inset-0 bg-gradient-to-r from-white to-zinc-300 blur-sm opacity-35"></span>
              <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">VPN</span>
            </span>
          </h1>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          className="w-full backdrop-blur-xl bg-zinc-900/60 border border-white/10 rounded-2xl p-6 lg:p-10 shadow-2xl"
        >
          <AnimatePresence mode="wait">
            {step === 'main' && (
              <motion.div
                key="main"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-4"
              >
                {/* Telegram Login Button */}
                <button
                  onClick={openTelegramLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2.5 bg-[#2AABEE] hover:bg-[#229ED9] text-white py-3 lg:py-4 px-4 rounded-xl transition-all active:scale-[0.98] font-medium text-sm lg:text-base shadow-lg shadow-[#2AABEE]/20 disabled:opacity-60"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                  )}
                  Telegram
                </button>

                {/* VPN warning for Telegram login */}
                <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2.5">
                  <AlertTriangle size={14} className="text-amber-400/90 shrink-0 mt-0.5" />
                  <p className="text-amber-200/80 text-[11px] lg:text-xs leading-relaxed">
                    В России для входа через Telegram может потребоваться включённый VPN — домен <span className="font-mono text-amber-100/90">oauth.telegram.org</span> периодически блокируется. Если вы ещё не наш клиент, используйте вход по Email.
                  </p>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-zinc-500 text-xs lg:text-sm">или с помощью</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                {/* Google button */}
                <button
                  onClick={openGoogleLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2.5 bg-white hover:bg-zinc-100 text-zinc-900 py-3 lg:py-4 px-4 rounded-xl transition-all active:scale-[0.98] font-medium text-sm lg:text-base shadow-lg disabled:opacity-60"
                >
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  <span>Google</span>
                </button>

                {/* Email button */}
                <button
                  onClick={() => { setStep('email'); setError(''); }}
                  className="w-full flex items-center justify-center gap-2.5 bg-zinc-800/80 hover:bg-zinc-700/80 border border-white/10 hover:border-white/20 text-white py-3 lg:py-4 px-4 rounded-xl transition-all active:scale-[0.98]"
                >
                  <Mail size={18} className="text-red-400" />
                  <span className="text-sm lg:text-base font-medium">Email</span>
                </button>
              </motion.div>
            )}

            {step === 'email' && (
              <motion.div
                key="email"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-4"
              >
                <button onClick={() => { setStep('main'); setError(''); }} className="flex items-center gap-1 text-zinc-400 hover:text-white text-xs w-fit -mt-1 -mb-1">
                  <ChevronLeft size={14} /> Назад
                </button>

                <div>
                  <label className="text-zinc-400 text-xs lg:text-sm mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                    placeholder="name@example.com"
                    autoFocus
                    className="w-full bg-zinc-800/60 border border-white/10 focus:border-red-500/50 rounded-xl px-4 py-3 lg:py-4 text-sm lg:text-base text-white placeholder:text-zinc-500 outline-none transition-colors"
                  />
                </div>

                <button
                  onClick={handleSendCode}
                  disabled={loading || !email}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-white/20 to-white/10 border border-white/25 disabled:opacity-40 text-white py-3 lg:py-4 px-4 rounded-xl font-medium text-sm lg:text-base transition-all active:scale-[0.98]"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  Получить код
                </button>
              </motion.div>
            )}

            {step === 'code' && (
              <motion.div
                key="code"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-4"
              >
                <button onClick={() => { setStep('email'); setError(''); setCode(''); }} className="flex items-center gap-1 text-zinc-400 hover:text-white text-xs lg:text-sm w-fit -mt-1 -mb-1">
                  <ChevronLeft size={14} /> Назад
                </button>

                <p className="text-zinc-400 text-xs lg:text-sm">
                  Код отправлен на <span className="text-white font-medium">{email}</span>
                </p>

                <div>
                  <label className="text-zinc-400 text-xs lg:text-sm mb-1.5 block">Код подтверждения</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                    placeholder="000000"
                    autoFocus
                    className="w-full bg-zinc-800/60 border border-white/10 focus:border-red-500/50 rounded-xl px-4 py-3 lg:py-4 text-sm text-white text-center tracking-[0.3em] font-mono text-lg lg:text-xl placeholder:text-zinc-500 outline-none transition-colors"
                  />
                </div>

                <button
                  onClick={handleVerifyCode}
                  disabled={loading || code.length < 6}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-white/20 to-white/10 border border-white/25 disabled:opacity-40 text-white py-3 lg:py-4 px-4 rounded-xl font-medium text-sm lg:text-base transition-all active:scale-[0.98]"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  Подтвердить
                </button>

                {cooldown > 0 ? (
                  <p className="text-zinc-500 text-xs text-center">Отправить повторно через {cooldown}с</p>
                ) : (
                  <button onClick={handleSendCode} disabled={loading} className="text-red-400 text-xs text-center hover:underline disabled:opacity-40">
                    Отправить код повторно
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-red-400 text-xs text-center mt-3"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-zinc-600 text-[10px] lg:text-xs text-center mt-6 lg:mt-8 leading-relaxed"
        >
          Создавая аккаунт, вы соглашаетесь с{' '}
          <a href="/terms" className="text-zinc-400 hover:text-white underline">пользовательским соглашением</a> и{' '}
          <a href="/privacy" className="text-zinc-400 hover:text-white underline">политикой конфиденциальности</a>
        </motion.p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen w-full bg-[#020202] flex items-center justify-center">
        <div className="text-zinc-500 text-sm">...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
