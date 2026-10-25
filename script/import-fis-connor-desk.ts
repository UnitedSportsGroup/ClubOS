/**
 * Brings Connor's "Follow-up desk" (the local dashboard he built, 13–20 Oct
 * 2026, shared as Football_in_Schools_Dashboard_Sharing.zip) into the ClubOS
 * Football in Schools pipeline, ADDITIVELY.
 *
 *   sqlite3 "file:dashboard.sqlite3?mode=ro" "SELECT data FROM app_state WHERE id=1" > state.json
 *   npx tsx --env-file=.env script/import-fis-connor-desk.ts state.json [--commit]
 *
 * Dry run by default; --commit writes everything in ONE transaction.
 *
 * What it does, lead by lead (matched by organisation name — the desk was
 * seeded from the same workbook as fis_leads, 159 of 160 names match):
 *   - stage: his stage mapped to ours, applied FORWARD ONLY and never out of
 *     a closed stage (fisAdvancedStage). His "Closed" becomes not_now with a
 *     reason read off his hold reason. A move writes a stage_change activity.
 *   - priority: his warm leads become `warm` where ours is unset or cold.
 *   - follow-up: the earliest OPEN task per lead becomes next_follow_up_on
 *     where ours is blank; every open task is kept as a note activity.
 *   - meeting write-ups: each of his activities becomes a `visit` activity on
 *     the day it happened.
 *   - notes: his personal note, contact update, next step, hold note and
 *     funnel facts become the lead's notes where ours are blank.
 *   - contacts: filled only where OURS are blank; a difference where both are
 *     set is REPORTED, never overwritten (ClubOS was edited after 13 Oct too).
 *
 * Idempotent: every activity it writes carries the TAG, and is skipped if a
 * row with the same lead + note already exists; stage/priority/follow-up/notes
 * only change when the rule above says so, so a second run is a no-op.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import { fisAdvancedStage, isFisStage, type FisStage } from "../shared/fis-leads";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const COMMIT = process.argv.includes("--commit");
if (!file) { console.error("usage: import-fis-connor-desk.ts <state.json> [--commit]"); process.exit(1); }

const TAG = "[desk-import 2026-10-20]";
const STAGE: Record<string, FisStage> = {
  "New": "new", "Contacted": "contacted", "In conversation": "talking", "Meeting booked": "meeting",
  "Free session": "trial", "Proposal": "proposal", "Booked": "booked", "Closed": "not_now",
};
const norm = (s: string) => (s || "").toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const reasonFor = (hold: string) =>
  /fund|budget/i.test(hold) ? "budget" : /not interested/i.test(hold) ? "not_interested" : /provider/i.test(hold) ? "has_provider" : /timing|next term|next year/i.test(hold) ? "timing" : "other";
// A date at midday NZ, so the day never shifts when it is read back.
const nzNoon = (d: string) => `${d}T12:00:00+13:00`;

type Entity = Record<string, any>;
type Task = { entityId: string; due?: string; title?: string; note?: string; done?: boolean };
type Act = { entityId: string; date?: string; at?: string; createdAt?: string; text?: string; note?: string; summary?: string; type?: string };

async function main() {
  const state = JSON.parse(fs.readFileSync(file!, "utf8"));
  const entities: Entity[] = state.entities ?? [];
  const tasks: Task[] = state.tasks ?? [];
  const acts: Act[] = state.activities ?? [];
  const ROLLBACK = new Error("__rollback__");
  const report = { matched: 0, unmatched: [] as string[], stageMoves: [] as string[], stageKept: [] as string[], priority: 0, followUps: 0, taskNotes: 0, meetings: 0, notes: 0, contactsFilled: 0, contactDiffs: [] as string[], skippedExisting: 0 };

  try {
    await db.transaction(async (tx) => {
      const [org] = (await tx.execute(sql`SELECT id FROM organizations WHERE slug = 'christchurch-united'`)).rows as any[];
      const [connor] = (await tx.execute(sql`SELECT id FROM users WHERE lower(email) = 'support@cufc.co.nz'`)).rows as any[];
      const by = connor?.id ?? null;
      const leads = (await tx.execute(sql`SELECT * FROM fis_leads WHERE organization_id = ${org.id}`)).rows as any[];
      const byName = new Map(leads.map((l) => [norm(l.name), l]));

      const addActivity = async (lead: any, type: string, outcome: string | null, note: string, when: string | null, from: string | null, to: string | null) => {
        const tagged = `${note}\n${TAG}`;
        const dup = (await tx.execute(sql`SELECT 1 FROM fis_lead_activities WHERE lead_id = ${lead.id} AND note = ${tagged} LIMIT 1`)).rows.length > 0;
        if (dup) { report.skippedExisting++; return false; }
        await tx.execute(sql`
          INSERT INTO fis_lead_activities (organization_id, lead_id, type, outcome, note, from_stage, to_stage, created_by, created_at)
          VALUES (${org.id}, ${lead.id}, ${type}, ${outcome}, ${tagged}, ${from}, ${to}, ${by}, ${when ? sql`${when}::timestamptz` : sql`now()`})`);
        return true;
      };

      for (const e of entities) {
        const lead = byName.get(norm(e.name));
        if (!lead) { report.unmatched.push(`${e.kind}: ${e.name}`); continue; }
        report.matched++;

        // ── stage: forward only ────────────────────────────────────────────
        const want = STAGE[e.stage];
        if (want && isFisStage(lead.status)) {
          const next = fisAdvancedStage(lead.status as FisStage, want);
          if (next !== lead.status) {
            const hold = clean(e.holdReason) || clean(e.holdNote);
            const reason = next === "not_now" ? reasonFor(hold) : null;
            await tx.execute(sql`UPDATE fis_leads SET status = ${next}, closed_reason = ${reason}, stage_changed_at = now(), updated_at = now() WHERE id = ${lead.id}`);
            await addActivity(lead, "stage_change", null, `Stage from Connor's follow-up desk: ${e.stage}${hold ? ` (${hold})` : ""}`, null, lead.status, next);
            report.stageMoves.push(`${e.name}: ${lead.status} → ${next}`);
            lead.status = next;
          } else if (want !== lead.status) {
            report.stageKept.push(`${e.name}: desk says ${e.stage}, ClubOS keeps ${lead.status}`);
          }
        }

        // ── priority: his warm leads ──────────────────────────────────────
        if (e.warmLead && (!lead.priority || lead.priority === "cold")) {
          await tx.execute(sql`UPDATE fis_leads SET priority = 'warm', updated_at = now() WHERE id = ${lead.id}`);
          report.priority++;
        }

        // ── follow-ups: his open tasks ────────────────────────────────────
        const open = tasks.filter((t) => t.entityId === e.id && !t.done && t.due).sort((a, b) => (a.due! < b.due! ? -1 : 1));
        if (open.length && !lead.next_follow_up_on) {
          await tx.execute(sql`UPDATE fis_leads SET next_follow_up_on = ${open[0].due}, updated_at = now() WHERE id = ${lead.id}`);
          report.followUps++;
        }
        for (const t of open) {
          if (await addActivity(lead, "note", "follow_up", `Follow-up due ${t.due}: ${clean(t.title)}${clean(t.note) ? ` — ${clean(t.note)}` : ""}`, null, null, null)) report.taskNotes++;
        }

        // ── meeting write-ups ─────────────────────────────────────────────
        for (const a of acts.filter((x) => x.entityId === e.id)) {
          const when = clean(a.date) || clean(a.at) || clean(a.createdAt);
          const text = clean(a.text) || clean(a.note) || clean(a.summary);
          if (!text) continue;
          const day = /^\d{4}-\d{2}-\d{2}/.test(when) ? when.slice(0, 10) : null;
          if (await addActivity(lead, "visit", "meeting", text, day ? nzNoon(day) : null, null, null)) report.meetings++;
        }

        // ── notes: what he wrote that has no column of its own ────────────
        const lines: string[] = [];
        const push = (label: string, v: unknown) => { const s = clean(v); if (s) lines.push(`${label}: ${s}`); };
        push("Personal note", e.personalNote);
        push("Contact update", e.contactUpdate);
        push("Next step", e.leadNextStep);
        push("On hold", e.holdReason);
        push("Hold note", e.holdNote);
        push("Need", e.funnelNeed); push("Cohort", e.funnelCohort); push("Timing", e.funnelTiming);
        push("Agreed format", e.funnelFormat); push("Delivery plan", e.funnelDelivery);
        push("Decision maker", e.funnelDecision); push("Funding", e.funnelFunding);
        push("Decision date", e.funnelDecisionDate); push("Blocker", e.funnelBlocker); push("Free session", e.funnelTrial);
        if (lines.length && !clean(lead.notes)) {
          await tx.execute(sql`UPDATE fis_leads SET notes = ${`From Connor's follow-up desk (20 Oct 2026):\n${lines.join("\n")}`}, updated_at = now() WHERE id = ${lead.id}`);
          report.notes++;
        }

        // ── contacts: fill blanks, report differences ─────────────────────
        const pairs: [string, string][] = [["contact_name", "contactName"], ["contact_role", "contactRole"], ["contact_email", "contactEmail"], ["email", "officeEmail"], ["phone", "phone"], ["website", "website"]];
        for (const [col, key] of pairs) {
          const theirs = clean(e[key]);
          // "Not publicly listed" is the seed's placeholder, not a person —
          // 23 schools carried it where his desk has the principal's name.
          const ours = /^not publicly listed$/i.test(clean(lead[col])) ? "" : clean(lead[col]);
          if (!theirs) continue;
          if (!ours) {
            // `col` comes from the fixed list above, never from the file.
            await tx.execute(sql`UPDATE fis_leads SET ${sql.raw(col)} = ${theirs}, updated_at = now() WHERE id = ${lead.id}`);
            report.contactsFilled++;
          } else if (col !== "contact_role" && norm(ours) !== norm(theirs)) {
            // contact_role is left out of the report: the desk normalised every
            // role label to "Centre lead / management contact", which is a
            // wording difference on 80 rows, not a different person.
            report.contactDiffs.push(`${e.name} · ${col}: ClubOS "${ours}" / desk "${theirs}"`);
          }
        }

        // last_activity_at follows the newest thing we know about
        await tx.execute(sql`UPDATE fis_leads SET last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'), (SELECT COALESCE(max(created_at), 'epoch') FROM fis_lead_activities WHERE lead_id = ${lead.id})) WHERE id = ${lead.id}`);
      }

      console.log(JSON.stringify(report, null, 1));
      if (!COMMIT) throw ROLLBACK;
    });
    console.log(COMMIT ? "\nCOMMITTED." : "\n(dry run — nothing written)");
  } catch (e) {
    if (e === ROLLBACK) { console.log("\n(dry run — rolled back, nothing written)"); return; }
    throw e;
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
