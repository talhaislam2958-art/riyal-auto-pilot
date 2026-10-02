import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  findKey,
  hashKey,
  isAuthError,
  isSuccess,
  rateLimit,
  upstream,
  upstreamMessage,
  usernameFromToken,
} from "./riyalen.server";

const tokenSchema = z.object({ token: z.string().min(1).max(2000) });

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ip = getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? "unknown";
    if (!(await rateLimit(`login:${await hashKey(ip)}`, 10, 300))) {
      return { ok: false as const, error: "Too many login attempts. Try again in a few minutes." };
    }
    try {
      const r = await upstream("/api/merchant/login", {
        method: "POST",
        json: { username: data.username, password: data.password },
      });
      const token = findKey(r.body, ["token", "access_token", "accessToken"]);
      if (!isSuccess(r) || !token) return { ok: false as const, error: upstreamMessage(r) || "Login failed" };
      const prof = await usernameFromToken(String(token));
      const username = prof.username ?? data.username.toLowerCase();
      const db = await admin();
      await db
        .from("bot_users")
        .upsert({ riyalen_username: username }, { onConflict: "riyalen_username", ignoreDuplicates: true });
      await db.from("bot_users").update({ last_seen_at: new Date().toISOString() }).eq("riyalen_username", username);
      return { ok: true as const, token: String(token), username };
    } catch {
      return { ok: false as const, error: "Could not reach the server. Try again." };
    }
  });

export const statusFn = createServerFn({ method: "POST" })
  .inputValidator((d) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: settings } = await db
      .from("app_settings")
      .select("admin_contact_text, admin_contact_link")
      .eq("id", 1)
      .maybeSingle();
    let prof;
    try {
      prof = await usernameFromToken(data.token);
    } catch {
      return { authError: false, networkError: true, settings };
    }
    if (prof.authError || !prof.username) return { authError: true, settings };
    const { data: row } = await db
      .from("bot_users")
      .select("status, expires_at")
      .eq("riyalen_username", prof.username)
      .maybeSingle();
    if (!row) {
      await db.from("bot_users").insert({ riyalen_username: prof.username });
    }
    await db.from("bot_users").update({ last_seen_at: new Date().toISOString() }).eq("riyalen_username", prof.username);
    const status = row?.status ?? "pending";
    const expired = !!row?.expires_at && new Date(row.expires_at) <= new Date();
    return {
      authError: false,
      username: prof.username,
      status,
      expires_at: row?.expires_at ?? null,
      expired,
      active: status === "approved" && !expired,
      settings,
    };
  });

export const announcementFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const r = await upstream(`/api/merchant/announcement?t=${Date.now()}`);
    return { ok: true, body: JSON.stringify(r.body) };
  } catch {
    return { ok: false, body: "null" };
  }
});

export const ordersFn = createServerFn({ method: "POST" })
  .inputValidator((d) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const r = await upstream(
        `/api/merchant/orders/fast?limit=20&token=${encodeURIComponent(data.token)}&t=${Date.now()}`,
      );
      return { status: r.status, authError: isAuthError(r), body: JSON.stringify(r.body) };
    } catch {
      return { status: 0, authError: false, body: "null", networkError: true };
    }
  });

export const acceptFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ token: z.string().min(1).max(2000), order_no: z.string().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const prof = await usernameFromToken(data.token);
      if (prof.authError || !prof.username) return { ok: false, error: "auth_error", authError: true };
      const username = prof.username;
      if (!(await rateLimit(`accept:${username}`, 30, 60))) return { ok: false, error: "rate_limited" };

      const db = await admin();
      const { data: row } = await db
        .from("bot_users")
        .select("status, expires_at")
        .eq("riyalen_username", username)
        .maybeSingle();
      const approved =
        row?.status === "approved" && (!row.expires_at || new Date(row.expires_at) > new Date());
      if (!approved) return { ok: false, error: "not_approved", status: 403 };

      const r = await upstream("/api/merchant/orders/accept", {
        method: "POST",
        json: { token: data.token, order_no: data.order_no },
      });
      if (isAuthError(r)) return { ok: false, error: "auth_error", authError: true };
      if (!isSuccess(r)) return { ok: false, error: upstreamMessage(r) };
      await db.rpc("increment_accepted", { _username: username });
      return { ok: true };
    } catch {
      return { ok: false, error: "network_error" };
    }
  });

export const withdrawHistoryFn = createServerFn({ method: "POST" })
  .inputValidator((d) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const r = await upstream("/api/merchant/withdraw-history", { method: "POST", json: { token: data.token } });
      return { authError: isAuthError(r), body: JSON.stringify(r.body) };
    } catch {
      return { authError: false, body: "null" };
    }
  });
