export function PulseMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="#131B2E" />
      <polyline
        points="5,20.5 10.5,20.5 12.6,14 15,25 17.6,9.5 19.8,17 26,12"
        fill="none"
        stroke="#10B981"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="12" r="2.3" fill="#10B981" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2 select-none">
      <PulseMark className="size-8" />
      <span className="font-ticker text-[25px] font-bold leading-none max-[359px]:text-[22px] tracking-[0.01em] text-fg">
        Pulse<span className="text-bull">Alpha</span>
      </span>
    </div>
  );
}
