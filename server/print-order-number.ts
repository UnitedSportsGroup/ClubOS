// The ONE place a United Prints order number is decided.
//
// Every path used to write `UP-{year}-{count + 1}`. That is only correct while
// no order has ever been deleted: on 2026-10-07 the board held 10 orders whose
// numbers ran to UP-2026-0012, so "count + 1" produced UP-2026-0011 — a number
// already taken — and `print_orders_order_number_key` refused every new order.
// Dima saw it as "Couldn't move this quote to an order" on an edited quote; it
// had nothing to do with the edit.
//
// The next number is therefore read from the numbers actually USED, never from
// how many rows exist. The unique key is global (not per organisation), so the
// maximum is taken across every row carrying this year's prefix.
import { sql } from "drizzle-orm";
import { db } from "./db";

type Executor = { execute: (q: any) => Promise<any> };

export function printOrderPrefix(year = new Date().getFullYear()): string {
  return `UP-${year}-`;
}

export function formatPrintOrderNumber(year: number, seq: number): string {
  return `${printOrderPrefix(year)}${String(seq).padStart(4, "0")}`;
}

/** Highest sequence used for the year's prefix, parsed from strings like "UP-2026-0012". */
export function maxSequence(numbers: Array<string | null | undefined>, year: number): number {
  const prefix = printOrderPrefix(year);
  let max = 0;
  for (const n of numbers) {
    if (!n || !n.startsWith(prefix)) continue;
    const seq = Number(n.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return max;
}

export async function nextPrintOrderNumber(exec: Executor = db, year = new Date().getFullYear()): Promise<string> {
  const prefix = printOrderPrefix(year);
  const res = await exec.execute(sql`SELECT order_number FROM print_orders WHERE order_number LIKE ${prefix + "%"}`);
  // db.execute returns the DRIVER's shape — an object with .rows, not an array.
  const rows: any[] = Array.isArray(res) ? res : (res?.rows ?? []);
  return formatPrintOrderNumber(year, maxSequence(rows.map((r) => r.order_number), year) + 1);
}
