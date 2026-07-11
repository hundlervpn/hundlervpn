'use client';

import { hapticNotification } from '@/lib/haptic';
import { ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export default function AdminPasswordGate({ lang, expected, onUnlock, onCancel }: { lang: 'ru' | 'en'; expected: string; onUnlock: () => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (value.trim() === expected) {
      hapticNotification('success');
      onUnlock();
    } else {
      hapticNotification('error');
      setError(lang === 'ru' ? 'Неверный пароль' : 'Wrong password');
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setValue('');
      inputRef.current?.focus();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center flex-1 px-4 py-8"
    >
      <div className={`w-full max-w-sm rounded-2xl border border-red-500/20 bg-gradient-to-br from-zinc-900/60 via-zinc-900/40 to-black/60 p-6 ${shake ? 'animate-shake' : ''}`}>
        <div className="flex items-center justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/40 flex items-center justify-center shadow-[0_0_24px_rgba(239,68,68,0.2)]">
            <ShieldAlert size={26} className="text-red-400" />
          </div>
        </div>
        <h2 className="text-white text-lg font-bold text-center mb-1">
          {lang === 'ru' ? 'Доступ в админку' : 'Admin access'}
        </h2>
        <p className="text-zinc-400 text-xs text-center mb-5">
          {lang === 'ru' ? 'Введите пароль для входа в панель' : 'Enter the password to open the panel'}
        </p>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
            placeholder="••••"
            maxLength={16}
            className="w-full bg-zinc-800/60 border border-white/10 rounded-xl px-4 py-3 text-center text-white text-xl tracking-[0.4em] placeholder:text-zinc-600 placeholder:tracking-[0.4em] outline-none focus:border-red-500/40"
          />
          {error && (
            <p className="text-red-400 text-xs text-center mt-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={!value.trim()}
            className="w-full mt-4 rounded-xl py-3 px-4 font-bold text-white text-sm bg-gradient-to-r from-red-600 via-red-500 to-red-600 shadow-[0_8px_32px_-8px_rgba(239,68,68,0.6)] hover:shadow-[0_8px_36px_-6px_rgba(239,68,68,0.75)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {lang === 'ru' ? 'Войти' : 'Sign in'}
          </button>
        </form>
        <button
          onClick={onCancel}
          className="w-full mt-2 text-zinc-500 hover:text-zinc-300 text-xs py-2 transition-colors"
        >
          {lang === 'ru' ? 'Отмена' : 'Cancel'}
        </button>
      </div>
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </motion.div>
  );
}
