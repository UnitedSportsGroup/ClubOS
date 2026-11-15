// Which sessions a holiday camp sells, what they are called, and when they run.
//
// ONE decider for the camp landing page and the booking form, so the two can
// never offer different things. Before this both pages drew Morning /
// Afternoon / Full Day for EVERY camp with fixed 9–12 / 12–3 / 9–3 times and
// a $30/$30/$50 fallback price — while the server (POST /api/public/book)
// silently drops any session that has no camp_pricing row. A camp that sold
// one session would have shown three, and charged for one.
//
// Rules:
//   • A camp WITH camp_pricing rows sells exactly those types, nothing else.
//   • A camp with NO pricing rows keeps the legacy behaviour (all three at the
//     fallback prices) so nothing that exists today changes.
//   • Labels and times come from pageContentJson.sessions[TYPE] when set,
//     e.g. { "MORNING": { "label": "Camp day", "time": "9am – 1pm" } }.

export type CampSessionType = "MORNING" | "AFTERNOON" | "FULL_DAY";

export const CAMP_SESSION_ORDER: CampSessionType[] = ["MORNING", "AFTERNOON", "FULL_DAY"];

const DEFAULTS: Record<CampSessionType, { label: string; time: string; fallbackCents: number }> = {
  MORNING: { label: "Morning", time: "9am – 12pm", fallbackCents: 3000 },
  AFTERNOON: { label: "Afternoon", time: "12pm – 3pm", fallbackCents: 3000 },
  FULL_DAY: { label: "Full Day", time: "9am – 3pm", fallbackCents: 5000 },
};

export interface CampSession {
  type: CampSessionType;
  label: string;
  time: string;
  priceCents: number;
}

export function parsePageContent(raw: unknown): any {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

export function campSessions(
  pricing: { productType: string; priceCents: number }[] | undefined | null,
  pageContent: any,
): CampSession[] {
  const rows = pricing || [];
  const overrides = (pageContent && pageContent.sessions) || {};
  const priced = rows.length > 0;
  return CAMP_SESSION_ORDER
    .filter((t) => !priced || rows.some((r) => r.productType === t))
    .map((t) => {
      const row = rows.find((r) => r.productType === t);
      const o = overrides[t] || {};
      return {
        type: t,
        label: typeof o.label === "string" && o.label ? o.label : DEFAULTS[t].label,
        time: typeof o.time === "string" && o.time ? o.time : DEFAULTS[t].time,
        priceCents: row ? row.priceCents : DEFAULTS[t].fallbackCents,
      };
    });
}
