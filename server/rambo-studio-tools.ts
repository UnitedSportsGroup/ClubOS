// Rambo makes content from the chat: "make me a graphic for the October
// camp" / "build a landing page for Football in Schools" / "a visual of the
// U4–U8 lifetime value". The tool calls the same Studio generator the tab
// uses, saves the piece as the asker's own draft, and hands back the link.
// Any staff member may (the daily allowance applies); the piece lands in
// the workspace they are standing in, under that workspace's brand unless
// they named another.
//
// Daniel, 2026-10-27: "build it into Rambo so that Rambo can do this as well
// … 'Visual: give me a visual representation of the under-4, under-8
// customer lifetime value'."

import { sql } from "drizzle-orm";
import { db } from "./db";
import { studioPieces, studioVersions } from "@shared/schema";
import { graphicSize, STUDIO_TITLE_MAX, studioBrand, studioBrandForOrgSlug } from "@shared/studio";
import type { Viewer } from "@shared/knowledge-base";
import { stampGeneration } from "./studio-ai";
import { generateDesigned } from "./studio-design";
import { storeRender } from "./studio";
import { designedHeadline } from "@shared/studio-designed";

interface ToolResult { text: string; sources?: { id: number; title: string; brand: string }[] }
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

async function orgFor(viewer: Viewer, input: any): Promise<{ orgId: number; orgSlug: string; brandKey: string } | null> {
  let slug: string | null = viewer.workspaceSlug ?? null;
  const named = typeof input?.brand === "string" ? studioBrand(input.brand) : undefined;
  if (named) slug = named.orgSlug;
  if (!slug && viewer.memberships.length === 1) slug = viewer.memberships[0].orgSlug;
  if (!slug) return null;
  if (!viewer.memberships.some((m) => m.orgSlug === slug) && viewer.globalRole !== "super_admin") return null;
  const r = rowsOf(await db.execute(sql`SELECT id, slug FROM organizations WHERE slug = ${slug} LIMIT 1`))[0];
  if (!r) return null;
  return { orgId: Number(r.id), orgSlug: String(r.slug), brandKey: named?.key ?? studioBrandForOrgSlug(String(r.slug))?.key ?? "usg" };
}

async function make(kind: "graphic" | "page" | "carousel", viewer: Viewer, input: any, onStage?: (s: string) => void): Promise<ToolResult> {
  const where = await orgFor(viewer, input);
  if (!where) return { text: `I need to know which workspace to make it in — say one of: ${viewer.memberships.map((m) => m.orgName).join(", ")}.` };
  const brief = String(input?.brief ?? "").trim();
  if (!brief) return { text: "Tell me what the piece is for, who it is for and what they should do, and I'll make it." };
  const sizeKey = kind !== "page" ? graphicSize(String(input?.size || (kind === "carousel" ? "portrait" : "square"))).key : undefined;
  // The designer engine (2026-11-01): Rambo lays it out, looks at it in a
  // real browser and fixes it — the same as the Studio tab. A few minutes;
  // the chat route keeps the line open while it works.
  const out = await generateDesigned({ kind, brandKey: where.brandKey, orgId: where.orgId, userId: viewer.userId || null, userLabel: viewer.name, brief, sizeKey, onStage, slides: kind === "carousel" ? Math.min(10, Math.max(3, Math.round(Number(input?.slides) || 5))) : undefined });
  if (!out.ok || !out.doc) return { text: `I couldn't make that: ${out.error || "no usable result"}. Try a shorter or more specific brief, or open Studio and try there.` };
  const [piece] = await db.insert(studioPieces).values({
    organizationId: where.orgId, brand: where.brandKey, kind, title: (out.title || "Untitled").slice(0, STUDIO_TITLE_MAX), size: sizeKey ?? null, status: "draft",
    doc: out.doc as any, version: 1, brief, createdByUserId: viewer.userId,
  }).returning();
  await db.insert(studioVersions).values({ pieceId: piece.id, version: 1, doc: out.doc as any, how: "made", note: `from Rambo: ${brief.slice(0, 400)}`, createdByUserId: viewer.userId || null });
  await stampGeneration(out.generationId, piece.id);
  for (const png of out.pngs ?? (out.png ? [{ ...out.png, slide: 0 }] : [])) await storeRender(piece.id, 1, png.buffer, "image/png", png.width, png.height, png.slide);
  const link = `https://app.usg.co.nz/admin/content-studio/${piece.id}`;
  const what = kind === "graphic" ? `a ${graphicSize(sizeKey).label.toLowerCase()} graphic` : kind === "carousel" ? `a ${out.pngs?.length ?? ""}-slide carousel` : "a landing page";
  const headline = designedHeadline(out.doc);
  const words = headline ? `Headline: "${headline}".` : "";
  return {
    text: `Made ${what}: **${piece.title}** (draft, yours). ${words} ${out.reply} Open it to see it, change any word, and ${kind === "page" ? "publish it on the club's site" : kind === "carousel" ? "download every slide" : "download the PNG"}: [${piece.title}](${link})`,
  };
}

export const STUDIO_TOOL_HANDLERS: Record<string, (viewer: Viewer, input: any, ctx?: { onStage?: (s: string) => void }) => Promise<ToolResult>> = {
  make_graphic: (viewer, input, ctx) => make("graphic", viewer, input, ctx?.onStage),
  make_page: (viewer, input, ctx) => make("page", viewer, input, ctx?.onStage),
  make_carousel: (viewer, input, ctx) => make("carousel", viewer, input, ctx?.onStage),
};
