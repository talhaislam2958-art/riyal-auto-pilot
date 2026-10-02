export type ParsedOrder = { orderNo: string; amount: number | null; method: string };

const ORDER_KEYS = ["order_no", "orderno", "order_sn", "ordersn", "order_id", "orderid", "no", "sn", "id"];
const AMOUNT_KEYS = ["amount", "money", "order_amount", "pay_amount", "price", "total", "sum", "value"];
const METHOD_KEYS = [
  "payment_method", "paymentmethod", "pay_method", "paymethod", "pay_type", "paytype", "method",
  "channel", "pay_channel", "bank_name", "bankname", "bank", "payment", "type",
];

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  const map = new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = map.get(k);
    if (v !== undefined && v !== null && v !== "" && typeof v !== "object") return v;
  }
  return undefined;
}

/** Find the first array of objects in the response. */
function findList(body: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || !body) return [];
  if (Array.isArray(body)) return body.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["data", "list", "orders", "records", "items", "rows", "result"]) {
      if (o[k] !== undefined) {
        const r = findList(o[k], depth + 1);
        if (r.length) return r;
      }
    }
    for (const v of Object.values(o)) {
      const r = findList(v, depth + 1);
      if (r.length) return r;
    }
  }
  return [];
}

export function parseOrders(body: unknown): ParsedOrder[] {
  return findList(body)
    .map((o) => {
      const no = pick(o, ORDER_KEYS);
      const amt = pick(o, AMOUNT_KEYS);
      const m = pick(o, METHOD_KEYS);
      const n = amt === undefined ? NaN : parseFloat(String(amt).replace(/[^0-9.\-]/g, ""));
      return { orderNo: no === undefined ? "" : String(no), amount: Number.isFinite(n) ? n : null, method: m === undefined ? "" : String(m) };
    })
    .filter((o) => o.orderNo);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, "");

export function methodMatches(method: string, selected: string[]): boolean {
  const m = norm(method);
  if (!m) return false;
  return selected.some((s) => {
    const n = norm(s);
    return n && (m.includes(n) || n.includes(m));
  });
}
