"use client";

import { useState } from "react";
import { Check, CircleAlert, Eye, EyeOff, FlaskConical, LoaderCircle, LogOut, Radio, ShieldCheck } from "lucide-react";
import type { Settings } from "@/lib/client-store";
import type { DataMode, ServerConfig } from "@/lib/types";

interface Props {
  settings: Settings;
  config: ServerConfig | null;
  onChange: (next: Settings) => void;
  onSignOut: () => void;
}

type Verify = { state: "idle" } | { state: "busy" } | { state: "ok"; text: string } | { state: "error"; text: string };

const MODES: ReadonlyArray<{ id: DataMode; title: string; body: string; icon: typeof Radio }> = [
  {
    id: "live",
    title: "Live NSE Yahoo Finance Data",
    body: "Scans ~90 liquid Nifty 200 stocks with live prices and Google News. Falls back to simulated data if Yahoo rate-limits.",
    icon: Radio,
  },
  {
    id: "demo",
    title: "Instant Realistic Demo Mode",
    body: "Simulated prices run through the same filter and levels. Loads instantly; never use it to trade.",
    icon: FlaskConical,
  },
];

export function SetupView({ settings, config, onChange, onSignOut }: Props) {
  const [draftKey, setDraftKey] = useState(settings.geminiKey);
  const [draftModel, setDraftModel] = useState(settings.model);
  const [reveal, setReveal] = useState(false);
  const [verify, setVerify] = useState<Verify>({ state: "idle" });

  const dirty = draftKey.trim() !== settings.geminiKey || draftModel.trim() !== settings.model;
  const defaultModel = config?.defaultModel ?? "gemini-3.5-flash";

  async function testKey() {
    setVerify({ state: "busy" });
    try {
      const res = await fetch("/api/verify-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(draftKey.trim() ? { "x-gemini-key": draftKey.trim() } : {}),
        },
        body: JSON.stringify({ model: draftModel.trim() || undefined }),
      });
      const data = (await res.json()) as { ok: boolean; model?: string; error?: string; warning?: string };
      if (data.ok) {
        setVerify({ state: "ok", text: data.warning ?? `Key works with ${data.model ?? defaultModel}.` });
      } else {
        setVerify({ state: "error", text: data.error ?? "Key check failed." });
      }
    } catch {
      setVerify({ state: "error", text: "Couldn't reach the server. Check your connection and try again." });
    }
  }

  const keySource = settings.geminiKey
    ? "Using the key saved on this device."
    : config?.hasServerKey
      ? "Using the key configured on the server."
      : "No key yet — picks are ranked by the rules engine until you add one.";

  return (
    <section className="px-4 pt-5">
      <h1 className="text-[21px] font-semibold leading-tight tracking-[-0.01em] text-fg">API Setup</h1>
      <p className="mt-1 text-[13px] text-muted">Choose the data source and connect Gemini for AI evaluation.</p>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-bull/30 bg-bull/[0.07] px-3.5 py-3">
        <ShieldCheck size={18} className="shrink-0 text-bull" aria-hidden />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-fg">
          Owner mode. Only you can see this tab; visitors get the shared scan only.
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-semibold text-fg"
        >
          <LogOut size={13} aria-hidden />
          Sign out
        </button>
      </div>

      <div className="mt-4 rounded-t-3xl rounded-b-2xl border border-line/80 bg-panel px-4 pb-5 pt-2.5">
        <div className="mx-auto h-1 w-10 rounded-full bg-line" aria-hidden />

        <fieldset className="mt-4">
          <legend className="text-[14px] font-semibold text-fg">Data source</legend>
          <div className="mt-2.5 space-y-2.5" role="radiogroup">
            {MODES.map(({ id, title, body, icon: Icon }) => {
              const active = settings.mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...settings, mode: id })}
                  className={`flex w-full gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                    active ? "border-bull/60 bg-bull/[0.07]" : "border-line bg-ink/40"
                  }`}
                >
                  <Icon size={18} className={`mt-0.5 shrink-0 ${active ? "text-bull" : "text-muted"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-fg">{title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{body}</span>
                  </span>
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${
                      active ? "border-bull bg-bull text-ink" : "border-line"
                    }`}
                    aria-hidden
                  >
                    {active ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-6">
          <label htmlFor="gemini-key" className="text-[14px] font-semibold text-fg">
            Gemini API key
          </label>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
            Optional. The safest place for your key is GEMINI_API_KEY in Vercel, where it never touches a browser. A key
            pasted here stays on this device and is sent only to this app&apos;s own server, and only while you are
            signed in. Get one at aistudio.google.com/apikey.
          </p>
          <div className="mt-2.5 flex items-center rounded-xl border border-line bg-ink/60 focus-within:border-bull/60">
            <input
              id="gemini-key"
              type={reveal ? "text" : "password"}
              value={draftKey}
              onChange={(e) => {
                setDraftKey(e.target.value);
                setVerify({ state: "idle" });
              }}
              placeholder="AIza…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-3.5 py-3 font-mono text-[14px] text-fg outline-none"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              className="shrink-0 px-3 text-muted"
              aria-label={reveal ? "Hide key" : "Show key"}
            >
              {reveal ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          <label htmlFor="gemini-model" className="mt-4 block text-[13px] font-semibold text-fg">
            Model
          </label>
          <input
            id="gemini-model"
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            placeholder={defaultModel}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="mt-1.5 w-full rounded-xl border border-line bg-ink/60 px-3.5 py-2.5 text-[14px] text-fg outline-none focus:border-bull/60"
          />
          <p className="mt-1 text-[12px] text-faint">Leave blank for {defaultModel}.</p>

          <div className="mt-3.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!dirty}
              onClick={() => {
                onChange({ ...settings, geminiKey: draftKey.trim(), model: draftModel.trim() });
                setVerify({ state: "idle" });
              }}
              className="rounded-full bg-bull px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-40"
            >
              Save key
            </button>
            <button
              type="button"
              onClick={testKey}
              disabled={verify.state === "busy" || (!draftKey.trim() && !config?.hasServerKey)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-fg disabled:opacity-40"
            >
              {verify.state === "busy" ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : null}
              Test key
            </button>
            {settings.geminiKey ? (
              <button
                type="button"
                onClick={() => {
                  setDraftKey("");
                  onChange({ ...settings, geminiKey: "" });
                  setVerify({ state: "idle" });
                }}
                className="rounded-full px-3 py-2 text-[13px] font-semibold text-bear"
              >
                Remove key
              </button>
            ) : null}
          </div>

          <p className="mt-3 text-[12.5px] text-muted" aria-live="polite">
            {verify.state === "ok" ? (
              <span className="inline-flex items-center gap-1.5 text-bull">
                <Check size={14} aria-hidden /> {verify.text}
              </span>
            ) : verify.state === "error" ? (
              <span className="inline-flex items-start gap-1.5 text-bear">
                <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> {verify.text}
              </span>
            ) : (
              keySource
            )}
          </p>
        </div>

        <p className="mt-6 border-t border-line pt-4 text-[12px] leading-snug text-faint">
          Market data is cached on the server and shared by everyone for{" "}
          {Math.round((config?.marketRefreshSeconds ?? 180) / 60)} minutes, so opening the app is instant and Yahoo
          isn&apos;t hit on every tap. Signal History stays on each visitor&apos;s own device.
        </p>
      </div>
    </section>
  );
}
