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
import { generateStudioPiece, stampGeneration } from "./studio-ai";

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

async function make(kind: "graphic" | "page", viewer: Viewer, input: any): Promise<ToolResult> {
  const where = await orgFor(viewer, input);
  if (!where) return { text: `I need to know which workspace to make it in — say one of: ${viewer.memberships.map((m) => m.orgName).join(", ")}.` };
  const brief = String(input?.brief ?? "").trim();
  if (!brief) return { text: "Tell me what the piece is for, who it is for and what they should do, and I'll make it." };
  const sizeKey = kind === "graphic" ? graphicSize(String(input?.size || "square")).key : undefined;
  const out = await generateStudioPiece({ kind, brandKey: where.brandKey, orgId: where.orgId, userId: viewer.userId || null, userLabel: viewer.name, brief, sizeKey });
  if (!out.ok || !out.doc) return { text: `I couldn't make that: ${out.error || "no usable result"}. Try a shorter or more specific brief, or open Studio and try there.` };
  const [piece] = await db.insert(studioPieces).values({
    organizationId: where.orgId, brand: where.brandKey, kind, title: (out.title || "Untitled").slice(0, STUDIO_TITLE_MAX), size: sizeKey ?? null, status: "draft",
    doc: out.doc as any, version: 1, brief, createdByUserId: viewer.userId,
  }).returning();
  await db.insert(studioVersions).values({ pieceId: piece.id, version: 1, doc: out.doc as any, how: "made", note: `from Rambo: ${brief.slice(0, 400)}`, createdByUserId: viewer.userId || null });
  await stampGeneration(out.generationId, piece.id);
  const link = `https://app.usg.co.nz/admin/content-studio/${piece.id}`;
  const what = kind === "graphic" ? `a ${graphicSize(sizeKey).label.toLowerCase()} graphic` : "a landing page";
  const words = kind === "graphic" ? `Headline: "${(out.doc as any).headline}"${(out.doc as any).sub ? ` — ${(out.doc as any).sub}` : ""}.` : `${(out.doc as any).blocks?.length ?? 0} sections, starting "${(out.doc as any).blocks?.[0]?.headline ?? ""}".`;
  return {
    text: `Made ${what}: **${piece.title}** (draft, yours). ${words} ${out.reply} Open it to see it, change any word, and ${kind === "graphic" ? "download the PNG" : "publish it on the club's site"}: [${piece.title}](${link})`,
  };
}

export const STUDIO_TOOL_HANDLERS: Record<string, (viewer: Viewer, input: any) => Promise<ToolResult>> = {
  make_graphic: (viewer, input) => make("graphic", viewer, input),
  make_page: (viewer, input) => make("page", viewer, input),
};
