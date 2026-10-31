"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, CircleAlert, LoaderCircle, Lock } from "lucide-react";
import { Logo } from "./Logo";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "error"; text: string };

export function OwnerLogin() {
  const [passcode, setPasscode] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passcode || state.kind === "busy") return;
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        window.location.assign("/");
        return;
      }
      setPasscode("");
      setState({ kind: "error", text: data?.error ?? `Sign-in failed (${res.status}).` });
    } catch {
      setState({ kind: "error", text: "Couldn't reach the server. Check your connection and try again." });
    }
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-ink px-4 pb-10 pt-safe sm:border-x sm:border-line/60">
      <div className="flex h-14 items-center">
        <Logo />
      </div>
      <a href="/" className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted">
        <ArrowLeft size={14} aria-hidden />
        Back to picks
      </a>

      <h1 className="mt-6 text-[21px] font-semibold leading-tight tracking-[-0.01em] text-fg">Owner sign-in</h1>
      <p className="mt-1 text-[13px] leading-snug text-muted">
        Unlocks the API Setup tab on this device. Visitors don&apos;t need to sign in.
      </p>

      <form onSubmit={submit} className="mt-5 rounded-2xl border border-line/80 bg-panel p-4">
        <label htmlFor="passcode" className="text-[14px] font-semibold text-fg">
          Passcode
        </label>
        <div className="mt-2 flex items-center rounded-xl border border-line bg-ink/60 focus-within:border-bull/60">
          <Lock size={16} className="ml-3.5 shrink-0 text-faint" aria-hidden />
          <input
            id="passcode"
            name="passcode"
            type="password"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              if (state.kind === "error") setState({ kind: "idle" });
            }}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            maxLength={256}
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[15px] text-fg outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!passcode || state.kind === "busy"}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-bull px-4 py-2.5 text-[14px] font-semibold text-ink disabled:opacity-50"
        >
          {state.kind === "busy" ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : null}
          Sign in
        </button>
        <p className="mt-3 min-h-5 text-[12.5px]" aria-live="polite">
          {state.kind === "error" ? (
            <span className="inline-flex items-start gap-1.5 text-bear">
              <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {state.text}
            </span>
          ) : null}
        </p>
      </form>
    </div>
  );
}
