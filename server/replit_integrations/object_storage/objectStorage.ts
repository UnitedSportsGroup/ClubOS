// Supabase Storage-backed implementation. Replaces the Replit sidecar
// (was @google-cloud/storage talking to localhost:1106). Same exported
// interface as before so routes.ts keeps working without changes.
//
// Files live in a single private bucket (env: SUPABASE_STORAGE_BUCKET,
// default "clubos-uploads"). Public URL paths look like
// "/objects/uploads/<uuid>.<ext>" — the same scheme rows already store in
// the database.
//
// ACL info (owner + visibility) is stored in the public.object_acls
// Postgres table — see objectAcl.ts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Response } from "express";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "clubos-uploads";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env to use object storage"
  );
}

export const objectStorageClient: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// Thin handle for a stored object. `name` mirrors GCS File.name (the
// bucket-relative path, e.g. "uploads/abc.jpg") so existing call sites in
// objectAcl.ts and routes.ts can pass it around unchanged.
export class StoredFile {
  public readonly name: string;
  constructor(public readonly storagePath: string) {
    this.name = storagePath;
  }
}

interface FileMetadata {
  contentType?: string;
  size?: number;
  cacheControl?: string;
}

async function fetchMetadata(storagePath: string): Promise<FileMetadata | null> {
  const slash = storagePath.lastIndexOf("/");
  const dir = slash >= 0 ? storagePath.slice(0, slash) : "";
  const name = slash >= 0 ? storagePath.slice(slash + 1) : storagePath;
  const { data, error } = await objectStorageClient.storage
    .from(BUCKET)
    .list(dir, { limit: 1000, search: name });
  if (error) return null;
  const match = data?.find((f) => f.name === name);
  if (!match) return null;
  return {
    contentType: (match.metadata as any)?.mimetype as string | undefined,
    size: (match.metadata as any)?.size as number | undefined,
    cacheControl: (match.metadata as any)?.cacheControl as string | undefined,
  };
}

async function fetchBuffer(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await objectStorageClient.storage
    .from(BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export class ObjectStorageService {
  // Public objects search isn't used in any current call site, but kept for
  // interface compatibility. Returns the file if it exists at any prefix.
  async searchPublicObject(filePath: string): Promise<StoredFile | null> {
    const meta = await fetchMetadata(filePath);
    return meta ? new StoredFile(filePath) : null;
  }

  // Stream a stored object to the HTTP response. Sets caching headers based
  // on the ACL visibility (public ACLs get a public Cache-Control).
  async downloadObject(file: StoredFile, res: Response, cacheTtlSec = 3600) {
    try {
      const meta = await fetchMetadata(file.storagePath);
      if (!meta) {
        if (!res.headersSent) res.status(404).json({ error: "Object not found" });
        return;
      }
      const acl = await getObjectAclPolicy(file);
      const isPublic = acl?.visibility === "public";
      res.set({
        "Content-Type": meta.contentType || "application/octet-stream",
        ...(meta.size != null ? { "Content-Length": String(meta.size) } : {}),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      const buf = await fetchBuffer(file.storagePath);
      if (!buf) {
        if (!res.headersSent) res.status(500).json({ error: "Error downloading file" });
        return;
      }
      Readable.from(buf).pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Upload a buffer directly to the "uploads/" prefix in the bucket. Returns
  // the StoredFile handle plus the public-facing "/objects/uploads/<id>.<ext>"
  // path that should be persisted in the DB.
  async uploadBufferToUploads(
    buffer: Buffer,
    contentType: string,
    extension: string,
    objectId: string = randomUUID(),
  ): Promise<{ file: StoredFile; objectPath: string }> {
    const safeExt = extension.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
    const storagePath = `uploads/${objectId}.${safeExt}`;
    const objectPath = `/objects/uploads/${objectId}.${safeExt}`;

    const { error } = await objectStorageClient.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType,
        cacheControl: "public, max-age=86400",
        upsert: true,
      });
    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    return { file: new StoredFile(storagePath), objectPath };
  }

  // No-op now — uploads are server-mediated via uploadBufferToUploads.
  // Kept for interface compatibility; returns a server-relative path that the
  // client can POST to instead of a presigned URL.
  async getObjectEntityUploadURL(): Promise<string> {
    throw new Error(
      "Direct presigned client uploads are not supported in the Supabase backend. " +
        "Use the server-side multipart upload endpoint instead."
    );
  }

  // Map a stored "/objects/<path>" URL back to a StoredFile handle. Throws
  // ObjectNotFoundError if the file doesn't exist in the bucket.
  async getObjectEntityFile(objectPath: string): Promise<StoredFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const storagePath = objectPath.slice("/objects/".length);
    if (!storagePath) {
      throw new ObjectNotFoundError();
    }
    const meta = await fetchMetadata(storagePath);
    if (!meta) {
      throw new ObjectNotFoundError();
    }
    return new StoredFile(storagePath);
  }

  // Strip absolute storage URLs back to a server-relative "/objects/..." path.
  // Mirrors the original GCS-flavoured normaliser, but tolerant of Supabase URLs.
  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/")) return rawPath;
    try {
      const u = new URL(rawPath);
      // Supabase storage URL: /storage/v1/object/{public,sign}/<bucket>/<path>
      const match = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
      if (match) return `/objects/${match[1]}`;
    } catch {
      // not a URL — fall through
    }
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
