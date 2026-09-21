/**
 * WHICH programmes a person may refund — the one place that is decided.
 *
 * Daniel, 2026-09-21, of Zach: "he needs access to refund just holiday camps
 * not pre academy academy or other programs but just holiday camps and U4-U8
 * where he is the main coordinator."
 *
 * 🔴 `canIssueRefunds` is still the master switch and is checked first
 * elsewhere. This answers the narrower question, and it FAILS CLOSED: anything
 * it cannot positively place is refused.
 *
 * 🔴 BOTH LISTS NULL MEANS EVERY PROGRAMME. That is what the four people who
 * already hold refund rights have, so nothing changed for them when this
 * shipped. Narrowing somebody is deliberate.
 *
 * 🔴 KINDS AND IDS ARE BOTH NEEDED. A kind covers a recurring class — every
 * holiday camp, including ones created next term, which an id list would
 * silently miss. An id covers a named exception like U4–U8, which shares its
 * kind ("academy") with the two programmes Zach must NOT be able to refund.
 */
import { programmeKind, type ProgrammeLike } from "./programme-kinds";

export interface RefundScope {
  /** e.g. ["camp"] — every programme of these kinds. Null = unrestricted. */
  kinds?: string[] | null;
  /** e.g. [4] — these programmes by id, whatever their kind. Null = none extra. */
  programIds?: number[] | null;
}

const list = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

/** True when this scope places no restriction at all. */
export function isUnrestricted(scope: RefundScope | null | undefined): boolean {
  if (!scope) return true;
  return list(scope.kinds) === null && list(scope.programIds) === null;
}

/**
 * May this person refund this programme?
 *
 * @param program the programme the registration is for. A MISSING programme is
 *   refused unless the scope is unrestricted — we cannot place it, and a refund
 *   moves real money.
 */
export function canRefundProgramme(
  scope: RefundScope | null | undefined,
  program: (ProgrammeLike & { id?: number | null }) | null | undefined,
): boolean {
  if (isUnrestricted(scope)) return true;
  if (!program) return false;

  const ids = list(scope?.programIds) as number[] | null;
  if (ids && program.id != null && ids.some((n) => Number(n) === Number(program.id))) return true;

  const kinds = list(scope?.kinds) as string[] | null;
  if (kinds && kinds.includes(programmeKind(program))) return true;

  return false;
}

/** A sentence for the 403, so the person knows what to ask for. */
export function refundScopeLabel(scope: RefundScope | null | undefined): string {
  if (isUnrestricted(scope)) return "every programme";
  const parts: string[] = [];
  const kinds = list(scope?.kinds) as string[] | null;
  const ids = list(scope?.programIds) as number[] | null;
  if (kinds?.length) parts.push(kinds.map((k) => (k === "camp" ? "holiday camps" : `${k} programmes`)).join(", "));
  if (ids?.length) parts.push(`${ids.length} named programme${ids.length === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" and ") : "no programmes";
}
