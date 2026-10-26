// ── One allowance for every door Rambo has ───────────────────────────────────
//
// Daniel, 2026-10-26: "we can kind of limit usage … I can monitor the usage".
// A person's prompts are counted across the Mailer's builder (mailer_ai_usage)
// and the chat (kb_chat_messages, role=user — the Knowledge Base tab and
// Rambo's own page write the same table), per New Zealand day, against the one
// cap in users.mailer_ai_daily_limit (NULL = 50, 0 = off). Counted from rows,
// never a counter that can drift across two Fly machines.
// 🔴 kb_chat_messages.created_at is a timestamp WITHOUT time zone (UTC wall
// clock); it must be marked UTC before shifting to NZ, or a 10:30pm question
// counts for yesterday. mailer_ai_usage.created_at is timestamptz.

import { sql } from "drizzle-orm";
import { db } from "./db";
import { ramboDailyLimitFor } from "@shared/rambo-chat";
import { mailerAiCostCents } from "@shared/mailer-ai";
import type { RamboUsageTotals } from "@shared/rambo-chat";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

export { ramboDailyLimitFor };

/** Prompts this person has sent today (NZ), Mailer + chat together. */
export async function ramboUsedToday(userId: number): Promise<number> {
  const r = rowsOf(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM mailer_ai_usage
        WHERE user_id = ${userId}
          AND (created_at AT TIME ZONE 'Pacific/Auckland')::date = (now() AT TIME ZONE 'Pacific/Auckland')::date)
      +
      (SELECT count(*)::int FROM kb_chat_messages m JOIN kb_chat_sessions s ON s.id = m.session_id
        WHERE s.user_id = ${userId} AND m.role = 'user'
          AND ((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Auckland')::date = (now() AT TIME ZONE 'Pacific/Auckland')::date)
      +
      -- Content Studio (2026-10-27): a graphic or a page made or re-prompted.
      (SELECT count(*)::int FROM studio_generations
        WHERE user_id = ${userId}
          AND (created_at AT TIME ZONE 'Pacific/Auckland')::date = (now() AT TIME ZONE 'Pacific/Auckland')::date)
      AS n`));
  return Number(r[0]?.n ?? 0);
}

export interface RamboPersonUsage {
  userId: number | null;
  label: string;
  prompts: number;
  cents: number;
}

/** This NZ month, per person, both doors — for the super-admin usage view.
 *  The chat is not workspace-scoped (a person's chats follow them), so this is
 *  organisation-wide on purpose. */
export async function ramboPeopleThisMonth(): Promise<RamboPersonUsage[]> {
  const r = rowsOf(await db.execute(sql`
    WITH mailer AS (
      SELECT user_id, max(user_label) AS label, count(*)::int AS prompts, coalesce(sum(cost_usd_cents), 0)::numeric AS cents
      FROM mailer_ai_usage
      WHERE (created_at AT TIME ZONE 'Pacific/Auckland') >= date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland')
      GROUP BY user_id
    ), chat AS (
      SELECT s.user_id, max(u.first_name || ' ' || coalesce(u.last_name, '')) AS label,
             count(*) FILTER (WHERE m.role = 'user')::int AS prompts,
             coalesce(sum(m.cost_usd_cents), 0)::numeric AS cents
      FROM kb_chat_messages m JOIN kb_chat_sessions s ON s.id = m.session_id LEFT JOIN users u ON u.id = s.user_id
      WHERE ((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Auckland') >= date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland')
      GROUP BY s.user_id
    ), studio AS (
      SELECT user_id, max(user_label) AS label, count(*)::int AS prompts, coalesce(sum(cost_usd_cents), 0)::numeric AS cents
      FROM studio_generations
      WHERE (created_at AT TIME ZONE 'Pacific/Auckland') >= date_trunc('month', now() AT TIME ZONE 'Pacific/Auckland')
      GROUP BY user_id
    ), both AS (
      SELECT coalesce(mailer.user_id, chat.user_id) AS user_id,
             coalesce(chat.label, mailer.label) AS label,
             coalesce(mailer.prompts, 0) + coalesce(chat.prompts, 0) AS prompts,
             coalesce(mailer.cents, 0) + coalesce(chat.cents, 0) AS cents
      FROM mailer FULL OUTER JOIN chat ON chat.user_id = mailer.user_id
    )
    SELECT coalesce(both.user_id, studio.user_id) AS user_id,
           coalesce(both.label, studio.label, 'Unknown') AS label,
           coalesce(both.prompts, 0) + coalesce(studio.prompts, 0) AS prompts,
           round((coalesce(both.cents, 0) + coalesce(studio.cents, 0))::numeric, 2)::float AS cents
    FROM both FULL OUTER JOIN studio ON studio.user_id = both.user_id
    ORDER BY prompts DESC, label`));
  return r.map((x) => ({ userId: x.user_id == null ? null : Number(x.user_id), label: String(x.label).trim() || "Unknown", prompts: Number(x.prompts) || 0, cents: Number(x.cents) || 0 }));
}

/** US cents for one answer, from the shared price table. */
export function ramboCostCents(model: string, u: RamboUsageTotals): number {
  return mailerAiCostCents(model, u);
}
