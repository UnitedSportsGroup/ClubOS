/**
 * Rambo looks through posts and SUGGESTS labels.
 *
 * A person presses "Find with Rambo" for a brand and a year. Each post Rambo
 * has not looked at yet is sent once — its picture (a video's cover frame) and
 * its caption — with the list of labels, and the answer is stored as
 * suggestions. Nothing Rambo says is counted until a person confirms it.
 *
 * 🔴 A post is looked at ONCE (social_posts.label_checked_at), so pressing
 *    the button again never pays twice.
 * 🔴 The run's progress lives in the database, not in memory: production is
 *    two machines and the page may ask the other one. A run that has not
 *    reported for three minutes has stopped (a deploy, a crash) and says so.
 * 🔴 A sponsor is offered only for the brands that partner is signed to, and
 *    only when the name or logo can be read. A video is judged on its cover
 *    frame alone, so a logo that flashes mid-video is a person's job to tag.
 */
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { mailerAiCostCents } from "@shared/mailer-ai";
import { LABEL_RUN_MAX, LABEL_RUN_STALE_MS, labelWindow, type LabelFindState, type LabelRun } from "@shared/social-labels";
import { q, smallThumb } from "./routes";

const MODEL = process.env.SOCIAL_LABEL_MODEL || "claude-sonnet-5-5";
const NZ = "Pacific/Auckland";
/** US cents a post, used before any run has a real figure. */
const DEFAULT_CENTS_PER_POST = 0.5;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type FindScope = { brand: string | null; year: string; platforms: string[] };

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["labels"],
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason"],
        properties: { id: { type: "integer" }, reason: { type: "string" } },
      },
    },
  },
} as const;

type OfferedLabel = { id: number; kind: string; name: string; hint: string | null; brands: string[] | null };

function systemPrompt(labels: OfferedLabel[]): string {
  const list = labels.map((l) => `${l.id} | ${l.kind === "sponsor" ? "sponsor" : "content type"} | ${l.name}${l.hint ? ` | ${l.hint}` : ""}`).join("\n");
  return `You label social media posts for a New Zealand football organisation, so its staff can count how each kind of post performs and how often each sponsor is seen.

You are given ONE post: its picture (for a video, only the cover frame) and its caption. Pick the labels from the list below that apply.

Rules:
- A content type applies only when the post clearly IS that kind of post. Most posts take one content type or none.
- A sponsor applies only when that sponsor's name or logo can actually be read in the picture, or the caption names them. Never guess from a blurred, cropped or partly hidden mark, and never because a sponsor is usually on the kit.
- Never pick the nearest fit. If your reason would say "not quite", "the closest option" or "rather than", leave the label out.
- If nothing clearly applies, return an empty list. An empty list is a good answer, and many posts should get one.
- Use only ids from the list.
- "reason" is one short plain sentence saying what you saw.

Labels (id | kind | name | what to look for):
${list}`;
}

const scopeWhere = `a.archived_at IS NULL
  AND ($1::text IS NULL OR a.brand = $1)
  AND a.platform = ANY($2::text[])
  AND ($3::date IS NULL OR (p.posted_at AT TIME ZONE '${NZ}')::date >= $3::date)
  AND ($4::date IS NULL OR (p.posted_at AT TIME ZONE '${NZ}')::date <= $4::date)
  AND p.label_checked_at IS NULL
  AND (p.thumb_url IS NOT NULL OR COALESCE(p.caption, '') <> '')`;

function scopeParams(scope: FindScope) {
  const w = labelWindow(scope.year, null);
  return [scope.brand, scope.platforms, w.from, w.to];
}

const toRun = (r: any): LabelRun => {
  const stale = r.status === "running" && Date.now() - new Date(r.heartbeat_at).getTime() > LABEL_RUN_STALE_MS;
  return {
    id: Number(r.id),
    status: stale ? "stopped" : r.status,
    total: r.total,
    done: r.done,
    suggested: r.suggested,
    cents: Number(r.cents),
    error: stale ? "The search stopped part-way (the server restarted). Press Find again to carry on; nothing is looked at twice." : r.error,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    scope: r.scope,
  };
};

async function latestRun(): Promise<LabelRun | null> {
  const [r] = await q(`SELECT * FROM social_label_runs ORDER BY id DESC LIMIT 1`);
  return r ? toRun(r) : null;
}

