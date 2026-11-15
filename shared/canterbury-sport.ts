/**
 * Canterbury Sport — who may open the land company's numbers.
 *
 * 🔴 The tab is in SUPER_ADMIN_ONLY_TABS AND this list. A super-admin lock alone lets EVERY super admin in, and there
 * are two (Daniel and Slava). Daniel, 2026-11-11: "only give me access to it for now." To add someone, add their
 * ClubOS user id here and deploy — the server re-checks it on every request.
 */
export const CANTERBURY_SPORT_TAB = "canterbury-sport";
export const CANTERBURY_SPORT_USER_IDS: readonly number[] = [1]; // 1 = daniel@cufc.co.nz
export function canSeeCanterburySport(userId: number | null | undefined): boolean {
  return userId != null && CANTERBURY_SPORT_USER_IDS.includes(Number(userId));
}
