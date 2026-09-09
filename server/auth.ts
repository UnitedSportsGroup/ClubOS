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
 * May this person send money back to a customer's card?
 *
 * 🔴 Reads ONE explicit per-person flag and nothing else. There is deliberately
 * no role bypass — not even super_admin:
 *
 *   - `canAccessTab` grants an admin/manager member EVERY tab in a workspace
 *     they belong to, so a tab check would let any workspace admin refund.
 *   - `users.role` defaults to 'coach', which every public fan signup receives.
 *   - "Super admin" is a standing capability, not a named person. A refund is a
 *     named act that has to be attributable to somebody who was chosen for it.
 *
 * A super admin who needs to refund grants themselves the flag in /admin/team,
 * which leaves a record of the decision. That is the point.
 *
 * The user is re-read from the database on every call rather than trusted from
 * the session, so revoking the flag takes effect on the next request instead of
 * whenever that person happens to log out.
 */
export function requireRefundPermission(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  storage.getUser(req.session.userId).then(user => {
    if (!user || !user.active || !user.canIssueRefunds) {
      return res.status(403).json({
        message: "You don't have permission to issue refunds. Ask a super admin to enable it for you in Team.",
      });
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

      // 🔴 THE HEADER IS REQUIRED OF EVERYONE, SUPER ADMINS INCLUDED.
      //
      // Daniel, 2026-09-10: "I ship features, think the work is done, but
      // actually only i can see it and no one else. big problem."
      //
      // This check used to sit BELOW the super_admin short-circuit, and that one
      // line of ordering is the whole bug. A page that called a tab-gated
      // endpoint without X-Workspace-Slug answered 200 with real data for Daniel
      // and 400 for every member of staff — and the page rendered that 400 as
      // zeros, so it did not even look broken. It is how the Grant Funding page
      // showed him 52 funders and Ryan "Funders tracked 0", and how the Contacts
      // tab shipped blank for all of staff: it worked for the only person who
      // could never hit the bug.
      //
      // Now the super admin hits it first, on his own screen, the moment the
      // page is opened. A super admin still bypasses the MEMBERSHIP and TAB
      // checks below — that is what being a super admin means — but not this,
      // because this is the one check whose absence is invisible to him.
      //
      // Guarded statically too: script/check-workspace-fetch.mjs fails the build
      // on a bare fetch() to any tab-gated endpoint.
      const workspaceSlug = (req.headers["x-workspace-slug"] as string | undefined) || "";
      if (!workspaceSlug) {
        return res.status(400).json({
          message:
            "X-Workspace-Slug header required. Use workspaceFetch() or apiRequest() from @/lib/queryClient — a bare fetch() works for a super admin and 400s for everybody else.",
        });
      }

      if (user.role === "super_admin") return next();

      const orgs = await storage.getUserOrganizations(req.session.userId);
      const membership = orgs.find(o => o.slug === workspaceSlug);
      if (!membership) {
        return res.status(403).json({ message: "No access to this workspace" });
      }
      const allowed = canAccessTab({
        globalRole: user.role,
        membershipRole: membership.userRole,
        membershipTabs: membership.userTabs,
        membershipUnlockedTabs: membership.userUnlockedTabs,
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