export async function labelFindState(scope: FindScope): Promise<LabelFindState> {
  const [[count], [avg], run] = await Promise.all([
    q<{ n: number }>(`SELECT count(*)::int AS n FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE ${scopeWhere}`, scopeParams(scope)),
    q<{ per: string | null }>(`SELECT sum(cents) / NULLIF(sum(done), 0) AS per FROM social_label_runs WHERE done > 0`),
    latestRun(),
  ]);
  const per = avg?.per != null ? Number(avg.per) : DEFAULT_CENTS_PER_POST;
  const perRun = Math.min(LABEL_RUN_MAX, count.n);
  return { enabled: Boolean(process.env.ANTHROPIC_API_KEY), unchecked: count.n, perRun, estimateCents: Math.round(per * perRun), run };
}

export async function stopLabelRun() {
  await q(`UPDATE social_label_runs SET status = 'stopped', finished_at = now() WHERE status = 'running'`);
}

export async function startLabelRun(scope: FindScope, userId: number | null, limit: number): Promise<{ runId: number } | { error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "Rambo is not switched on for this server." };
  const live = await latestRun();
  if (live?.status === "running") return { error: "Rambo is already looking through posts. Wait for it to finish." };
  // A stale "running" row is closed off so the next one is the only live run.
  await q(`UPDATE social_label_runs SET status = 'stopped', finished_at = now() WHERE status = 'running'`);

  const labels = await q<OfferedLabel>(
    `SELECT l.id, l.kind, l.name, l.hint, CASE WHEN sp.id IS NULL THEN NULL ELSE sp.brand_tags END AS brands
     FROM social_labels l LEFT JOIN sponsorship_partners sp ON sp.id = l.partner_id
     WHERE l.archived_at IS NULL ORDER BY l.kind, lower(l.name)`,
  );
  if (!labels.length) return { error: "Add at least one label first." };

  const posts = await q<{ id: string }>(
    `SELECT p.id FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
     WHERE ${scopeWhere} ORDER BY p.posted_at DESC LIMIT $5`,
    [...scopeParams(scope), Math.max(1, Math.min(LABEL_RUN_MAX, limit))],
  );
  if (!posts.length) return { error: "Rambo has already looked at every post in this selection." };

  const [run] = await q<{ id: string }>(
    `INSERT INTO social_label_runs (started_by, scope, model, total) VALUES ($1, $2::jsonb, $3, $4) RETURNING id`,
    [userId, JSON.stringify(scope), MODEL, posts.length],
  );
  const runId = Number(run.id);
  // Not awaited: the request answers at once and the page watches the run's row.
  void work(runId, posts.map((p) => Number(p.id)), labels).catch(async (e) => {
    console.error(`[Social labels] run ${runId} failed:`, e?.message ?? e);
    await q(`UPDATE social_label_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status = 'running'`, [runId, friendly(e)]).catch(() => {});
  });
  return { runId };
}

function friendly(e: any): string {
  const msg = String(e?.message ?? e);
  if (/credit|balance|billing/i.test(msg)) return "The club's Anthropic account is out of credit. Top it up at console.anthropic.com.";
  if (/401|authentication|api.key/i.test(msg)) return "Rambo's key was refused. Check ANTHROPIC_API_KEY.";
  return "Rambo could not finish. Try again in a few minutes.";
}

/**
 * Now and then the model returns a label and, in the same breath, says it does
 * not really apply ("…so this is excluded"). A pick whose own reason argues
 * against it is dropped.
 */
