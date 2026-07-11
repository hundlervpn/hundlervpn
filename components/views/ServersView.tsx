'use client';

import { pageVariants } from '@/app/_shared/constants';
import { ChevronRight, Globe, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Tab } from '@/app/_shared/constants';

export default function ServersView({ t, direction, navigate }: { t: any; direction: number; navigate: (tab: Tab) => void }) {
  const [servers, setServers] = useState<{ id: number; name: string; host: string; port: number; country: string; is_active: boolean; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pingResults, setPingResults] = useState<Record<number, number | null>>({});
  const [pinging, setPinging] = useState(false);

  // Known ISO-3166-1 alpha-2 codes we have rows for. Used to skip the
  // `flagcdn.com` request for an unknown code (which would 404 and trigger
  // an onError → Globe fallback anyway — but avoiding the request is cleaner).
  const knownCountryCodes = new Set(['NL', 'DE', 'US', 'FI', 'RU', 'GB', 'FR', 'SE', 'CA', 'JP', 'AU', 'SG']);

  // UI-friendly server name overrides. The canonical `name` column in the
  // DB stays untouched (production: «DE-Frankfurt-01», «NL-Amsterdam-02»
  // etc. — see /api/servers route + admin panel) so the ops/billing side
  // sees the technical hostname, while the user only sees the country
  // they recognise. Keep this map in sync with `knownCountryCodes` above.
  const COUNTRY_DISPLAY_NAMES: Record<string, string> = {
    DE: 'Германия',
    NL: 'Нидерланды',
    RU: 'Россия',
    FI: 'Финляндия',
    US: 'США',
    GB: 'Великобритания',
    FR: 'Франция',
    SE: 'Швеция',
    CA: 'Канада',
    JP: 'Япония',
    AU: 'Австралия',
    SG: 'Сингапур',
  };
  const displayServerName = (srv: { name: string; country: string }): string => {
    const code = (srv.country || '').toUpperCase();
    return COUNTRY_DISPLAY_NAMES[code] ?? srv.name;
  };

  const loadServers = async () => {
    try {
      const res = await fetch('/api/servers', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setServers(data.servers ?? []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const pingServers = async () => {
    setPinging(true);
    try {
      // Refresh the server list too — user may have pressed Ping specifically
      // because a newly added server is missing from the view.
      await loadServers();
      const res = await fetch('/api/servers/ping', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPingResults(data.ping ?? {});
      }
    } catch { /* ignore */ } finally { setPinging(false); }
  };

  useEffect(() => {
    loadServers();
  }, []);

  const activeCount = servers.filter(s => s.is_active).length;

  return (
    <motion.div
      custom={direction}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.25 }}
      className="w-full max-w-md mx-auto"
    >
      <div className="px-4 pb-28 space-y-5">
        {/* Header */}
        <div className="relative rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/10 via-zinc-900/50 to-zinc-900/30 p-4 overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('profile')} className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 -ml-1">
                <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
              </button>
              <div>
                <h2 className="text-white font-bold text-lg">{t.serversTitle}</h2>
                {!loading && servers.length > 0 && (
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.6)]" />
                      <span className="text-green-400/80 text-[10px] font-medium">{activeCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                      <span className="text-zinc-500 text-[10px] font-medium">{servers.length - activeCount}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={pingServers}
              disabled={pinging}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all text-xs text-red-400 font-medium disabled:opacity-50 active:scale-95"
            >
              <RefreshCw size={13} className={pinging ? 'animate-spin' : ''} />
              {pinging ? '...' : 'Ping'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-2 border-red-500/20 border-t-red-500 animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-white/5 bg-zinc-900/30">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800/50 border border-white/5 flex items-center justify-center">
              <Globe size={28} strokeWidth={1.2} className="text-zinc-600" />
            </div>
            <p className="text-zinc-500 text-sm">{t.noServers}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((srv, idx) => (
              <div 
                key={srv.id} 
                className={`group relative rounded-2xl border transition-all duration-300 overflow-hidden ${
                  srv.is_active 
                    ? 'bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-green-950/20 border-green-500/20 hover:border-green-500/40 shadow-[0_0_20px_rgba(34,197,94,0.05)]' 
                    : 'bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border-white/5 hover:border-white/10'
                }`}
              >
                {srv.is_active && (
                  <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-full blur-2xl" />
                )}
                <div className="relative p-4">
                  <div className="flex items-center gap-4">
                    {/* Flag */}
                    <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden ${
                      srv.is_active 
                        ? 'bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/30' 
                        : 'bg-zinc-800/60 border border-white/5'
                    }`}>
                      {knownCountryCodes.has(srv.country.toUpperCase()) ? (
                        <img
                          src={`https://flagcdn.com/h60/${srv.country.toLowerCase()}.png`}
                          srcSet={`https://flagcdn.com/h120/${srv.country.toLowerCase()}.png 2x, https://flagcdn.com/h240/${srv.country.toLowerCase()}.png 4x`}
                          alt={srv.country}
                          loading="lazy"
                          className="w-9 h-7 object-cover rounded-md shadow-sm"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.style.display = 'none';
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <span
                        className="text-zinc-400 text-xs font-bold tracking-wider"
                        style={{ display: knownCountryCodes.has(srv.country.toUpperCase()) ? 'none' : 'flex' }}
                      >
                        {srv.country.toUpperCase()}
                      </span>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-900 ${
                        srv.is_active ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-zinc-600'
                      }`} />
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold truncate">{displayServerName(srv)}</p>
                      <p className="text-zinc-500 text-xs mt-0.5 uppercase tracking-wider">{srv.country}</p>
                    </div>
                    
                    {/* Ping */}
                    {pingResults[srv.id] !== undefined && (
                      <div className={`text-xs font-mono font-bold px-2.5 py-1.5 rounded-xl border ${
                        pingResults[srv.id] === null 
                          ? 'text-red-400 bg-red-500/10 border-red-500/20' 
                          : pingResults[srv.id]! < 100 
                            ? 'text-green-400 bg-green-500/10 border-green-500/20' 
                            : pingResults[srv.id]! < 300 
                              ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' 
                              : 'text-orange-400 bg-orange-500/10 border-orange-500/20'
                      }`}>
                        {pingResults[srv.id] === null ? 'ERR' : `${pingResults[srv.id]}ms`}
                      </div>
                    )}
                    
                    {/* Status badge */}
                    <div className={`text-[9px] uppercase tracking-widest font-bold px-2.5 py-1.5 rounded-xl ${
                      srv.is_active 
                        ? 'text-green-400 bg-green-500/15 border border-green-500/30' 
                        : 'text-zinc-500 bg-zinc-800/50 border border-white/5'
                    }`}>
                      {srv.is_active ? t.serverActive : t.serverInactive}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
