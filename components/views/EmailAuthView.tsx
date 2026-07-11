'use client';

import { haptic } from '@/lib/haptic';
import { Mail } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

export default function EmailAuthView({ lang, setLang, onLogin }: { lang: 'ru' | 'en'; setLang: (l: 'ru' | 'en') => void; onLogin: (user: { id: number; email: string; name: string }, sessionToken: string) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSendCode = async () => {
    haptic('medium');
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Ошибка' : 'Error'));
        return;
      }
      setStep('code');
      setCooldown(60);
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    haptic('medium');
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Неверный код' : 'Invalid code'));
        return;
      }
      onLogin(data.user, data.sessionToken);
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    haptic('light');
    if (cooldown > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'ru' ? 'Ошибка' : 'Error'));
        return;
      }
      setCooldown(60);
      setCode('');
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#020202] flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[40vw] h-[40vw] max-w-[300px] max-h-[300px] rounded-full bg-white/10 blur-[55px]" />
        <div className="absolute top-[40%] -right-[10%] w-[50vw] h-[50vw] max-w-[400px] max-h-[400px] rounded-full bg-white/5 blur-[65px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-syncopate font-bold text-xl tracking-[0.12em] text-white mb-1">
            HUNDLER
            <span className="relative inline-block ml-1.5">
              <span className="absolute inset-0 bg-gradient-to-r from-white to-zinc-300 blur-sm opacity-35"></span>
              <span className="relative text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 via-white to-zinc-400">VPN</span>
            </span>
          </h1>
          <p className="text-zinc-500 text-xs mt-2">
            {lang === 'ru' ? 'Войдите или зарегистрируйтесь по email' : 'Sign in or register with email'}
          </p>
        </div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gradient-to-b from-[#151515] via-[#0b0b0b] to-[#020202] border border-white/15 rounded-2xl p-5 shadow-2xl"
        >
          {step === 'email' ? (
            <>
              <div className="mb-4">
                <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                    placeholder="user@example.com"
                    autoFocus
                    className="w-full bg-zinc-800/60 border border-white/10 rounded-xl pl-10 pr-3 py-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25 transition-colors"
                  />
                </div>
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleSendCode}
                disabled={loading || !email.trim()}
                className="w-full bg-gradient-to-r from-white/20 to-white/10 border border-white/25 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 text-sm transition-all"
              >
                {loading ? '...' : (lang === 'ru' ? 'Получить код' : 'Get code')}
              </button>
            </>
          ) : (
            <>
              <div className="mb-2">
                <p className="text-zinc-400 text-xs mb-3">
                  {lang === 'ru' ? 'Код отправлен на' : 'Code sent to'} <span className="text-white">{email}</span>
                </p>
                <button onClick={() => { setStep('email'); setError(null); setCode(''); }} className="text-zinc-500 text-[10px] hover:text-white transition-colors mb-3 inline-block">
                  {lang === 'ru' ? '← Изменить email' : '← Change email'}
                </button>
              </div>

              <div className="mb-4">
                <label className="text-zinc-400 text-[10px] uppercase tracking-wider block mb-1.5">
                  {lang === 'ru' ? 'Код подтверждения' : 'Verification code'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                  placeholder="000000"
                  autoFocus
                  maxLength={6}
                  className="w-full bg-zinc-800/60 border border-white/10 rounded-xl px-3 py-3 text-center text-lg font-mono text-white tracking-[0.5em] placeholder:text-zinc-600 placeholder:tracking-[0.5em] outline-none focus:border-white/25 transition-colors"
                />
              </div>

              {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

              <button
                onClick={handleVerifyCode}
                disabled={loading || code.length < 6}
                className="w-full bg-gradient-to-r from-white/20 to-white/10 border border-white/25 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 text-sm transition-all mb-3"
              >
                {loading ? '...' : (lang === 'ru' ? 'Войти' : 'Sign in')}
              </button>

              <button
                onClick={handleResend}
                disabled={cooldown > 0 || loading}
                className="w-full text-zinc-500 text-xs py-2 hover:text-white transition-colors disabled:opacity-40"
              >
                {cooldown > 0
                  ? (lang === 'ru' ? `Отправить повторно (${cooldown}с)` : `Resend (${cooldown}s)`)
                  : (lang === 'ru' ? 'Отправить повторно' : 'Resend code')
                }
              </button>
            </>
          )}
        </motion.div>

        <div className="mt-4 text-center">
          <button onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors">
            {lang === 'ru' ? 'English' : 'Русский'}
          </button>
        </div>
      </div>
    </div>
  );
}