export const HEDGED = /\b(excluded?|not (clearly |quite |really )?(readable|legible|clear|visible|met)\b|not clear enough|does not clearly|hard to (read|make out)|nearest (option|fit)|closest (option|fit)|cannot be read|can't be read)/i;

/** Errors that will hit every post alike: stop the run instead of failing 400 times. */
const fatal = (e: any) => /credit|balance|billing|401|authentication|api.key|403|permission/i.test(String(e?.message ?? e)) || e?.status === 401 || e?.status === 403;

async function work(runId: number, postIds: number[], labels: OfferedLabel[]) {
  const prompts = new Map<string, { system: string; ids: Set<number> }>();
  const promptFor = (brand: string | null) => {
    const key = brand ?? "";
    let p = prompts.get(key);
    if (!p) {
      // A sponsor tied to a partner is offered only on the brands that partner is signed to.
      const offered = labels.filter((l) => l.kind !== "sponsor" || !l.brands || l.brands.length === 0 || (brand != null && l.brands.includes(brand)));
      p = { system: systemPrompt(offered), ids: new Set(offered.map((l) => l.id)) };
      prompts.set(key, p);
    }
    return p;
  };

  let next = 0;
  let stopped = false;
  let fatalError: any = null;

  const one = async (postId: number) => {
    const [post] = await q<{ caption: string | null; kind: string; platform: string; brand: string | null; has_thumb: boolean }>(
      `SELECT p.caption, p.kind, a.platform, a.brand, p.thumb_url IS NOT NULL AS has_thumb
       FROM social_posts p JOIN social_accounts a ON a.id = p.account_id WHERE p.id = $1`,
      [postId],
    );
    if (!post) return;
    const prompt = promptFor(post.brand);
    const content: Anthropic.ContentBlockParam[] = [];
    if (post.has_thumb) {
      const big = await smallThumb(postId, "large").catch(() => null);
      if (big) {
        const jpeg = await sharp(big).resize({ width: 800, height: 1000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } });
      }
    }
    const caption = (post.caption ?? "").trim().slice(0, 1500);
    if (!content.length && !caption) {
      // Nothing to judge: marked as looked at so it is not picked up again.
      await q(`UPDATE social_posts SET label_checked_at = now() WHERE id = $1`, [postId]);
      await q(`UPDATE social_label_runs SET done = done + 1, heartbeat_at = now() WHERE id = $1`, [runId]);
      return;
    }
    content.push({
      type: "text",
      text: `Platform: ${post.platform}. Post type: ${post.kind}${post.kind === "video" || post.kind === "reel" ? " (the picture is its cover frame only)" : ""}.${content.length ? "" : " There is no picture for this post."}\nCaption: ${caption || "(none)"}`,
    });

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA } },
    } as any);

    const usage = {
      input: res.usage.input_tokens ?? 0,
      output: res.usage.output_tokens ?? 0,
      cacheRead: (res.usage as any).cache_read_input_tokens ?? 0,
      cacheWrite: (res.usage as any).cache_creation_input_tokens ?? 0,
    };
    let picked: { id: number; reason: string }[] = [];
    try {
      const text = res.content.find((b: any) => b.type === "text") as any;
      const parsed = JSON.parse(text?.text ?? "{}");
      if (Array.isArray(parsed.labels)) {
        picked = parsed.labels.filter((l: any) => Number.isInteger(l?.id) && prompt.ids.has(l.id) && !HEDGED.test(String(l?.reason ?? "")));
      }
    } catch {
      picked = [];
    }
    let added = 0;
    for (const l of picked.slice(0, 6)) {
      // A label a person already put on (or took off) is left exactly as they left it.
      const rows = await q(
        `INSERT INTO social_post_labels (post_id, label_id, source, reason) VALUES ($1, $2, 'rambo', $3)
         ON CONFLICT (post_id, label_id) DO NOTHING RETURNING post_id`,
        [postId, l.id, String(l.reason ?? "").slice(0, 300) || null],
      );
      added += rows.length;
    }
    await q(`UPDATE social_posts SET label_checked_at = now() WHERE id = $1`, [postId]);
    await q(
      `UPDATE social_label_runs SET done = done + 1, suggested = suggested + $2, input_tokens = input_tokens + $3,
              output_tokens = output_tokens + $4, cents = cents + $5, heartbeat_at = now() WHERE id = $1`,
      [runId, added, usage.input + usage.cacheRead + usage.cacheWrite, usage.output, mailerAiCostCents(MODEL, usage)],
    );
  };

  const lane = async () => {
    while (!stopped && !fatalError) {
      const i = next++;
      if (i >= postIds.length) return;
      if (i % 8 === 0) {
        const [r] = await q<{ status: string }>(`SELECT status FROM social_label_runs WHERE id = $1`, [runId]);
        if (r?.status !== "running") {
          stopped = true;
          return;
        }
      }
      try {
        await one(postIds[i]);
      } catch (e: any) {
        if (fatal(e)) {
          fatalError = e;
          return;
        }
        // One post failing (a picture that will not load, a busy moment) is skipped,
        // left unchecked, and picked up by the next press.
        console.error(`[Social labels] post ${postIds[i]}:`, String(e?.message ?? e).slice(0, 200));
        await q(`UPDATE social_label_runs SET heartbeat_at = now() WHERE id = $1`, [runId]).catch(() => {});
      }
    }
  };

  await Promise.all([lane(), lane(), lane(), lane()]);
  if (fatalError) throw fatalError;
  await q(`UPDATE social_label_runs SET status = 'done', finished_at = now() WHERE id = $1 AND status = 'running'`, [runId]);
}
