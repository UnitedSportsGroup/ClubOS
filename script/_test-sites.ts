/**
 * ClubOS Websites — the pure rules, checked. No database, no network.
 *   npx tsx script/_test-sites.ts
 *
 * Permission levels · the workspace decider · publish now / schedule /
 * backdate · what the public may read · the body round trip on EVERY article
 * cufc.co.nz carries in code today.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  siteCan, siteCanEditArticle, siteCanGrant, siteBrandFilter, siteBrandAllowed, articleIsPublic, checkPublishIntent,
  blocksToMarkdown, markdownToBlocks, checkBody, nzToday, slugify, primaryTag, nzLocalToInstant, nzTimeOf, type SiteViewer, type BodyBlock,
} from "../shared/sites";

let pass = 0; const fails: string[] = [];
const t = (label: string, cond: boolean) => { if (cond) pass++; else { fails.push(label); console.log(`  ✗ ${label}`); } };

// ── Levels ───────────────────────────────────────────────────────────────────
const nobody: SiteViewer = { isSuperAdmin: false, level: null };
const writer: SiteViewer = { isSuperAdmin: false, level: "writer" };
const editor: SiteViewer = { isSuperAdmin: false, level: "editor" };
const manager: SiteViewer = { isSuperAdmin: false, level: "manager" };
const approver: SiteViewer = { isSuperAdmin: false, level: "approver" };
const superAdmin: SiteViewer = { isSuperAdmin: true, level: null };

t("no grant: cannot even view", !siteCan(nobody, "view"));
t("no grant: cannot write", !siteCan(nobody, "write"));
t("writer: views, writes, submits, uses Rambo", siteCan(writer, "view") && siteCan(writer, "write") && siteCan(writer, "submit") && siteCan(writer, "rambo"));
t("writer: cannot publish", !siteCan(writer, "publish"));
t("writer: cannot revert", !siteCan(writer, "revert"));
t("writer: edits a draft", siteCanEditArticle(writer, "draft"));
t("writer: cannot touch a published article", !siteCanEditArticle(writer, "published"));
t("writer: cannot touch a scheduled article", !siteCanEditArticle(writer, "scheduled"));
t("writer: cannot touch an unpublished article", !siteCanEditArticle(writer, "unpublished"));
t("editor: publishes, reverts, deletes drafts", siteCan(editor, "publish") && siteCan(editor, "revert") && siteCan(editor, "delete-draft"));
t("editor: edits a published article", siteCanEditArticle(editor, "published"));
t("editor: cannot manage people", !siteCan(editor, "manage-people"));
t("manager: publishes", siteCan(manager, "publish"));
t("manager: cannot manage people (approver + super admin only)", !siteCan(manager, "manage-people"));
t("approver: manages people", siteCan(approver, "manage-people"));
t("approver: grants writer/editor/manager", siteCanGrant(approver, "writer") && siteCanGrant(approver, "editor") && siteCanGrant(approver, "manager"));
t("approver: cannot grant approver", !siteCanGrant(approver, "approver"));
t("super admin: everything, with no grant at all", (["view", "write", "publish", "revert", "manage-people", "grant-approver"] as const).every((a) => siteCan(superAdmin, a)));
t("super admin: grants approver", siteCanGrant(superAdmin, "approver"));

// ── Where the tab shows what ────────────────────────────────────────────────
t("CUFC workspace shows cufc only", JSON.stringify(siteBrandFilter("christchurch-united")) === '["cufc"]');
t("USG shows every site", siteBrandFilter("united-sports-group") === null);
t("any other workspace shows nothing (fail closed)", JSON.stringify(siteBrandFilter("united-prints")) === "[]");
t("no header shows nothing", JSON.stringify(siteBrandFilter(undefined)) === "[]");
t("cufc allowed in CUFC", siteBrandAllowed(["cufc"], "cufc"));
t("mfl not allowed in CUFC", !siteBrandAllowed(["cufc"], "mfl"));
t("anything allowed in USG", siteBrandAllowed(null, "mfl"));

// ── Public visibility ───────────────────────────────────────────────────────
const now = new Date("2026-11-01T02:00:00Z"); // 3pm NZ
t("published, no time: public", articleIsPublic({ status: "published", publish_at: null }, now));
t("published, time passed: public", articleIsPublic({ status: "published", publish_at: "2026-11-01T01:00:00Z" }, now));
t("published, time not yet: NOT public", !articleIsPublic({ status: "published", publish_at: "2026-11-01T03:00:00Z" }, now));
t("scheduled: never public by itself", !articleIsPublic({ status: "scheduled", publish_at: "2026-10-01T00:00:00Z" }, now));
t("draft: not public", !articleIsPublic({ status: "draft" }, now));
t("unpublished: not public", !articleIsPublic({ status: "unpublished", publish_at: null }, now));

// ── Publish now / schedule / backdate ───────────────────────────────────────
t("NZ today is the NZ date, not UTC", nzToday(new Date("2026-11-01T12:30:00Z")) === "2026-11-02");
t("publish now dated today: ok", checkPublishIntent({ kind: "now", displayDate: "2026-11-01" }, now) === null);
t("backdate (publish now, dated 2016): ok", checkPublishIntent({ kind: "now", displayDate: "2016-08-27" }, now) === null);
t("publish now dated tomorrow: refused", checkPublishIntent({ kind: "now", displayDate: "2026-11-02" }, now) !== null);
t("publish now with no date: refused", checkPublishIntent({ kind: "now", displayDate: "" }, now) !== null);
t("schedule tomorrow 9am NZ, dated tomorrow: ok", checkPublishIntent({ kind: "schedule", publishAt: "2026-11-01T20:00:00Z", displayDate: "2026-11-02" }, now) === null);
t("schedule in the past: refused", checkPublishIntent({ kind: "schedule", publishAt: "2026-11-01T01:00:00Z", displayDate: "2026-11-01" }, now) !== null);
t("schedule dated after it goes out: refused", checkPublishIntent({ kind: "schedule", publishAt: "2026-11-01T20:00:00Z", displayDate: "2026-11-05" }, now) !== null);
t("schedule backdated: ok", checkPublishIntent({ kind: "schedule", publishAt: "2026-11-01T20:00:00Z", displayDate: "2026-10-20" }, now) === null);
t("schedule with a nonsense time: refused", checkPublishIntent({ kind: "schedule", publishAt: "soon", displayDate: "2026-11-02" }, now) !== null);
t("unpublish needs nothing", checkPublishIntent({ kind: "unpublish" }, now) === null);

t("9am NZ in summer (NZDT, +13) is 20:00 UTC the day before", nzLocalToInstant("2026-11-08", "09:00")?.toISOString() === "2026-11-07T20:00:00.000Z");
t("9am NZ in winter (NZST, +12) is 21:00 UTC the day before", nzLocalToInstant("2026-07-08", "09:00")?.toISOString() === "2026-07-07T21:00:00.000Z");
t("NZ wall clock reads back", nzTimeOf(new Date("2026-11-07T20:00:00Z")) === "09:00");
t("a nonsense time is refused", nzLocalToInstant("2026-11-08", "9am") === null);

// ── The body ────────────────────────────────────────────────────────────────
const sample: BodyBlock[] = [
  "First paragraph — with an en dash, 'quotes' and a [bracket].",
  { image: "/img/a b.jpg", alt: "Players [U14] celebrate", caption: 'The "winner" goes in' },
  { image: "https://app.usg.co.nz/mailer/cufc/lib/x.jpg" },
  { video: "https://www.youtube.com/embed/DsS4X3Aww70" },
  { file: "/files/news-history/report (1).pdf", label: "Annual report [2015]" },
  "- a line that looks like a bullet stays a paragraph",
];
const rt = markdownToBlocks(blocksToMarkdown(sample));
t("round trip: a hand-built sample with every block kind", JSON.stringify(rt) === JSON.stringify(sample));
t("a single line break inside a paragraph reads as a space", JSON.stringify(markdownToBlocks("one\ntwo\n\nthree")) === '["one two","three"]');
t("a picture with a javascript: link is flagged", checkBody("![x](javascript:alert(1))").length > 0 || markdownToBlocks("![x](javascript:alert(1))").every((b) => typeof b === "string"));
t("a non-embed video link is flagged", checkBody("[video](https://www.youtube.com/watch?v=abc)").length === 1);
t("a clean body passes", checkBody(blocksToMarkdown(sample)).length === 0);
t("slugify keeps it readable", slugify("Ollie Young’s Journey — U14 & U15!") === "ollie-young-s-journey-u14-and-u15");
t("primary tag: a known tag wins", primaryTag(["Spotlight", "Academy"], { tags: ["Club", "First Team", "Academy"] }) === "Academy");
t("primary tag: unknown falls back to the site's first", primaryTag(["Spotlight"], { tags: ["Club", "Academy"] }) === "Club");

// Every article cufc.co.nz carries in code: blocks → markdown → blocks is exact
// (an empty alt/caption counting as none — the site reads `alt ?? ""` — and an
// empty paragraph, which renders as nothing, dropped: one 2022 article carries a
// paragraph that is a lone byte-order mark).
const norm = (bs: BodyBlock[]) => bs.filter((b) => typeof b !== "string" || b.trim() !== "").map((b) => {
  if (typeof b === "string") return b.trim();
  if ("image" in b) { const o: any = { image: b.image }; if (b.alt) o.alt = b.alt; if (b.caption) o.caption = b.caption; return o; }
  return b;
});
const site = join(process.cwd(), "..", "..", "..", "cufc-website", "src", "content");
const siteAlt = join(process.cwd(), "..", "cufc-website", "src", "content");
const dir = existsSync(site) ? site : siteAlt;
if (existsSync(dir)) {
  let n = 0; const broken: string[] = [];
  for (const f of ["editorial.json", "news-archive.json", "news-history.json"]) {
    for (const a of JSON.parse(readFileSync(join(dir, f), "utf8"))) {
      n++;
      const back = markdownToBlocks(blocksToMarkdown(a.body));
      if (JSON.stringify(norm(back)) !== JSON.stringify(norm(a.body))) broken.push(a.slug);
      if (checkBody(blocksToMarkdown(a.body)).length) broken.push(`${a.slug} (body check)`);
    }
  }
  t(`round trip: all ${n} in-code cufc.co.nz articles${broken.length ? ` — broken: ${broken.slice(0, 5).join(", ")}` : ""}`, broken.length === 0 && n > 500);
} else {
  fails.push("cufc-website content not found — round trip on real articles not run");
}

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) process.exit(1);
