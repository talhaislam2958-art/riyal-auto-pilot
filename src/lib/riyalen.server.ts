const BASE = "https://customer.riyalen.com";
const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "*/*",
  Origin: "https://customer.riyalen.com",
  Referer: "https://customer.riyalen.com/home.html",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
};

export type Upstream = { status: number; body: unknown };

export async function upstream(path: string, init?: { method?: string; json?: unknown }): Promise<Upstream> {
  const res = await fetch(BASE + path, {
    method: init?.method ?? "GET",
    headers: HEADERS,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

/** Depth-first search for the first value whose key matches one of the names. */
export function findKey(obj: unknown, names: string[], depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 5) return undefined;
  const lower = names.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (lower.includes(k.toLowerCase()) && (typeof v === "string" || typeof v === "number")) return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = findKey(v, names, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

export function isAuthError(r: Upstream): boolean {
  if (r.status === 401 || r.status === 403) return true;
  const b = r.body as Record<string, unknown> | null;
  if (b && typeof b === "object") {
    const code = b.code ?? b.status;
    if (code === 401 || code === "401") return true;
    const msg = String(b.msg ?? b.message ?? b.error ?? "");
    if (/token|unauthor|login|expired|未登录/i.test(msg) && b.success !== true) return true;
  }
  return false;
}

export function isSuccess(r: Upstream): boolean {
  if (r.status < 200 || r.status >= 300) return false;
  const b = r.body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return true;
  if (b.success === false || b.ok === false) return false;
  if (b.code !== undefined && ![0, 1, 200, "0", "1", "200"].includes(b.code as never)) return false;
  return true;
}

export function upstreamMessage(r: Upstream): string {
  const b = r.body as Record<string, unknown> | null;
  if (b && typeof b === "object") return String(b.msg ?? b.message ?? b.error ?? `HTTP ${r.status}`);
  return `HTTP ${r.status}`;
}

/** Resolve the username that owns a token via the upstream profile API. */
export async function usernameFromToken(token: string): Promise<{ username?: string; authError?: boolean }> {
  const r = await upstream("/api/merchant/profile", { method: "POST", json: { token } });
  if (isAuthError(r) || !isSuccess(r)) return { authError: true };
  const u = findKey(r.body, ["username", "user_name", "account", "login", "merchant_name", "name"]);
  if (u === undefined || String(u).trim() === "") return { authError: true };
  return { username: String(u).trim().toLowerCase() };
}

export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("hit_rate_limit", {
    _key: key,
    _max: max,
    _window_seconds: windowSeconds,
  });
  if (error) return true;
  return data === true;
}

export async function hashKey(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
