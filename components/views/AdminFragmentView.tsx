'use client';

import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { haptic } from '@/lib/haptic';

export default function AdminFragmentView({ tgId, lang }: { tgId: number | undefined; lang: 'ru' | 'en' }) {
  const [prices, setPrices] = useState<{ id?: number; product_type: string; period: string; stars_amount: number | null; price_rub: string; is_active: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<{ id: number; user_id: number; product_type: string; period: string; stars_amount: number | null; price_rub: string; telegram_username: string | null; status: string; first_name: string | null; username: string | null; telegram_id: number | null; created_at: string }[]>([]);

  const defaultPrices = [
    { product_type: 'premium', period: '3 months', stars_amount: null, price_rub: '1200', is_active: true },
    { product_type: 'premium', period: '6 months', stars_amount: null, price_rub: '1700', is_active: true },
    { product_type: 'premium', period: '12 months', stars_amount: null, price_rub: '2900', is_active: true },
    { product_type: 'stars', period: '100 stars', stars_amount: 100, price_rub: '200', is_active: true },
    { product_type: 'stars', period: '500 stars', stars_amount: 500, price_rub: '900', is_active: true },
    { product_type: 'stars', period: '1000 stars', stars_amount: 1000, price_rub: '1700', is_active: true },
  ];

  useEffect(() => {
    const load = async () => {
      try {
        const [pricesRes, ordersRes] = await Promise.all([
          fetch('/api/fragment/prices'),
          fetch(`/api/fragment/order?telegramId=${tgId}`),
        ]);
        
        if (pricesRes.ok) {
          const data = await pricesRes.json();
          if (data.prices?.length > 0) {
            setPrices(data.prices.map((p: any) => ({ ...p, price_rub: String(p.price_rub) })));
          } else {
            setPrices(defaultPrices);
          }
        } else {
          setPrices(defaultPrices);
        }
        
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          setOrders(data.orders || []);
        }
      } catch { setPrices(defaultPrices); } finally { setLoading(false); }
    };
    load();
  }, [tgId]);

  const updatePrice = (index: number, field: string, value: string | boolean) => {
    setPrices(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const handleSave = async () => {
    haptic('medium');
    if (!tgId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/fragment/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: tgId,
          prices: prices.map(p => ({
            product_type: p.product_type,
            period: p.period,
            stars_amount: p.stars_amount,
            price_rub: parseFloat(p.price_rub) || 0,
            is_active: p.is_active,
          })),
        }),
      });
      if (res.ok) {
        alert(lang === 'ru' ? 'Сохранено!' : 'Saved!');
      }
    } catch { alert('Error'); } finally { setSaving(false); }
  };

  const handleOrderStatus = async (orderId: number, status: string) => {
    haptic('medium');
    try {
      await fetch('/api/fragment/order/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, orderId, status }),
      });
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
    } catch { /* ignore */ }
  };

  const handleDeleteOrder = async (orderId: number) => {
    haptic('heavy');
    if (!confirm(lang === 'ru' ? 'Удалить заказ?' : 'Delete order?')) return;
    try {
      await fetch('/api/fragment/order/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, orderId }),
      });
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch { /* ignore */ }
  };

  const periodLabels: Record<string, string> = {
    '3 months': '3 мес', '6 months': '6 мес', '12 months': '12 мес',
    '100 stars': '100 ⭐', '500 stars': '500 ⭐', '1000 stars': '1000 ⭐',
  };

  if (loading) return <div className="text-center py-8 text-zinc-400">Загрузка...</div>;

  return (
    <div className="space-y-4">
      {/* Prices */}
      <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
        <h3 className="text-white font-medium mb-3 flex items-center gap-2">
          <Star size={16} className="text-yellow-400" />
          {lang === 'ru' ? 'Цены Fragment' : 'Fragment Prices'}
        </h3>
        <div className="space-y-2">
          {prices.map((price, index) => (
            <div key={`${price.product_type}-${price.period}`} className="p-2 bg-zinc-800/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${price.product_type === 'premium' ? 'bg-purple-500/20 text-purple-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {price.product_type === 'premium' ? 'Premium' : 'Stars'}
                  </span>
                  <span className="text-zinc-400 text-xs">{periodLabels[price.period] || price.period}</span>
                </div>
                <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={price.is_active} onChange={(e) => updatePrice(index, 'is_active', e.target.checked)} className="rounded w-3 h-3" />
                  Вкл
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={price.price_rub}
                  onChange={(e) => updatePrice(index, 'price_rub', e.target.value)}
                  className="w-full bg-zinc-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                  placeholder="Цена в ₽"
                />
              </div>
            </div>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving} className="mt-3 w-full bg-gradient-to-r from-purple-500 to-yellow-500 text-white font-medium py-2 rounded-lg text-sm disabled:opacity-50">
          {saving ? '...' : (lang === 'ru' ? 'Сохранить цены' : 'Save prices')}
        </button>
      </div>

      {/* Orders */}
      <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
        <h3 className="text-white font-medium mb-3">{lang === 'ru' ? 'Заказы' : 'Orders'}</h3>
        {orders.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-4">{lang === 'ru' ? 'Заказов пока нет' : 'No orders yet'}</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {orders.map(order => (
              <div key={order.id} className="p-2 bg-zinc-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white text-sm font-medium">#{order.id} {order.first_name || order.username}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${order.status === 'paid' ? 'bg-green-500/20 text-green-400' : order.status === 'completed' ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-500/20 text-zinc-400'}`}>
                      {order.status}
                    </span>
                    <button onClick={() => handleDeleteOrder(order.id)} className="text-red-400 hover:text-red-300 text-xs">
                      ✕
                    </button>
                  </div>
                </div>
                <div className="text-xs text-zinc-400">
                  <span className="text-zinc-500">ID:{order.user_id}</span> • {order.product_type === 'stars' ? `${order.stars_amount} ⭐` : `Premium ${order.period.replace('_', ' ')}`} • {order.price_rub} ₽ • @{order.telegram_username}
                </div>
                {order.status === 'paid' && (
                  <button onClick={() => handleOrderStatus(order.id, 'completed')} className="mt-2 text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded hover:bg-green-500/30">
                    ✓ Выполнено
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
