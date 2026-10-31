"use client";

import { History, KeyRound, TrendingUp, type LucideIcon } from "lucide-react";

export type Tab = "picks" | "history" | "setup";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "picks", label: "Today's Picks", icon: TrendingUp },
  { id: "history", label: "Signal History", icon: History },
  { id: "setup", label: "API Setup", icon: KeyRound },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t border-line/80 bg-ink/95 pb-safe backdrop-blur-md"
      aria-label="Primary"
    >
      <ul className="grid grid-cols-3">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11.5px] font-medium transition-colors ${
                  active ? "text-bull" : "text-muted"
                }`}
              >
                <span
                  className={`absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-bull transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
                  aria-hidden
                />
                <Icon size={21} strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
