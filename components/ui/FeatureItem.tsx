import { Check } from 'lucide-react';

export default function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-3.5 h-3.5 rounded-full bg-red-500/12 flex items-center justify-center shrink-0 border border-red-500/30">
        <Check size={8} strokeWidth={2.5} className="text-red-400" />
      </div>
      <span className="text-zinc-300 text-xs">{text}</span>
    </div>
  );
}
