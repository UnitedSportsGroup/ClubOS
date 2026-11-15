// Does a holiday camp ask each child's shirt size, and which sizes may they pick?
//
// Zach, 2026-11-04, of the SIU Queenstown camp: "Every camper gets an official
// South Island United shirt … would need to be slightly different asking for
// Childs shirt size with the process as well."
//
// ONE decider for the booking form, the server's check and the Players tab.
//
// 🔴 The list is the club's own supplier sizing (shared/kit-sizes.ts) — the same
// list a player's profile uses — so what a parent picks here is what gets
// ordered, and it lands in the SAME column (`children.shirt_size`) the profile
// shows. NZ/AU kids clothing is sized by AGE, and the number in brackets is the
// child's HEIGHT in cm (8 (130) = about age 8, up to 130 cm), which is the
// fair way for a parent to choose; adults are XS–4XL. Never US/EU sizing.
//
// 🔴 Per camp, OFF unless the camp says so: pageContentJson.shirtSize.ask = true.
// When on it is REQUIRED for every child (we cannot hand a camper a shirt in
// "unknown"), checked by the server before any contact, child or payment exists.

import { GARMENT_SIZES } from "./kit-sizes";

export const CAMP_SHIRT_SIZES: readonly string[] = GARMENT_SIZES;

/** What a parent reads in the dropdown. The stored value is the raw list value. */
export function shirtSizeLabel(v: string): string {
  const m = /^(\d+) \((\d+)\)$/.exec(v);
  if (m) return `Kids ${m[1]} (up to ${m[2]} cm)`;
  return `Adult ${v}`;
}

export interface CampShirtSizeSetting {
  ask: boolean;
  /** Shown under the field, e.g. what the shirt is. */
  note: string | null;
}

export function campShirtSize(pageContent: any): CampShirtSizeSetting {
  const s = pageContent && typeof pageContent === "object" ? pageContent.shirtSize : null;
  return {
    ask: !!(s && s.ask === true),
    note: s && typeof s.note === "string" && s.note.trim() ? s.note.trim() : null,
  };
}

/** null = fine; otherwise the message to show. */
export function shirtSizeError(value: unknown): string | null {
  const t = String(value ?? "").trim();
  if (!t) return "Please choose a shirt size for each child.";
  if (!CAMP_SHIRT_SIZES.includes(t)) return `"${t}" isn't one of our shirt sizes.`;
  return null;
}

/** pageContentJson arrives as jsonb (object) or a JSON string. */
export function campPageContentOf(raw: unknown): any {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}
