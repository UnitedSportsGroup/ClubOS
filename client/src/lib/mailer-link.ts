// "Email this person" — the link from a Contacts row or a profile into the
// Mailer, with the person already on the list (`/admin/mailer?to=<key>`).
//
// 🔴 The link only exists where it leads somewhere: the workspace must carry
// the Mailer tab (tabsForOrgSlug) AND this person must be able to reach it
// (the same canAccessTab call the sidebar makes). A button to a page the
// person cannot open is a dead end dressed as a feature.
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/lib/workspace-context";
import { canAccessTab, tabsForOrgSlug } from "@shared/tabs";

/** The Mailer link for a person key, or null when the Mailer is out of reach here. */
export function useMailerLink(): ((personKey: string) => string) | null {
  const { currentOrg } = useWorkspace();
  const { data: me } = useQuery<{ role?: string | null }>({ queryKey: ["/api/auth/me"] });
  if (!currentOrg) return null;
  if (!tabsForOrgSlug(currentOrg.slug).some((t) => t.slug === "mailer")) return null;
  const ok = canAccessTab({
    globalRole: me?.role,
    membershipRole: currentOrg.userRole,
    membershipTabs: currentOrg.userTabs,
    membershipUnlockedTabs: currentOrg.userUnlockedTabs,
    tabSlug: "mailer",
  });
  return ok ? (key: string) => `/admin/mailer?to=${encodeURIComponent(key)}` : null;
}
