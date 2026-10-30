import type { NextResponse } from "next/server";

// "My orders": the order ids placed from this browser, kept in a cookie. There are no shopper accounts,
// so this is what lets a shopper find an order again after leaving its page.

export const MY_ORDERS_COOKIE = "my_orders";
const MAX = 20;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseMyOrders(cookie: string | undefined): string[] {
  return (cookie ?? "").split(".").filter((id) => ID.test(id)).slice(0, MAX);
}

/** Put an order first in the cookie (newest first, no duplicates, at most 20). */
export function rememberOrder(res: NextResponse, current: string | undefined, orderId: string, secure: boolean): NextResponse {
  if (!ID.test(orderId)) return res;
  const ids = [orderId, ...parseMyOrders(current).filter((id) => id !== orderId)].slice(0, MAX);
  res.cookies.set(MY_ORDERS_COOKIE, ids.join("."), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 90 });
  return res;
}
