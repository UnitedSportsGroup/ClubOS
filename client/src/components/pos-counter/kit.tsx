// Pieces shared by the counter reader's customer screens and its till.
import { useState } from "react";

export const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
export const $whole = (c: number) => (c % 100 === 0 ? `$${c / 100}` : $(c));

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "include", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data?.message || `HTTP ${res.status}`), { status: res.status, data });
  return data as T;
}

/** Our own keyboard: the same on every reader, no reliance on Android's. */
export function Keyboard({ value, onChange, mode = "email", max = 120, autoCap = false }: { value: string; onChange: (v: string) => void; mode?: "email" | "text"; max?: number; autoCap?: boolean }) {
  const [shiftTap, setShift] = useState(false);
  // A name starts with a capital, and so does each part of it ("Taylor-Brown", "Mere Anne").
  const shift = shiftTap || (autoCap && (value === "" || /[\s-]$/.test(value)));
  const [nums, setNums] = useState(false);
  const rows = nums
    ? [["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], ["-", "_", ".", "+", "'", "!", "#", "$", "%", "&"], ["*", "/", "=", "?", "^", "{", "}", "|", "~"]]
    : [["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], ["a", "s", "d", "f", "g", "h", "j", "k", "l"], ["z", "x", "c", "v", "b", "n", "m"]];
  const add = (k: string) => { if (value.length < max) onChange(value + (shift ? k.toUpperCase() : k)); if (shift) setShift(false); };
  const key = "flex h-12 flex-1 items-center justify-center rounded-lg bg-white/[0.12] text-[18px] font-medium active:bg-white/30";
  return (
    <div className="space-y-1.5 px-1.5">
      {rows.map((r, ri) => (
        <div key={ri} className="flex gap-1">
          {ri === 2 && !nums && <button onClick={() => setShift((s) => !s)} className={`${key} max-w-[44px] ${shift ? "bg-white text-black" : ""}`}>⇧</button>}
          {r.map((k) => <button key={k} onClick={() => add(k)} className={key}>{shift ? k.toUpperCase() : k}</button>)}
          {ri === 2 && <button onClick={() => onChange(value.slice(0, -1))} className={`${key} max-w-[52px]`} aria-label="Delete">⌫</button>}
        </div>
      ))}
      {mode === "text" ? (
        <div className="flex gap-1">
          <button onClick={() => setNums((n) => !n)} className={`${key} max-w-[60px] text-[14px]`}>{nums ? "abc" : "123"}</button>
          <button onClick={() => add(" ")} className={`${key} text-[13px] text-white/60`}>space</button>
          <button onClick={() => add("-")} className={`${key} max-w-[44px]`}>-</button>
          <button onClick={() => add("'")} className={`${key} max-w-[44px]`}>'</button>
        </div>
      ) : (
      <div className="flex gap-1">
        <button onClick={() => setNums((n) => !n)} className={`${key} max-w-[60px] text-[14px]`}>{nums ? "abc" : "123"}</button>
        <button onClick={() => add("@")} className={`${key} max-w-[52px]`}>@</button>
        <button onClick={() => add(".")} className={`${key} max-w-[44px]`}>.</button>
        <button onClick={() => onChange(value + "gmail.com")} className={`${key} text-[13px]`}>gmail.com</button>
        <button onClick={() => onChange(value + ".co.nz")} className={`${key} text-[13px]`}>.co.nz</button>
        <button onClick={() => onChange(value + ".com")} className={`${key} max-w-[56px] text-[13px]`}>.com</button>
      </div>
      )}
    </div>
  );
}

/** Digits only: a PIN, a phone number, a date. */
export function NumPad({ value, onChange, max = 12, extra }: { value: string; onChange: (v: string) => void; max?: number; extra?: { label: string; onPress: () => void } }) {
  const key = "flex h-14 items-center justify-center rounded-xl bg-white/[0.12] text-[22px] font-semibold active:bg-white/30";
  const add = (d: string) => { if (value.length < max) onChange(value + d); };
  return (
    <div className="grid grid-cols-3 gap-1.5 px-3">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} onClick={() => add(d)} className={key}>{d}</button>)}
      {extra ? <button onClick={extra.onPress} className={`${key} text-[14px] font-medium text-white/70`}>{extra.label}</button> : <div />}
      <button onClick={() => add("0")} className={key}>0</button>
      <button onClick={() => onChange(value.slice(0, -1))} className={`${key} text-[20px]`} aria-label="Delete">⌫</button>
    </div>
  );
}
