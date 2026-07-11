import { memo, type ReactNode } from 'react';

const NavItem = memo(function NavItem({ icon, label, isActive, onClick, badge }: { icon: ReactNode; label: string; isActive: boolean; onClick: () => void; badge?: number }) {
  const hasBadge = typeof badge === 'number' && badge > 0;
  const badgeText = hasBadge ? (badge > 99 ? '99+' : String(badge)) : '';
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center w-14 h-12 gap-0.5 transition-colors relative active:scale-90 ${isActive ? 'text-red-500' : 'text-zinc-600 hover:text-zinc-400'}`}>
      <div className={`relative ${isActive ? 'drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]' : ''}`}>
        {icon}
        {hasBadge && (
          <span
            className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(239,68,68,0.6)] border border-zinc-950"
            aria-label={`${badge} unread`}
          >
            {badgeText}
          </span>
        )}
      </div>
      <span className="text-[8px] font-medium tracking-wider uppercase">{label}</span>
      {isActive && <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-red-500 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.6)]" />}
    </button>
  );
});

export default NavItem;
