export type ParsedOrder = {
  orderNo: string;
  amount: number | null;
  amountField: string;
  method: string;
  raw: Record<string, unknown>;
};

const ORDER_KEYS = ["order_no", "orderno", "order_sn", "ordersn", "order_id", "orderid", "no", "sn", "id"];
// Priority order. Fields like fee/commission/profit/bonus/balance are never read.
const AMOUNT_KEYS = ["amount", "total_amount", "order_amount", "price", "money", "fiat_amount", "sar_amount", "quantity"];
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

/** Safely parse an amount like "SAR 1,200.50", "ر.س 500", "$300", 450. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)); // Arabic-Indic digits
  s = s.replace(/SAR|ر\.?\s?س\.?|﷼|\$/gi, "").replace(/[\s,٬]/g, "");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function findAmount(o: Record<string, unknown>): { amount: number | null; field: string } {
  const lower = new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), [k, v] as const]));
  for (const k of AMOUNT_KEYS) {
    const e = lower.get(k);
    if (!e) continue;
    const n = parseAmount(e[1]);
    if (n !== null) return { amount: n, field: e[0] };
  }
  // one level of nesting, e.g. { order: { amount: ... } }
  for (const [pk, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const r = findAmount(v as Record<string, unknown>);
      if (r.amount !== null) return { amount: r.amount, field: `${pk}.${r.field}` };
    }
  }
  return { amount: null, field: "" };
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
      const m = pick(o, METHOD_KEYS);
      const { amount, field } = findAmount(o);
      return { orderNo: no === undefined ? "" : String(no), amount, amountField: field, method: m === undefined ? "" : String(m), raw: o };
    })
    .filter((o) => o.orderNo);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");

/** Map an order's payment method to one of the 4 filter options. */
export function methodCategory(method: string): string {
  const m = norm(method);
  if (m.startsWith("stc")) return "STC Pay";
  if (m.startsWith("barq")) return "Barq";
  if (m.startsWith("urpay")) return "Urpay";
  return "Banks";
}

export function methodMatches(method: string, selected: string[]): boolean {
  return selected.includes(methodCategory(method));
}
