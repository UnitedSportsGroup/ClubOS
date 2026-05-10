import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { storage } from "./storage";
import { canAccessTab } from "../shared/tabs";

const PgSession = connectPgSimple(session);

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

export function setupAuth(app: any) {
  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "cufc-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    })
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  storage.getUser(req.session.userId).then(user => {
    if (!user || user.role !== "super_admin") {
      return res.status(403).json({ message: "Super Admin access required" });
    }
    next();
  }).catch(() => res.status(500).json({ message: "Auth check failed" }));
}

/**
 * Tab-level enforcement. Reads X-Workspace-Slug from the request to know which
 * org's tab access to check. Returns 403 if the user doesn't have the tab
 * granted in that workspace. Bypass cases: super_admin role globally, admin or
 * manager role within the workspace, or null tabs (legacy full access).
 *
 * Usage:
 *   app.get("/api/admin/sponsorship/deals", requireAuth, requireTab("sponsorship"), handler)
 */
export function requireTab(tabSlug: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role === "super_admin") return next();

      const workspaceSlug = (req.headers["x-workspace-slug"] as string | undefined) || "";
      if (!workspaceSlug) {
        return res.status(400).json({ message: "X-Workspace-Slug header required" });
      }
      const orgs = await storage.getUserOrganizations(req.session.userId);
      const membership = orgs.find(o => o.slug === workspaceSlug);
      if (!membership) {
        return res.status(403).json({ message: "No access to this workspace" });
      }
      const allowed = canAccessTab({
        globalRole: user.role,
        membershipRole: membership.userRole,
        membershipTabs: membership.userTabs,
        tabSlug,
      });
      if (!allowed) {
        return res.status(403).json({ message: `Tab "${tabSlug}" access denied` });
      }
      next();
    } catch (err: any) {
      console.error("[requireTab] error:", err);
      res.status(500).json({ message: "Tab check failed" });
    }
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
