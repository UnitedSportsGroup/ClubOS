// Sunrise / sunset calculation for the facility floodlight feed.
//
// We need to know, per booking date, when it's dark at the venue so the
// floodlight iCal feed only fires lights when actually needed. Self-contained
// (no external API) using the well-validated SunCalc algorithm. Returns local
// wall-clock times in the venue timezone — DST handled by Intl, so NZDT/NZST
// transitions are automatic.

// United Sports Centre, Christchurch NZ. Sunset varies by only seconds across
// the city, so approximate coordinates are fine for lighting decisions.
export const VENUE_LAT = -43.5321;
export const VENUE_LNG = 172.6362;
export const VENUE_TZ = "Pacific/Auckland";

const rad = Math.PI / 180;
const dayMs = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the ecliptic

function toJulian(date: Date): number { return date.valueOf() / dayMs - 0.5 + J1970; }
function fromJulian(j: number): Date { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date: Date): number { return toJulian(date) - J2000; }

function solarMeanAnomaly(d: number): number { return rad * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M: number): number {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372; // perihelion of the Earth
  return M + C + P + Math.PI;
}
function declination(l: number): number { return Math.asin(Math.sin(e) * Math.sin(l)); }

const J0 = 0.0009;
function julianCycle(d: number, lw: number): number { return Math.round(d - J0 - lw / (2 * Math.PI)); }
function approxTransit(Ht: number, lw: number, n: number): number { return J0 + (Ht + lw) / (2 * Math.PI) + n; }
function solarTransitJ(ds: number, M: number, L: number): number { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }
function hourAngle(h: number, phi: number, d: number): number {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
}

function sunTimesUTC(date: Date, lat: number, lng: number): { sunrise: Date; sunset: Date } | null {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);
  const h0 = -0.833 * rad; // standard sunrise/sunset altitude (refraction + solar disc)
  const cosArg = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosArg < -1 || cosArg > 1) return null; // polar day/night — never at Christchurch
  const w = Math.acos(cosArg);
  const a = approxTransit(w, lw, n);
  const Jset = solarTransitJ(a, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

function localHHMM(instant: Date, timeZone: string): string {
  // en-GB → 24h "HH:MM", midnight as "00:00".
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant);
}

/**
 * Sunrise/sunset as local wall-clock "HH:MM" in the venue timezone for a
 * given calendar date "YYYY-MM-DD". Returns null if the sun never rises/sets
 * (not possible at the venue latitude, but guarded).
 */
export function sunriseSunsetLocal(
  dateYMD: string,
  lat = VENUE_LAT,
  lng = VENUE_LNG,
  timeZone = VENUE_TZ,
): { sunrise: string; sunset: string } | null {
  // Anchor at UTC midnight of the date. For NZ (UTC+12/13) this lands at local
  // noon-ish of the same date, so SunCalc resolves the correct solar day.
  const anchor = new Date(`${dateYMD}T00:00:00Z`);
  if (isNaN(anchor.valueOf())) return null;
  const t = sunTimesUTC(anchor, lat, lng);
  if (!t || isNaN(t.sunrise.valueOf()) || isNaN(t.sunset.valueOf())) return null;
  return { sunrise: localHHMM(t.sunrise, timeZone), sunset: localHHMM(t.sunset, timeZone) };
}
