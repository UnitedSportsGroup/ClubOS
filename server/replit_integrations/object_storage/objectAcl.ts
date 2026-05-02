// Postgres-backed ACL for stored objects. Replaces the previous GCS object
// metadata approach (custom:aclPolicy key on the file). Now backed by the
// public.object_acls table.
//
// The StoredFile.name is the bucket-relative storage path (e.g.
// "uploads/abc.jpg"). The DB key is the public-facing "/objects/<name>"
// path so stored references in the DB match.

import { db } from "../../db";
import { objectAcls } from "@shared/schema";
import { eq } from "drizzle-orm";
import { StoredFile } from "./objectStorage";

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function pathKey(file: StoredFile): string {
  return `/objects/${file.name}`;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}
  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(group: ObjectAccessGroup): BaseObjectAccessGroup {
  switch (group.type) {
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectFile: StoredFile,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const key = pathKey(objectFile);
  const ownerId = parseInt(aclPolicy.owner, 10);
  const ownerUserId = Number.isFinite(ownerId) ? ownerId : null;
  const aclRulesJson = aclPolicy.aclRules?.length
    ? JSON.stringify(aclPolicy.aclRules)
    : null;

  await db
    .insert(objectAcls)
    .values({
      objectPath: key,
      ownerUserId,
      visibility: aclPolicy.visibility,
      aclRulesJson,
    })
    .onConflictDoUpdate({
      target: objectAcls.objectPath,
      set: {
        ownerUserId,
        visibility: aclPolicy.visibility,
        aclRulesJson,
        updatedAt: new Date(),
      },
    });
}

export async function getObjectAclPolicy(
  objectFile: StoredFile,
): Promise<ObjectAclPolicy | null> {
  const key = pathKey(objectFile);
  const rows = await db.select().from(objectAcls).where(eq(objectAcls.objectPath, key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    owner: row.ownerUserId != null ? String(row.ownerUserId) : "",
    visibility: (row.visibility as "public" | "private") ?? "private",
    aclRules: row.aclRulesJson ? (JSON.parse(row.aclRulesJson) as ObjectAclRule[]) : undefined,
  };
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: StoredFile;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) return false;

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }
  if (!userId) return false;
  if (aclPolicy.owner === userId) return true;

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }
  return false;
}
