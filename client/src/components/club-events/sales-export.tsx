// Club Events — "Export sales": every PAID order (and its seats) in the format
// the team needs to share. Built entirely from the detail payload the page
// already holds, so the export can never disagree with what is on screen.
//
// Only paid / refunded orders are sales. Pending and cancelled orders are
// checkout scaffolding and never appear (the "if you ain't paid" rule).
import type { ClubEvent } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer } from "lucide-react";

export interface ExportOrder {
  id: number; ref: string; status: string; quantity: number;
  unitPriceCents: number; totalCents: number; paidCents: number | null; paidAt: string | null;
  refundedCents: number; buyerName: string; buyerEmail: string; buyerPhone: string | null;
  paymentMethod: string | null; paymentReference: string | null; servedBy: string | null;
  tableName: string | null; buyerNotes: string | null; staffNotes: string | null;
  source: string | null; ticketTypeName: string; createdAt: string;
}
export interface ExportGuest {
  orderId: number; seatNo: number; fullName: string | null; dietary: string | null; checkedInAt: string | null;
}

const TENDER: Record<string, string> = {
  online_card: "Card online", eftpos: "EFTPOS", cash: "Cash", bank_transfer: "Bank transfer", other: "Other",
};
const isSale = (o: ExportOrder) => o.status === "paid" || o.status === "refunded";
const money = (c: number) => (c / 100).toFixed(2);
const dollarsFmt = (c: number) => "$" + (c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nzWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const paidOf = (o: ExportOrder) => (o.paidCents ?? o.totalCents) - (o.refundedCents ?? 0);

function rowsFor(orders: ExportOrder[], guests: ExportGuest[]) {
  const sales = orders.filter(isSale).sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
  const byOrder = new Map(sales.map((o) => [o.id, o]));
  const orderRows = sales.map((o, i) => ({
    "#": i + 1,
    Ref: o.ref,
    Buyer: clean(o.buyerName),
    Email: clean(o.buyerEmail),
    Phone: clean(o.buyerPhone),
    Ticket: o.ticketTypeName,
    Seats: o.quantity,
    "Price each ($)": Number(money(o.unitPriceCents)),
    "Paid ($)": Number(money(o.paidCents ?? o.totalCents)),
    "Refunded ($)": Number(money(o.refundedCents ?? 0)),
    Status: o.status === "refunded" ? "Refunded" : "Paid",
    "Paid by": TENDER[o.paymentMethod ?? ""] ?? (o.paymentMethod ?? ""),
    "Payment ref": clean(o.paymentReference),
    "Paid on (NZ)": nzWhen(o.paidAt),
    "Sit with / table": clean(o.tableName),
    "Buyer notes": clean(o.buyerNotes),
    "Staff notes": clean(o.staffNotes),
    "Sold by": clean(o.servedBy) || (o.paymentMethod === "online_card" ? "Online" : ""),
  }));
  const guestRows = guests
    .filter((g) => byOrder.has(g.orderId))
    .sort((a, b) => {
      const oa = byOrder.get(a.orderId)!, ob = byOrder.get(b.orderId)!;
      return (oa.paidAt ?? oa.createdAt).localeCompare(ob.paidAt ?? ob.createdAt) || a.seatNo - b.seatNo;
    })
    .map((g) => {
      const o = byOrder.get(g.orderId)!;
      return {
        Ref: o.ref,
        "Booked by": clean(o.buyerName),
        Seat: g.seatNo,
        "Guest name": clean(g.fullName) || "Name not given yet",
        Dietary: clean(g.dietary),
        "Sit with / table": clean(o.tableName),
        "Buyer email": clean(o.buyerEmail),
        "Buyer phone": clean(o.buyerPhone),
        "Checked in": g.checkedInAt ? nzWhen(g.checkedInAt) : "",
      };
    });
  const summary = {
    orders: sales.length,
    seats: sales.reduce((a, o) => a + o.quantity, 0),
    takenCents: sales.reduce((a, o) => a + paidOf(o), 0),
    named: guestRows.filter((g) => g["Guest name"] !== "Name not given yet").length,
    dietary: guestRows.filter((g) => g.Dietary).length,
    byTicket: Object.values(sales.reduce<Record<string, { ticket: string; orders: number; seats: number; cents: number }>>((acc, o) => {
      const k = o.ticketTypeName;
      acc[k] ??= { ticket: k, orders: 0, seats: 0, cents: 0 };
      acc[k].orders++; acc[k].seats += o.quantity; acc[k].cents += paidOf(o);
      return acc;
    }, {})),
  };
  return { orderRows, guestRows, summary };
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    // Leading = + - @ would run as a formula when the file is opened in Excel.
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}

function save(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function reportHtml(event: ClubEvent, data: ReturnType<typeof rowsFor>) {
  const { orderRows, guestRows, summary } = data;
  const when = new Date(event.startsAt as unknown as string).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "full", timeStyle: "short" });
  const asAt = new Date().toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "full", timeStyle: "short" });
  const orderTr = orderRows.map((r) => `<tr><td>${r["#"]}</td><td class=m>${esc(r.Ref)}</td><td><b>${esc(r.Buyer)}</b></td><td>${esc(r.Email)}</td><td class=m>${esc(r.Phone)}</td><td>${esc(r.Ticket)}</td><td class=r>${r.Seats}</td><td class=r>$${r["Price each ($)"].toFixed(2)}</td><td class=r><b>$${r["Paid ($)"].toFixed(2)}</b>${r["Refunded ($)"] ? `<br><span class=mute>refunded $${r["Refunded ($)"].toFixed(2)}</span>` : ""}</td><td>${esc(r["Paid by"])}</td><td>${esc(r["Paid on (NZ)"])}</td><td>${esc(r["Sit with / table"])}</td><td>${esc(r["Buyer notes"])}</td></tr>`).join("");
  let last = "";
  const guestTr = guestRows.map((g) => {
    const head = g.Ref !== last ? `<tr class=grp><td colspan=4><b>${esc(g["Booked by"])}</b> · ${esc(g.Ref)}${g["Sit with / table"] ? " · sit with: " + esc(g["Sit with / table"]) : ""}</td></tr>` : "";
    last = g.Ref;
    const named = g["Guest name"] !== "Name not given yet";
    return head + `<tr><td class=r>${g.Seat}</td><td>${named ? esc(g["Guest name"]) : '<span class=mute>Name not given yet</span>'}</td><td>${esc(g.Dietary) || '<span class=mute>—</span>'}</td><td>${esc(g["Checked in"])}</td></tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset=utf-8><title>${esc(event.name)} — ticket sales</title><style>
@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:9.5px/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#161616;margin:16px}
@media print{body{margin:0}.noprint{display:none}}
h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;margin:18px 0 6px;border-bottom:1.5px solid #C59949;padding-bottom:3px}
.sub{color:#666;margin-bottom:10px}.k{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}.k div{border:1px solid #ddd;border-radius:6px;padding:8px 12px;min-width:120px}.k b{display:block;font-size:17px}
table{width:100%;border-collapse:collapse}th{text-align:left;background:#161616;color:#fff;padding:4px 5px;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact}td{padding:3.5px 5px;border-bottom:1px solid #e6e6e6;vertical-align:top}
.r{text-align:right}.m{font-family:Menlo,monospace;font-size:8.5px}.mute{color:#999}
tr.grp td{background:#f3ede2;border-top:1.5px solid #C59949;-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{display:table-header-group}tr{page-break-inside:avoid}
.noprint{background:#fff8e6;border:1px solid #e9d39b;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:12px}</style></head><body>
<div class=noprint>Choose <b>Save as PDF</b> as the destination in the print window. Close this tab when done.</div>
<h1>${esc(event.name)} — ticket sales</h1>
<div class=sub>${esc(when)}${event.venueName ? " · " + esc(event.venueName) : ""} · Paid orders only, as at ${esc(asAt)}. Unpaid checkouts are not included.</div>
<div class=k><div>Seats sold<b>${summary.seats}</b></div><div>Orders<b>${summary.orders}</b></div><div>Money taken<b>${dollarsFmt(summary.takenCents)}</b></div><div>Guests named<b>${summary.named} of ${summary.seats}</b></div><div>Dietary notes<b>${summary.dietary}</b></div></div>
<table style="width:auto"><thead><tr><th>Ticket</th><th class=r>Orders</th><th class=r>Seats</th><th class=r>Taken</th></tr></thead><tbody>${summary.byTicket.map((b) => `<tr><td>${esc(b.ticket)}</td><td class=r>${b.orders}</td><td class=r>${b.seats}</td><td class=r>${dollarsFmt(b.cents)}</td></tr>`).join("")}<tr><td><b>Total</b></td><td class=r><b>${summary.orders}</b></td><td class=r><b>${summary.seats}</b></td><td class=r><b>${dollarsFmt(summary.takenCents)}</b></td></tr></tbody></table>
<h2>Orders</h2>
<table><thead><tr><th>#</th><th>Ref</th><th>Buyer</th><th>Email</th><th>Phone</th><th>Ticket</th><th class=r>Seats</th><th class=r>Each</th><th class=r>Paid</th><th>Paid by</th><th>Paid on</th><th>Sit with / table</th><th>Notes</th></tr></thead><tbody>${orderTr || '<tr><td colspan=13 class=mute>No paid orders yet.</td></tr>'}</tbody></table>
<h2 style="page-break-before:always">Guest list — every seat, by order</h2>
<table><thead><tr><th class=r style="width:40px">Seat</th><th>Guest name</th><th>Dietary</th><th style="width:110px">Checked in</th></tr></thead><tbody>${guestTr || '<tr><td colspan=4 class=mute>No seats sold yet.</td></tr>'}</tbody></table>
</body></html>`;
}

export function SalesExportMenu({ event, orders, guests, onError }: {
  event: ClubEvent; orders: ExportOrder[]; guests: ExportGuest[]; onError: (msg: string) => void;
}) {
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const base = `${event.slug}-sales-${stamp}`;

  const exportXlsx = async () => {
    try {
      const XLSX = await import("xlsx");
      const d = rowsFor(orders, guests);
      const wb = XLSX.utils.book_new();
      const summary = [
        { Item: "Event", Value: event.name },
        { Item: "Seats sold", Value: d.summary.seats },
        { Item: "Orders", Value: d.summary.orders },
        { Item: "Money taken ($)", Value: Number(money(d.summary.takenCents)) },
        { Item: "Guests named", Value: `${d.summary.named} of ${d.summary.seats}` },
        { Item: "Exported (NZ)", Value: nzWhen(new Date().toISOString()) },
        { Item: "", Value: "" },
        ...d.summary.byTicket.map((b) => ({ Item: `${b.ticket}: ${b.orders} orders, ${b.seats} seats`, Value: Number(money(b.cents)) })),
      ];
      const add = (rows: Record<string, unknown>[], name: string) => {
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "Nothing yet" }]);
        const cols = Object.keys(rows[0] ?? { Note: "" });
        ws["!cols"] = cols.map((c) => ({ wch: Math.min(40, Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)) + 2) }));
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      add(summary, "Summary");
      add(d.orderRows, "Orders");
      add(d.guestRows, "Guest list");
      const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      save(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${base}.xlsx`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportCsv = (which: "orders" | "guests") => {
    const d = rowsFor(orders, guests);
    const csv = toCsv(which === "orders" ? d.orderRows : d.guestRows);
    save(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${base}-${which === "orders" ? "orders" : "guest-list"}.csv`);
  };

  const exportPdf = () => {
    const w = window.open("", "_blank");
    if (!w) { onError("Your browser blocked the new tab. Allow pop-ups for app.usg.co.nz and try again."); return; }
    w.document.open();
    w.document.write(reportHtml(event, rowsFor(orders, guests)));
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* the page still has the instructions */ } }, 400);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-h-11 gap-2" data-testid="button-export-sales">
          <Download className="w-4 h-4" /> Export sales <ChevronDown className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-slate-500 font-normal">Paid orders only — names, contacts, what they paid, every seat</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportXlsx} className="min-h-10 gap-2" data-testid="export-xlsx">
          <FileSpreadsheet className="w-4 h-4" /> Excel (.xlsx) — summary, orders, guests
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPdf} className="min-h-10 gap-2" data-testid="export-pdf">
          <Printer className="w-4 h-4" /> PDF — print-ready report
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportCsv("orders")} className="min-h-10 gap-2" data-testid="export-csv-orders">
          <FileText className="w-4 h-4" /> CSV — orders
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportCsv("guests")} className="min-h-10 gap-2" data-testid="export-csv-guests">
          <FileText className="w-4 h-4" /> CSV — guest list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
