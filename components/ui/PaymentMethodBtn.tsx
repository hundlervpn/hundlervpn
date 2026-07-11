import { memo, type ReactNode } from 'react';

const PaymentMethodBtn = memo(function PaymentMethodBtn({ icon, label, isActive, onClick }: { icon: ReactNode; label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all gap-1 active:scale-95 ${isActive ? 'bg-gradient-to-br from-red-500/15 to-red-500/5 border-red-500/40 shadow-[0_0_16px_rgba(239,68,68,0.2)]' : 'bg-zinc-950/50 border-white/5 hover:bg-zinc-900/50 hover:border-red-500/20'}`}>
      {icon}
      <span className={`text-[8px] font-medium uppercase tracking-wider text-center ${isActive ? 'text-white' : 'text-zinc-500'}`}>{label}</span>
    </button>
  );
});

export default PaymentMethodBtn;
