/**
 * Branding — each brand's guidelines site and a working board beside it.
 *
 * Daniel, 2026-11-11: "a separate tab in the side menu, not in the dropdown,
 * for branding … each brand in there and its brand.southislandunited.com type
 * page and info where we can work on branding, as branding is different to
 * marketing."
 *
 * The guidelines themselves live on each brand's own hub (apps/*-brand); this
 * tab shows that page and keeps the notes, links and to-do list for the work.
 * Every address below was checked to answer on 11 Nov 2026.
 */
export const BRANDING_TAB = "branding";

export type BrandHub = { key: string; name: string; short: string; hubUrl: string; logo: string | null };

export const BRAND_HUBS: readonly BrandHub[] = [
  { key: "usg", name: "United Sports Group", short: "USG", hubUrl: "https://brand.usg.co.nz", logo: "/logos/united-sports-group-midnight.png" },
  { key: "cufc", name: "Christchurch United", short: "CUFC", hubUrl: "https://brand.cufc.co.nz", logo: "/logos/christchurch-united.png" },
  { key: "siu", name: "South Island United", short: "SIU", hubUrl: "https://brand.southislandunited.com", logo: "/logos/south-island-united.png" },
  { key: "mfl", name: "Mini Football Leagues", short: "MFL", hubUrl: "https://brand.minifootball.co.nz", logo: "/logos/mini-football-leagues-crest.png" },
  { key: "cic", name: "Christchurch International Cup", short: "CIC", hubUrl: "https://brand.cicyouth.com", logo: "/logos/christchurch-international-cup.png" },
  { key: "cic7s", name: "CIC 7's", short: "CIC 7's", hubUrl: "https://brand.cic7s.com", logo: null },
  { key: "ethniccup", name: "Christchurch Ethnic Cup", short: "Ethnic Cup", hubUrl: "https://brand.ethniccup.com", logo: null },
  { key: "cugc", name: "United Gymnastics", short: "CUGC", hubUrl: "https://brand.cugc.co.nz", logo: "/logos/united-gymnastics.png" },
  { key: "prints", name: "United Prints", short: "Prints", hubUrl: "https://brand.unitedprints.co.nz", logo: "/logos/united-prints.png" },
  { key: "usc", name: "United Sports Centre", short: "USC", hubUrl: "https://brand.unitedsportscentre.com", logo: null },
];

export function brandHub(key: unknown): BrandHub | null {
  return BRAND_HUBS.find((b) => b.key === key) ?? null;
}

export type BrandLink = { label: string; url: string };
export type BrandTodo = { id: string; text: string; done: boolean };
export type BrandBoard = { brand: string; notes: string; links: BrandLink[]; todos: BrandTodo[]; updatedAt: string | null; updatedByName: string | null };
export type BrandBoardsResponse = { boards: BrandBoard[] };

/** Rebuild a board from whatever was sent, field by field, so nothing unexpected is stored. */
export function parseBrandBoard(body: any): { notes: string; links: BrandLink[]; todos: BrandTodo[] } | { error: string } {
  const notes = typeof body?.notes === "string" ? body.notes.slice(0, 20_000) : "";
  const links: BrandLink[] = [];
  for (const l of Array.isArray(body?.links) ? body.links.slice(0, 60) : []) {
    const label = typeof l?.label === "string" ? l.label.trim().slice(0, 120) : "";
    const url = typeof l?.url === "string" ? l.url.trim().slice(0, 500) : "";
    if (!url) continue;
    if (!/^https?:\/\/[^\s]+$/i.test(url)) return { error: "A link must start with https://" };
    links.push({ label: label || url.replace(/^https?:\/\//i, "").slice(0, 60), url });
  }
  const todos: BrandTodo[] = [];
  for (const t of Array.isArray(body?.todos) ? body.todos.slice(0, 200) : []) {
    const text = typeof t?.text === "string" ? t.text.trim().slice(0, 300) : "";
    if (!text) continue;
    const id = typeof t?.id === "string" && /^[a-z0-9]{4,24}$/i.test(t.id) ? t.id : Math.random().toString(36).slice(2, 12);
    todos.push({ id, text, done: Boolean(t?.done) });
  }
  return { notes, links, todos };
}
