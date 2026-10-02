// Exact field mapping for the real upstream order object.
export type ParsedOrder = {
  orderNo: string;          // order_no — used for accept
  amount: number | null;    // amount_sar only
  payType: string;          // pay_type, raw
  option: string;           // mapped filter option: STC Pay | Barq | Urpay | Banks
  createdAt: string;        // created_at, display only
  available: boolean;       // merchant_status === "available"
  locked: boolean;          // small_duty_locked
  lockMessage: string;      // small_duty_message
  raw: Record<string, unknown>;
};

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

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");

/** Map pay_type to one of the 4 filter options. */
export function methodCategory(payType: string): string {
  const m = norm(payType);
  if (m.startsWith("stc")) return "STC Pay";
  if (m.includes("barq")) return "Barq";
  if (m.includes("urpay")) return "Urpay";
  return "Banks";
}

export function methodMatches(payType: string, selected: string[]): boolean {
  return selected.includes(methodCategory(payType));
}

export function parseOrders(body: unknown): ParsedOrder[] {
  return findList(body)
    .map((o) => {
      const orderNo = o["order_no"] === undefined || o["order_no"] === null ? "" : String(o["order_no"]);
      const n = Number(o["amount_sar"]);
      const amount = Number.isFinite(n) && o["amount_sar"] !== null && o["amount_sar"] !== undefined && o["amount_sar"] !== "" ? n : null;
      const payType = o["pay_type"] === undefined || o["pay_type"] === null ? "" : String(o["pay_type"]);
      return {
        orderNo,
        amount,
        payType,
        option: methodCategory(payType),
        createdAt: o["created_at"] === undefined || o["created_at"] === null ? "" : String(o["created_at"]),
        available: o["merchant_status"] === "available",
        locked: o["small_duty_locked"] === true,
        lockMessage: typeof o["small_duty_message"] === "string" ? o["small_duty_message"] : "",
        raw: o,
      };
    })
    .filter((o) => o.orderNo);
}
