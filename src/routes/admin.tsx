import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin · Order Auto-Accept Board" },
      { name: "description", content: "Manage buyer access to the Order Auto-Accept Board." },
      { property: "og:title", content: "Admin · Order Auto-Accept Board" },
      { property: "og:description", content: "Manage buyer access to the Order Auto-Accept Board." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type BotUser = {
  id: string;
  riyalen_username: string;
  status: string;
  expires_at: string | null;
  notes: string;
  created_at: string;
  last_seen_at: string | null;
  accepted_count: number;
};

function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsAdmin(null); return; }
    supabase.rpc("claim_admin").then(({ data }) => setIsAdmin(data === true));
  }, [session]);

  if (!ready) return <div className="min-h-screen bg-background" />;
  if (!session) return <AdminLogin />;
  if (isAdmin === null) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin)
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-4">
        <p className="text-sm">This account is not an admin.</p>
        <Button variant="outline" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </main>
    );
  return <AdminDashboard />;
}

function AdminLogin() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/admin` } });
      if (error) setMsg(error.message);
      else if (!data.session) setMsg("Check your email to confirm your account, then sign in.");
    }
    setBusy(false);
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Admin {mode === "in" ? "sign in" : "sign up"}</h1>
        <div className="space-y-1.5"><Label htmlFor="e">Email</Label><Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="space-y-1.5"><Label htmlFor="pw">Password</Label><Input id="pw" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</Button>
        <button type="button" className="w-full text-xs text-muted-foreground underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "First time? Create the admin account" : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}

function AdminDashboard() {
  const [users, setUsers] = useState<BotUser[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [contactText, setContactText] = useState("");
  const [contactLink, setContactLink] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("bot_users").select("*").order("created_at", { ascending: false });
    setUsers((data as BotUser[]) ?? []);
  }, []);

  useEffect(() => {
    load();
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      if (data) { setContactText(data.admin_contact_text); setContactLink(data.admin_contact_link); }
    });
  }, [load]);

  const update = async (id: string, patch: Partial<BotUser>) => {
    await supabase.from("bot_users").update(patch).eq("id", id);
    load();
  };
  const extend = (u: BotUser, days: number) => {
    const base = u.expires_at && new Date(u.expires_at) > new Date() ? new Date(u.expires_at) : new Date();
    base.setDate(base.getDate() + days);
    update(u.id, { expires_at: base.toISOString() });
  };
  const del = async (u: BotUser) => {
    if (!confirm(`Delete ${u.riyalen_username}?`)) return;
    await supabase.from("bot_users").delete().eq("id", u.id);
    load();
  };
  const saveSettings = async () => {
    const { error } = await supabase.from("app_settings").update({ admin_contact_text: contactText, admin_contact_link: contactLink }).eq("id", 1);
    setSaved(error ? error.message : "Saved");
    setTimeout(() => setSaved(""), 2000);
  };

  const shown = users.filter(
    (u) => (filter === "all" || u.status === filter) && u.riyalen_username.toLowerCase().includes(search.toLowerCase()),
  );
  const count = (s: string) => users.filter((u) => u.status === s).length;

  return (
    <main className="min-h-screen bg-background p-4 pb-16">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Admin Panel</h1>
          <Button variant="outline" size="sm" onClick={() => supabase.auth.signOut()}>Sign out</Button>
        </header>

        <section className="grid grid-cols-4 gap-2">
          {[["Total", users.length], ["Pending", count("pending")], ["Approved", count("approved")], ["Blocked", count("blocked")]].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="font-mono text-2xl font-semibold">{v}</div>
              <div className="text-xs text-muted-foreground">{l}</div>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Search username" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="blocked">Blocked</option>
          </select>
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </section>

        <section className="space-y-2">
          {shown.length === 0 && <p className="text-sm text-muted-foreground">No users.</p>}
          {shown.map((u) => {
            const expired = !!u.expires_at && new Date(u.expires_at) <= new Date();
            return (
              <div key={u.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{u.riyalen_username}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${u.status === "approved" ? "bg-success/15 text-success" : u.status === "blocked" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}>
                    {u.status}{expired ? " · expired" : ""}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>Expires: {u.expires_at ? new Date(u.expires_at).toLocaleDateString() : "never"}</span>
                  <span>Last seen: {u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : "—"}</span>
                  <span>Accepted: {u.accepted_count}</span>
                  <span>Joined: {new Date(u.created_at).toLocaleDateString()}</span>
                </div>
                <Input
                  defaultValue={u.notes}
                  placeholder="Notes"
                  onBlur={(e) => e.target.value !== u.notes && update(u.id, { notes: e.target.value })}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => update(u.id, { status: "approved" })}>Approve</Button>
                  <Button size="sm" variant="secondary" onClick={() => update(u.id, { status: "blocked" })}>Block</Button>
                  <Button size="sm" variant="outline" onClick={() => extend(u, 30)}>+30 days</Button>
                  <Button size="sm" variant="outline" onClick={() => extend(u, 7)}>+7 days</Button>
                  <Button size="sm" variant="outline" onClick={() => update(u.id, { expires_at: null })}>No expiry</Button>
                  <Button size="sm" variant="destructive" onClick={() => del(u)}>Delete</Button>
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Contact settings (shown to users)</h2>
          <div className="space-y-1.5"><Label>Contact text</Label><Input value={contactText} onChange={(e) => setContactText(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Contact link (WhatsApp / Telegram)</Label><Input value={contactLink} placeholder="https://wa.me/966..." onChange={(e) => setContactLink(e.target.value)} /></div>
          <div className="flex items-center gap-3"><Button onClick={saveSettings}>Save</Button><span className="text-xs text-muted-foreground">{saved}</span></div>
        </section>
      </div>
    </main>
  );
}
