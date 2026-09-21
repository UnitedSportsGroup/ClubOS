/**
 * A vehicle's history: who held it, and the stretches when nobody did.
 *
 * 🔴 THE ALGORITHM LIVES IN @shared/occupancy-timeline AND IS SHARED WITH THE
 * RESIDENCY. A vehicle assignment and a room tenancy are the same shape — a
 * holder, a start, an optional end — and the interesting part is identical: the
 * gaps between them, and the off-by-one at a same-day handover. This file is
 * the vehicle's vocabulary over that one algorithm, nothing more.
 *
 * 🔴 IT NEVER INVENTS A LOCATION. A gap reads the vehicle's `parkedLocation`
 * when a human has set one, and says nothing when they have not. The club has
 * vehicles that do not live at United Sports Centre, and a guessed address on a
 * historical gap is the sort of thing an insurer later quotes back.
 */
import { occupancyTimeline, type HeldPeriod, type OccupancySegment } from "./occupancy-timeline";

export interface AssignmentLike {
  id: number;
  holderName: string;
  holderUserId?: number | null;
  driverId?: number | null;
  assignedOn: string;
  returnedOn?: string | null;
  purpose?: string | null;
  odometerStartKm?: number | null;
  odometerEndKm?: number | null;
}

export type VehicleSegment =
  | (Extract<OccupancySegment, { kind: "held" }> & {
      assignmentId: number;
      holderUserId: number | null;
      driverId: number | null;
      purpose: string | null;
      odometerStartKm: number | null;
      odometerEndKm: number | null;
    })
  | (Extract<OccupancySegment, { kind: "empty" }> & {
      /** The vehicle's recorded parking place, or null when nobody has said. */
      parkedLocation: string | null;
    });

export function vehicleTimeline(
  assignments: AssignmentLike[],
  parkedLocation: string | null | undefined,
  todayIso: string,
): VehicleSegment[] {
  const periods: HeldPeriod[] = assignments.map((a) => ({
    id: a.id,
    holderName: a.holderName,
    from: a.assignedOn,
    to: a.returnedOn ?? null,
    meta: {
      holderUserId: a.holderUserId ?? null,
      driverId: a.driverId ?? null,
      purpose: a.purpose ?? null,
      odometerStartKm: a.odometerStartKm ?? null,
      odometerEndKm: a.odometerEndKm ?? null,
    },
  }));

  const park = typeof parkedLocation === "string" && parkedLocation.trim() ? parkedLocation.trim() : null;

  return occupancyTimeline(periods, todayIso).map((s): VehicleSegment => {
    if (s.kind === "empty") return { ...s, parkedLocation: park };
    return {
      ...s,
      assignmentId: s.id,
      holderUserId: (s.meta.holderUserId as number | null) ?? null,
      driverId: (s.meta.driverId as number | null) ?? null,
      purpose: (s.meta.purpose as string | null) ?? null,
      odometerStartKm: (s.meta.odometerStartKm as number | null) ?? null,
      odometerEndKm: (s.meta.odometerEndKm as number | null) ?? null,
    };
  });
}

export { holderNow as currentHolder } from "./occupancy-timeline";
