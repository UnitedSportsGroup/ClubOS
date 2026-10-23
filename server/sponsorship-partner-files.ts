// ─────────────────────────────────────────────────────────────────────────────
// Where a signed sponsor contract LIVES: Club Drive, under one gated folder.
//
// "Sponsor Contracts / <Company> / <file>" — the folder carries the gate
// sponsorship@united-sports-group, so Drive's own permission rule and the
// Partners tab's permission are the same rule: whoever can open USG → Sponsorship
// can open the file, and nobody else can. The August Google import put the same
// PDFs under "Sponsorship", which is locked to the BUDGET tab; the Partners tab
// stores its own copies here rather than loosening that lock.
//
// Used by the Partners upload route AND the seed, so a contract arrives the
// same way whichever door it came through.
// ─────────────────────────────────────────────────────────────────────────────
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { driveNodes, driveAccessLog } from "@shared/schema";
import { driveIsExtractable } from "@shared/drive";
import { driveStorage, driveChecksum } from "./drive-storage";
import { extractText } from "./drive-extract";

export const SPONSOR_CONTRACTS_FOLDER = "Sponsor Contracts";
export const SPONSOR_CONTRACTS_TAB = "sponsorship";
export const SPONSOR_CONTRACTS_WORKSPACE = "united-sports-group";

async function childFolder(parentId: number | null, name: string): Promise<any | null> {
  const rows = (await db.select().from(driveNodes).where(and(
    parentId === null ? isNull(driveNodes.parentId) : eq(driveNodes.parentId, parentId),
    eq(driveNodes.kind, "folder"),
    sql`lower(${driveNodes.name}) = lower(${name})`,
    isNull(driveNodes.trashedAt),
  ))) as any[];
  return rows[0] ?? null;
}

/** The gated root folder. Created once; the gate is set on creation and never
 *  loosened here. */
export async function ensureSponsorContractsRoot(userId: number | null): Promise<number> {
  const existing = await childFolder(null, SPONSOR_CONTRACTS_FOLDER);
  if (existing) return existing.id;
  const [row] = (await db.insert(driveNodes).values({
    parentId: null,
    kind: "folder",
    name: SPONSOR_CONTRACTS_FOLDER,
    brand: "all",
    requiredTab: SPONSOR_CONTRACTS_TAB,
    requiredWorkspace: SPONSOR_CONTRACTS_WORKSPACE,
    description: "Signed sponsorship agreements — one folder per partner. Managed from USG → Sponsorship → Partners.",
    ownerUserId: userId ?? undefined,
    createdBy: userId ?? undefined,
  }).returning()) as any[];
  return row.id;
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 200) || "Partner";

export async function ensurePartnerFolder(company: string, userId: number | null): Promise<number> {
  const rootId = await ensureSponsorContractsRoot(userId);
  const name = safeName(company);
  const existing = await childFolder(rootId, name);
  if (existing) return existing.id;
  const [row] = (await db.insert(driveNodes).values({
    parentId: rootId,
    kind: "folder",
    name,
    brand: "all",
    ownerUserId: userId ?? undefined,
    createdBy: userId ?? undefined,
  }).returning()) as any[];
  return row.id;
}

/** A sibling name must be unique (drive_nodes_sibling_name_idx). "x.pdf" → "x (2).pdf". */
async function freeName(parentId: number, wanted: string): Promise<string> {
  const base = safeName(wanted);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${stem} (${n})${ext}`;
    const taken = (await db.select({ id: driveNodes.id }).from(driveNodes).where(and(
      eq(driveNodes.parentId, parentId), sql`lower(${driveNodes.name}) = lower(${candidate})`, isNull(driveNodes.trashedAt),
    ))) as any[];
    if (!taken.length) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export interface StoreContractArgs {
  buffer: Buffer;
  name: string;
  contentType: string;
  company: string;
  userId: number | null;
  sourceUrl?: string | null;
  sourceId?: string | null;
  sourceModifiedAt?: Date | null;
  /** Text already read (OCR of a scan) — used instead of extracting again. */
  extractedText?: string | null;
  description?: string | null;
}

/** Put the bytes in storage and the row in Club Drive, under the partner's
 *  folder. Returns the drive node row. */
export async function storeContractFile(a: StoreContractArgs): Promise<any> {
  const folderId = await ensurePartnerFolder(a.company, a.userId);
  const name = await freeName(folderId, a.name);
  const contentType = (a.contentType || "application/octet-stream").split(";")[0];
  const put = await driveStorage().put(a.buffer, contentType, name);

  let extracted: { text: string | null; status: string; error?: string };
  if (a.extractedText && a.extractedText.trim()) extracted = { text: a.extractedText, status: "done" };
  else if (driveIsExtractable(contentType, name)) extracted = await extractText(a.buffer, contentType, name) as any;
  else extracted = { text: null, status: "unsupported" };

  const [row] = (await db.insert(driveNodes).values({
    parentId: folderId,
    kind: "file",
    name,
    storageKey: put.storageKey,
    storageBackend: put.backend,
    mimeType: contentType,
    sizeBytes: put.sizeBytes,
    checksum: put.checksum ?? driveChecksum(a.buffer),
    brand: "all",
    description: a.description ?? undefined,
    extractedText: extracted.text,
    extractStatus: extracted.status,
    extractError: extracted.error,
    source: a.sourceId ? "google_drive" : "clubos",
    sourceId: a.sourceId ?? undefined,
    sourceUrl: a.sourceUrl ?? undefined,
    sourceModifiedAt: a.sourceModifiedAt ?? undefined,
    ownerUserId: a.userId ?? undefined,
    createdBy: a.userId ?? undefined,
  }).returning()) as any[];

  if (a.userId) {
    await db.insert(driveAccessLog).values({ nodeId: row.id, userId: a.userId, action: "upload", detail: `${name} (${put.sizeBytes} bytes) via Partners` } as any).catch(() => {});
  }
  return row;
}

/** Find a contract file already stored under the gated tree by its Google id,
 *  so a re-run of the seed never doubles a file. */
export async function findStoredContractBySourceId(sourceId: string): Promise<any | null> {
  const rootId = await ensureSponsorContractsRoot(null);
  const rows = (await db.execute(sql`
    with recursive sub as (
      select id from drive_nodes where id = ${rootId}
      union all
      select n.id from drive_nodes n join sub on n.parent_id = sub.id
    )
    select n.* from drive_nodes n join sub on sub.id = n.id
    where n.kind = 'file' and n.source_id = ${sourceId} and n.trashed_at is null
    limit 1`)) as any;
  const list = Array.isArray(rows) ? rows : rows.rows;
  return list?.[0] ?? null;
}
