import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { acceptFn, announcementFn, loginFn, ordersFn, statusFn } from "@/lib/riyalen.functions";
import { methodMatches, parseOrders } from "@/lib/orders";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Order Auto-Accept Board" },
      { name: "description", content: "Log in and auto-accept merchant orders that match your filters." },
      { property: "og:title", content: "Order Auto-Accept Board" },
      { property: "og:description", content: "Log in and auto-accept merchant orders that match your filters." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UserPanel,
});

const DEFAULT_METHODS = ["STC Pay", "Barq", "Urpay", "Banks"];

type Status = {
  username?: string;
  status?: string;
  expired?: boolean;
  active?: boolean;
  settings?: { admin_contact_text: string; admin_contact_link: string } | null;
};
type LogRow = { time: string; orderNo: string; amount: string; payType: string; option: string; createdAt: string; raw: string; result: "Accepted" | "Skipped" | "Failed"; reason: string };
type Filters = { methods: string[]; min: number | null; max: number | null; interval: number };
const DEFAULT_FILTERS: Filters = { methods: [], min: null, max: null, interval: 15 };
const toNum = (s: string): number | null => { if (s.trim() === "") return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const describe = (f: Filters) => `Filter: methods=${f.methods.join(",") || "none"} | amount ${f.min ?? 0}-${f.max ?? "∞"} | interval ${f.interval}s`;

function useLocal<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s !== null) setV(JSON.parse(s));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (loaded) localStorage.setItem(key, JSON.stringify(v));
  }, [key, v, loaded]);
  return [v, setV, loaded] as const;
}

function UserPanel() {
  const [session, setSession, loaded] = useLocal<{ token: string; username: string } | null>("oab_session", null);
  if (!loaded) return <div className="min-h-screen bg-background" />;
  return session ? (
    <Dashboard session={session} onLogout={(msg?: string) => { setSession(null); if (msg) sessionStorage.setItem("oab_msg", msg); }} />
  ) : (
    <Login onLogin={setSession} />
  );
}

function Login({ onLogin }: { onLogin: (s: { token: string; username: string }) => void }) {
  const login = useServerFn(loginFn);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const m = sessionStorage.getItem("oab_msg");
    if (m) { setError(m); sessionStorage.removeItem("oab_msg"); }
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await login({ data: { username, password } }).catch(() => ({ ok: false as const, error: "Network error" }));
    setBusy(false);
    if (r.ok) onLogin({ token: r.token, username: r.username });
    else setError(r.error);
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h1 className="text-xl font-semibold">Order Auto-Accept Board</h1>
          <p className="text-sm text-muted-foreground">Sign in with your merchant account.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="u">Username</Label>
          <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p">Password</Label>
          <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </main>
  );
}

function Dashboard({ session, onLogout }: { session: { token: string; username: string }; onLogout: (msg?: string) => void }) {
  const getStatus = useServerFn(statusFn);
  const getOrders = useServerFn(ordersFn);
  const accept = useServerFn(acceptFn);
  const getAnnouncement = useServerFn(announcementFn);

  const [status, setStatus] = useState<Status | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [running, setRunning] = useState(false);
  const [savedRaw, setSaved, savedLoaded] = useLocal<Filters>("oab_filters", DEFAULT_FILTERS);
  const saved: Filters = {
    methods: (savedRaw.methods ?? []).filter((m) => DEFAULT_METHODS.includes(m)),
    min: typeof savedRaw.min === "number" ? savedRaw.min : null,
    max: typeof savedRaw.max === "number" ? savedRaw.max : null,
    interval: Math.max(10, Number(savedRaw.interval) || 15),
  };
  const intervalSec = saved.interval;
  const [methods, setMethods] = useState<string[]>([]);
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [intervalDraft, setIntervalDraft] = useState("15");
  const [justSaved, setJustSaved] = useState(false);
  const [lastFilter, setLastFilter] = useState("");
  useEffect(() => {
    if (!savedLoaded) return;
    setMethods(saved.methods);
    setMinAmt(saved.min === null ? "" : String(saved.min));
    setMaxAmt(saved.max === null ? "" : String(saved.max));
    setIntervalDraft(String(saved.interval));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLoaded]);
  const draft: Filters = { methods, min: toNum(minAmt), max: toNum(maxAmt), interval: Math.max(10, Number(intervalDraft) || 10) };
  const dirty = JSON.stringify([...draft.methods].sort()) !== JSON.stringify([...saved.methods].sort())
    || draft.min !== saved.min || draft.max !== saved.max || draft.interval !== saved.interval;
  const saveFilters = () => {
    setSaved(draft);
    setIntervalDraft(String(draft.interval));
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };
  const [sound, setSound] = useLocal<boolean>("oab_sound", true);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [counts, setCounts] = useState({ accepted: 0, skipped: 0, failed: 0 });
  const [raw, setRaw] = useState("");
  const [lastPoll, setLastPoll] = useState("");
  const [pollError, setPollError] = useState("");
  const seen = useRef<Set<string>>(new Set());
  const busy = useRef(false);

  const cfg = useRef({ filters: saved, sound });
  cfg.current = { filters: saved, sound };

  const expire = useCallback(() => {
    setRunning(false);
    onLogout("Session expired. Please log in again.");
  }, [onLogout]);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await getStatus({ data: { token: session.token } });
      if (r.authError) return expire();
      if ("networkError" in r && r.networkError) return;
      setStatus(r as Status);
      if (!r.active) setRunning(false);
    } catch {
      /* retry next time */
    }
  }, [getStatus, session.token, expire]);

  useEffect(() => {
    refreshStatus();
    getAnnouncement().then((r) => {
      if (!r.ok) return;
      let b: unknown = null;
      try { b = JSON.parse(r.body); } catch { /* ignore */ }
      const text = typeof b === "string" ? b : findText(b);
      setAnnouncement(text);
    }).catch(() => {});
    const id = setInterval(refreshStatus, 60_000);
    return () => clearInterval(id);
  }, [refreshStatus, getAnnouncement]);

  const addLog = (row: Omit<LogRow, "time">) => {
    setLogs((l) => [{ ...row, time: new Date().toLocaleTimeString() }, ...l].slice(0, 300));
    setCounts((c) => ({
      accepted: c.accepted + (row.result === "Accepted" ? 1 : 0),
      skipped: c.skipped + (row.result === "Skipped" ? 1 : 0),
      failed: c.failed + (row.result === "Failed" ? 1 : 0),
    }));
  };

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await getOrders({ data: { token: session.token } });
      setLastPoll(new Date().toLocaleTimeString());
      if (r.authError) return expire();
      if (r.status === 429) { setPollError("Rate limited by server, retrying next interval."); return; }
      if (r.status === 0 || r.status >= 500) { setPollError(`Server/network error (${r.status || "offline"}), retrying.`); return; }
      setPollError("");
      setRaw(r.body);
      let body: unknown = null;
      try { body = JSON.parse(r.body); } catch { /* ignore */ }
      const orders = parseOrders(body);
      const { filters: f, sound: snd } = cfg.current;
      const sel = f.methods;
      const min: number = f.min ?? 0;
      const max: number = f.max ?? Infinity;
      setLastFilter(describe(f));
      const maxLabel = f.max === null ? "∞" : String(f.max);
      for (const o of orders) {
        if (seen.current.has(o.orderNo)) continue;
        seen.current.add(o.orderNo);
        const base = {
          orderNo: o.orderNo,
          amount: o.amount === null ? "?" : String(o.amount),
          payType: o.payType || "?",
          option: o.option,
          createdAt: o.createdAt,
          raw: JSON.stringify(o.raw, null, 2),
        };
        if (!o.available) { addLog({ ...base, result: "Skipped", reason: "not available" }); continue; }
        if (o.locked) { addLog({ ...base, result: "Skipped", reason: `locked: ${o.lockMessage}` }); continue; }
        if (!methodMatches(o.payType, sel)) { addLog({ ...base, result: "Skipped", reason: `method ${o.option} not selected` }); continue; }
        if (o.amount === null) { addLog({ ...base, result: "Skipped", reason: "amount not found" }); continue; }
        if (o.amount < min || o.amount > max) { addLog({ ...base, result: "Skipped", reason: `amount ${o.amount} outside ${min}-${maxLabel}` }); continue; }
        const a = await accept({ data: { token: session.token, order_no: o.orderNo } }).catch(() => ({ ok: false, error: "network_error" } as { ok: boolean; error?: string; authError?: boolean }));
        if (a.ok) {
          addLog({ ...base, result: "Accepted", reason: "" });
          if (snd) beep();
        } else {
          addLog({ ...base, result: "Failed", reason: a.error ?? "error" });
          if ("authError" in a && a.authError) return expire();
          if (a.error === "not_approved") { setRunning(false); refreshStatus(); return; }
        }
      }
    } catch {
      setPollError("Network error, retrying next interval.");
    } finally {
      busy.current = false;
    }
  }, [getOrders, accept, session.token, expire, refreshStatus]);

  useEffect(() => {
    if (!running) return;
    poll();
    const id = setInterval(poll, Math.max(10, intervalSec) * 1000);
    return () => clearInterval(id);
  }, [running, intervalSec, poll]);

  const active = !!status?.active;
  const toggleMethod = (m: string) => setMethods((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));

  return (
    <main className="min-h-screen bg-background p-4 pb-16">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Order Auto-Accept Board</h1>
            <p className="text-xs text-muted-foreground">Signed in as <span className="font-mono">{session.username}</span></p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setRunning(false); onLogout(); }}>Logout</Button>
        </header>

        {announcement && (
          <div className="rounded-lg border border-border bg-secondary p-3 text-sm">{announcement}</div>
        )}

        {status && !active && (
          <div className="rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
            <p className="font-semibold text-warning">Bot is currently off. Contact your admin to activate.</p>
            <p className="mt-1 text-muted-foreground">
              Status: {status.expired ? "expired" : status.status}
            </p>
            {status.settings?.admin_contact_link && (
              <a href={status.settings.admin_contact_link} target="_blank" rel="noreferrer" className="mt-2 inline-block font-medium text-primary underline">
                {status.settings.admin_contact_text || "Contact admin"}
              </a>
            )}
          </div>
        )}

        <section className="grid grid-cols-3 gap-2">
          <Stat label="Accepted" value={counts.accepted} tone="text-success" />
          <Stat label="Skipped" value={counts.skipped} tone="text-muted-foreground" />
          <Stat label="Failed" value={counts.failed} tone="text-destructive" />
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <Button
              className="flex-1"
              variant={running ? "destructive" : "default"}
              disabled={!running && (!active || saved.methods.length === 0)}
              onClick={() => setRunning((r) => !r)}
            >
              {running ? "Stop" : "Start"}
            </Button>
            <div className="w-28 space-y-1">
              <Label htmlFor="int" className="text-xs">Interval (s, min 10)</Label>
              <Input
                id="int"
                type="number"
                min={10}
                value={intervalDraft}
                onChange={(e) => setIntervalDraft(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{running ? `Running · last poll ${lastPoll || "—"}` : "Stopped"}</span>
            <label className="flex items-center gap-2">Sound on accept <Switch checked={sound} onCheckedChange={setSound} /></label>
          </div>
          {!running && saved.methods.length === 0 && <p className="text-xs text-warning">Select and save at least one payment method to start.</p>}
          {running && lastFilter && <p className="font-mono text-xs text-muted-foreground">{lastFilter}</p>}
          {pollError && <p className="text-xs text-warning">{pollError}</p>}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Payment methods</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DEFAULT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <Checkbox checked={methods.includes(m)} onCheckedChange={() => toggleMethod(m)} />
                <span className="flex-1">{m}</span>
              </label>
            ))}
          </div>
          <h2 className="pt-2 text-sm font-semibold">Amount (SAR)</h2>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" placeholder="Min" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} />
            <Input type="number" placeholder="Max" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={saveFilters} disabled={!dirty}>Save filters</Button>
            {dirty ? <span className="text-xs text-warning">Unsaved changes</span> : justSaved ? <span className="text-xs text-success">Saved</span> : null}
          </div>
          <p className="font-mono text-xs text-muted-foreground">Active: {describe(saved)}</p>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border p-3 text-sm font-semibold">Live log</h2>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                <tr><th className="p-2">Time</th><th className="p-2">Order</th><th className="p-2">Amount (SAR)</th><th className="p-2">Method</th><th className="p-2">Option</th><th className="p-2">Result</th></tr>
              </thead>
              <tbody>
                {logs.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No orders yet.</td></tr>}
                {logs.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 font-mono">
                      <div>{l.time}</div>
                      {l.createdAt && <div className="text-[10px] text-muted-foreground">{l.createdAt}</div>}
                    </td>
                    <td className="p-2 font-mono">
                      <div>{l.orderNo}</div>
                      <details>
                        <summary className="cursor-pointer text-muted-foreground">Raw</summary>
                        <pre className="max-w-xs overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]">{l.raw}</pre>
                      </details>
                    </td>
                    <td className="p-2 font-mono">{l.amount}</td>
                    <td className="p-2">{l.payType}</td>
                    <td className="p-2">{l.option}</td>
                    <td className={`p-2 ${l.result === "Accepted" ? "text-success" : l.result === "Failed" ? "text-destructive" : "text-muted-foreground"}`}>
                      {l.result}{l.reason ? ` · ${l.reason}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <details className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">Debug: raw orders response</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
            {raw ? prettify(raw) : "No response yet. Start the bot to poll."}
          </pre>
        </details>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-center">
      <div className={`font-mono text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function prettify(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function findText(b: unknown, depth = 0): string {
  if (depth > 4 || !b) return "";
  if (typeof b === "string") return b;
  if (typeof b === "object") {
    const o = b as Record<string, unknown>;
    for (const k of ["content", "announcement", "text", "message", "notice", "title"]) {
      if (typeof o[k] === "string" && o[k]) return o[k] as string;
    }
    for (const k of ["data", "result"]) {
      const r = findText(o[k], depth + 1);
      if (r) return r;
    }
  }
  return "";
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* ignore */
  }
}
