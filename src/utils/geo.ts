import type {
  DistanceUnit,
  GuideTarget,
  RunRecord,
  TrackPoint,
} from '../types/run';

const EARTH_RADIUS_M = 6371000;
export const METERS_PER_MILE = 1609.344;

const CURATED_LEG_COLORS = [
  '#EA580C', // 0: Vibrant Orange
  '#2563EB', // 1: Royal Blue
  '#059669', // 2: Emerald Green
  '#9333EA', // 3: Vivid Purple
  '#DC2626', // 4: Crimson Red
  '#0891B2', // 5: Deep Cyan
  '#D97706', // 6: Amber Gold
  '#DB2777', // 7: Magenta Rose
  '#4F46E5', // 8: Indigo
  '#15803D', // 9: Forest Green
];

export function getLegColor(legIndex: number): string {
  const safeIdx = Math.max(0, Math.floor(legIndex));
  if (safeIdx < CURATED_LEG_COLORS.length) {
    return CURATED_LEG_COLORS[safeIdx];
  }
  // Golden-angle HSL rotation for unlimited distinct colors on many turn-backs
  const hue = Math.round((safeIdx * 137.508 + 25) % 360);
  return `hsl(${hue}, 82%, 44%)`;
}

export function computeBearingDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function angleDiffDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export interface ColoredLegSegment {
  legIndex: number;
  color: string;
  latLngs: [number, number][];
  isPauseGap?: boolean;
}

export function chaikinSmoothCoords(
  coords: [number, number][],
  iterations = 2
): [number, number][] {
  if (coords.length <= 2) return coords;
  let current = coords;
  for (let iter = 0; iter < iterations; iter++) {
    const next: [number, number][] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const [lat1, lng1] = current[i];
      const [lat2, lng2] = current[i + 1];
      next.push([lat1 * 0.75 + lat2 * 0.25, lng1 * 0.75 + lng2 * 0.25]);
      next.push([lat1 * 0.25 + lat2 * 0.75, lng1 * 0.25 + lng2 * 0.75]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

export function buildColoredLegSegments(
  points: {
    lat: number;
    lng: number;
    legIndex?: number;
    isPauseGapStart?: boolean;
  }[],
  colorOffset = 0
): ColoredLegSegment[] {
  if (points.length === 0) return [];
  const rawSegments: {
    legIndex: number;
    coords: [number, number][];
    isPauseGap?: boolean;
  }[] = [];

  let activeLeg = points[0].legIndex ?? 0;
  let currentCoords: [number, number][] = [[points[0].lat, points[0].lng]];

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const prevPt = points[i - 1];
    const leg = pt.legIndex ?? 0;
    const coord: [number, number] = [pt.lat, pt.lng];

    if (pt.isPauseGapStart) {
      if (currentCoords.length > 0) {
        rawSegments.push({
          legIndex: activeLeg,
          coords: currentCoords,
        });
      }
      // Dotted gap bridge between the point where user paused and where user resumed
      rawSegments.push({
        legIndex: leg,
        coords: [[prevPt.lat, prevPt.lng], coord],
        isPauseGap: true,
      });
      activeLeg = leg;
      currentCoords = [coord];
    } else if (leg !== activeLeg) {
      if (currentCoords.length > 0) {
        rawSegments.push({
          legIndex: activeLeg,
          coords: currentCoords,
        });
      }
      activeLeg = leg;
      currentCoords = [[prevPt.lat, prevPt.lng], coord];
    } else {
      currentCoords.push(coord);
    }
  }

  if (currentCoords.length > 0) {
    rawSegments.push({
      legIndex: activeLeg,
      coords: currentCoords,
    });
  }

  return rawSegments.map((seg) => {
    if (seg.isPauseGap) {
      return {
        legIndex: seg.legIndex,
        color: '#475569',
        latLngs: seg.coords,
        isPauseGap: true,
      };
    }
    const iters =
      seg.coords.length > 350 ? 1 : seg.coords.length > 120 ? 2 : 3;
    return {
      legIndex: seg.legIndex,
      color: getLegColor(seg.legIndex + colorOffset),
      latLngs: chaikinSmoothCoords(seg.coords, iters),
      isPauseGap: false,
    };
  });
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function pointToSegmentMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const cosLat = Math.cos((pLat * Math.PI) / 180);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * cosLat;

  const px = (pLng - aLng) * metersPerDegLng;
  const py = (pLat - aLat) * metersPerDegLat;
  const bx = (bLng - aLng) * metersPerDegLng;
  const by = (bLat - aLat) * metersPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq < 1e-6) {
    return Math.hypot(px, py);
  }
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const projX = t * bx;
  const projY = t * by;
  return Math.hypot(px - projX, py - projY);
}

export function isNearVisitedRoute(
  lat: number,
  lng: number,
  currentPoints: { lat: number; lng: number; legIndex?: number }[],
  pastRuns: { points: { lat: number; lng: number }[] }[] = [],
  thresholdMeters = 12,
  selfTrailExclusionMeters = 50,
  minExcursionMeters = 30,
  currentLegIndex?: number
): boolean {
  // Fast degree bounding filter (~35m)
  const degPad = 0.00035;

  // 1. Optional past saved runs check (empty by default so invisible past runs don't recolor a straight run)
  for (let r = 0; r < pastRuns.length; r++) {
    const pts = pastRuns[r].points;
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      if (
        Math.abs(lat - pts[0].lat) < degPad &&
        Math.abs(lng - pts[0].lng) < degPad &&
        haversineMeters(lat, lng, pts[0].lat, pts[0].lng) <= thresholdMeters
      ) {
        return true;
      }
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const minLat = Math.min(a.lat, b.lat) - degPad;
      const maxLat = Math.max(a.lat, b.lat) + degPad;
      const minLng = Math.min(a.lng, b.lng) - degPad;
      const maxLng = Math.max(a.lng, b.lng) + degPad;
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
        continue;
      }
      if (
        pointToSegmentMeters(lat, lng, a.lat, a.lng, b.lat, b.lng) <=
        thresholdMeters
      ) {
        return true;
      }
    }
  }

  // 2. Check earlier segments of the current run.
  // Walking backward from the latest point, only check segments where EITHER:
  // (a) the segment belongs to an earlier leg (and is >= 10m away from the leg transition), OR
  // (b) the runner traveled >= selfTrailExclusionMeters AND moved >= minExcursionMeters away in between.
  if (currentPoints.length >= 4) {
    let trailingDist = 0;
    let maxExcursion = 0;
    const activeLeg =
      currentLegIndex ??
      currentPoints[currentPoints.length - 1].legIndex ??
      0;

    for (let i = currentPoints.length - 1; i >= 1; i--) {
      const a = currentPoints[i - 1];
      const b = currentPoints[i];
      const stepDist = haversineMeters(a.lat, a.lng, b.lat, b.lng);
      trailingDist += stepDist;

      const distB = haversineMeters(lat, lng, b.lat, b.lng);
      if (distB > maxExcursion) {
        maxExcursion = distB;
      }

      const segLeg = a.legIndex ?? 0;
      const isEarlierLeg = segLeg < activeLeg;

      const eligibleByEarlierLeg = isEarlierLeg && trailingDist >= 6;
      const eligibleByLoop =
        trailingDist >= selfTrailExclusionMeters &&
        maxExcursion >= minExcursionMeters;

      if (!eligibleByEarlierLeg && !eligibleByLoop) {
        continue;
      }

      const minLat = Math.min(a.lat, b.lat) - degPad;
      const maxLat = Math.max(a.lat, b.lat) + degPad;
      const minLng = Math.min(a.lng, b.lng) - degPad;
      const maxLng = Math.max(a.lng, b.lng) + degPad;
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
        continue;
      }
      if (
        pointToSegmentMeters(lat, lng, a.lat, a.lng, b.lat, b.lng) <=
        thresholdMeters
      ) {
        return true;
      }
    }
  }

  return false;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function formatDistance(meters: number, unit: DistanceUnit): string {
  const value = unit === 'mi' ? meters / METERS_PER_MILE : meters / 1000;
  return value.toFixed(2);
}

export function formatSpeed(kmh: number, unit: DistanceUnit): string {
  if (!Number.isFinite(kmh) || kmh <= 0.1) return '0.0';
  const value = unit === 'mi' ? kmh * 0.621371 : kmh;
  return value.toFixed(1);
}

export function formatPace(secPerKm: number, unit: DistanceUnit): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 1800) {
    return '--:--';
  }
  const adjusted = unit === 'mi' ? secPerKm * 1.609344 : secPerKm;
  const mins = Math.floor(adjusted / 60);
  const secs = Math.round(adjusted % 60);
  if (secs === 60) {
    return `${mins + 1}:00`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function estimateCalories(
  distanceMeters: number,
  durationMs: number,
  weightKg: number
): number {
  const km = distanceMeters / 1000;
  if (km <= 0.01 || durationMs <= 0) return 0;
  // Standard running energy cost: ~1.036 kcal per kg per km
  return Math.round(weightKg * km * 1.036);
}

export function getDefaultRunTitle(startedAt: number): string {
  const date = new Date(startedAt);
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Morning Run';
  if (hour >= 12 && hour < 17) return 'Afternoon Run';
  if (hour >= 17 && hour < 21) return 'Evening Run';
  return 'Night Run';
}

export function playMilestoneChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [587.33, 880]; // D5 -> A5 crisp chime
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.11);
      gain.gain.setValueAtTime(0.001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.14, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.3);
    });
  } catch {
    // Audio playback blocked or unavailable; silently ignore
  }
}

export function generateGPX(run: RunRecord): string {
  const escapeXml = (s: string) =>
    s.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case "'":
          return '&apos;';
        case '"':
          return '&quot;';
        default:
          return c;
      }
    });

  const trkpts = run.points
    .map((pt) => {
      const ele =
        pt.altitude !== null ? `<ele>${pt.altitude.toFixed(1)}</ele>` : '';
      return `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">${ele}<time>${new Date(pt.timestamp).toISOString()}</time></trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PaceTrail" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(run.title)}</name>
    <time>${new Date(run.startedAt).toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(run.title)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export interface RouteGuidanceInfo {
  target: GuideTarget;
  totalRouteMeters: number;
  remainingMeters: number;
  remainingRouteMeters: number;
  offRouteMeters: number;
  directToTargetMeters: number;
  progressPct: number;
  isOffRoute: boolean;
  arrived: boolean;
  snappedPoint: [number, number];
  targetPoint: [number, number];
  remainingCoords: [number, number][];
  compassLabel: string;
  directionHint: string;
  etaSeconds: number | null;
}

export function bearingToCompassLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export function formatEtaDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }
  const rounded = Math.round(seconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function computeRouteGuidance(
  routePoints: TrackPoint[],
  target: GuideTarget,
  currentLocation: TrackPoint | null,
  liveSpeedKmh: number,
  avgSpeedKmh: number
): RouteGuidanceInfo | null {
  if (routePoints.length === 0) return null;

  const ordered =
    target === 'B' ? routePoints : routePoints.slice().reverse();

  // Compute cumulative distance along ordered route
  const cumDist: number[] = [0];
  for (let i = 1; i < ordered.length; i++) {
    cumDist.push(
      cumDist[i - 1] +
        haversineMeters(
          ordered[i - 1].lat,
          ordered[i - 1].lng,
          ordered[i].lat,
          ordered[i].lng
        )
    );
  }
  const totalRouteMeters = cumDist[cumDist.length - 1];
  const destPt = ordered[ordered.length - 1];
  const targetPoint: [number, number] = [destPt.lat, destPt.lng];

  if (!currentLocation) {
    return {
      target,
      totalRouteMeters,
      remainingMeters: totalRouteMeters,
      remainingRouteMeters: totalRouteMeters,
      offRouteMeters: 0,
      directToTargetMeters: totalRouteMeters,
      progressPct: 0,
      isOffRoute: false,
      arrived: false,
      snappedPoint: [ordered[0].lat, ordered[0].lng],
      targetPoint,
      remainingCoords: ordered.map((p) => [p.lat, p.lng]),
      compassLabel: '--',
      directionHint: `Waiting for GPS to guide to Point ${target}`,
      etaSeconds: null,
    };
  }

  const directToTargetMeters = haversineMeters(
    currentLocation.lat,
    currentLocation.lng,
    destPt.lat,
    destPt.lng
  );
  const arrived = directToTargetMeters <= 15;

  // Find closest point along the ordered route polyline
  let bestSegIdx = 0;
  let bestT = 0;
  let minOffRouteMeters = Infinity;
  let bestSnapped: [number, number] = [ordered[0].lat, ordered[0].lng];
  let bestAlongDist = 0;

  if (ordered.length === 1) {
    minOffRouteMeters = directToTargetMeters;
    bestSnapped = targetPoint;
    bestAlongDist = 0;
  } else {
    const cosLat = Math.cos((currentLocation.lat * Math.PI) / 180);
    const mLat = 111320;
    const mLng = 111320 * cosLat;

    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1];
      const b = ordered[i];
      const px = (currentLocation.lng - a.lng) * mLng;
      const py = (currentLocation.lat - a.lat) * mLat;
      const bx = (b.lng - a.lng) * mLng;
      const by = (b.lat - a.lat) * mLat;
      const lenSq = bx * bx + by * by;
      const t =
        lenSq < 1e-6
          ? 0
          : Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
      const snapLat = a.lat + (b.lat - a.lat) * t;
      const snapLng = a.lng + (b.lng - a.lng) * t;
      const dist = haversineMeters(
        currentLocation.lat,
        currentLocation.lng,
        snapLat,
        snapLng
      );
      if (dist < minOffRouteMeters) {
        minOffRouteMeters = dist;
        bestSegIdx = i;
        bestT = t;
        bestSnapped = [snapLat, snapLng];
        const segLen = cumDist[i] - cumDist[i - 1];
        bestAlongDist = cumDist[i - 1] + t * segLen;
      }
    }
  }

  const remainingRouteMeters = arrived
    ? 0
    : Math.max(0, totalRouteMeters - bestAlongDist);
  const isOffRoute = !arrived && minOffRouteMeters > 25;

  // If runner is near the route, remaining distance is along the path;
  // if approaching from off-route, include approach distance to rejoin the trail
  const remainingMeters = arrived
    ? 0
    : minOffRouteMeters <= 25
      ? remainingRouteMeters
      : minOffRouteMeters + remainingRouteMeters;

  const progressPct =
    arrived || totalRouteMeters < 1
      ? arrived
        ? 100
        : 0
      : Math.min(100, Math.max(0, (bestAlongDist / totalRouteMeters) * 100));

  // Build sliced remaining coordinates from snapped point to target
  const remainingCoords: [number, number][] = arrived
    ? [targetPoint]
    : [
        bestSnapped,
        ...ordered
          .slice(bestT >= 0.99 ? bestSegIdx + 1 : bestSegIdx)
          .map((p): [number, number] => [p.lat, p.lng]),
      ];

  // Compute lookahead point (~22m ahead along the route) for directional instruction
  let guideLookahead: [number, number] = targetPoint;
  if (!arrived && !isOffRoute && ordered.length > 1) {
    const lookaheadTargetDist = Math.min(totalRouteMeters, bestAlongDist + 22);
    for (let i = Math.max(1, bestSegIdx); i < ordered.length; i++) {
      if (cumDist[i] >= lookaheadTargetDist) {
        const segLen = Math.max(0.01, cumDist[i] - cumDist[i - 1]);
        const frac = Math.max(
          0,
          Math.min(1, (lookaheadTargetDist - cumDist[i - 1]) / segLen)
        );
        guideLookahead = [
          ordered[i - 1].lat + (ordered[i].lat - ordered[i - 1].lat) * frac,
          ordered[i - 1].lng + (ordered[i].lng - ordered[i - 1].lng) * frac,
        ];
        break;
      }
    }
  } else if (isOffRoute) {
    guideLookahead = bestSnapped;
  }

  const targetBearing = computeBearingDeg(
    currentLocation.lat,
    currentLocation.lng,
    guideLookahead[0],
    guideLookahead[1]
  );
  const compassLabel = bearingToCompassLabel(targetBearing);

  let directionHint = '';
  if (arrived) {
    directionHint = `Arrived at Point ${target}`;
  } else if (isOffRoute) {
    directionHint = `Head ${compassLabel} (${Math.round(minOffRouteMeters)}m) to join route`;
  } else if (
    currentLocation.heading !== null &&
    currentLocation.heading !== undefined &&
    Number.isFinite(currentLocation.heading) &&
    (currentLocation.speedMps ?? 0) > 0.6
  ) {
    const delta = ((targetBearing - currentLocation.heading + 540) % 360) - 180;
    if (Math.abs(delta) <= 25) {
      directionHint = `Continue straight (${compassLabel})`;
    } else if (delta > 25 && delta <= 70) {
      directionHint = `Bear right (${compassLabel})`;
    } else if (delta > 70 && delta <= 135) {
      directionHint = `Turn right (${compassLabel})`;
    } else if (delta < -25 && delta >= -70) {
      directionHint = `Bear left (${compassLabel})`;
    } else if (delta < -70 && delta >= -135) {
      directionHint = `Turn left (${compassLabel})`;
    } else {
      directionHint = `Turn around toward ${compassLabel}`;
    }
  } else {
    directionHint = `Follow route ${compassLabel} to Point ${target}`;
  }

  const activeSpeedKmh =
    liveSpeedKmh > 1.0
      ? liveSpeedKmh
      : avgSpeedKmh > 1.0
        ? avgSpeedKmh
        : 0;
  const etaSeconds =
    arrived
      ? 0
      : activeSpeedKmh > 0.5
        ? remainingMeters / (activeSpeedKmh / 3.6)
        : null;

  return {
    target,
    totalRouteMeters,
    remainingMeters,
    remainingRouteMeters,
    offRouteMeters: minOffRouteMeters,
    directToTargetMeters,
    progressPct,
    isOffRoute,
    arrived,
    snappedPoint: bestSnapped,
    targetPoint,
    remainingCoords,
    compassLabel,
    directionHint,
    etaSeconds,
  };
}

export function resampleGuideWaypoints(
  routePoints: TrackPoint[],
  target: GuideTarget,
  stepMeters = 4
): [number, number][] {
  if (routePoints.length === 0) return [];
  const ordered = target === 'B' ? routePoints : routePoints.slice().reverse();
  if (ordered.length === 1) {
    return [[ordered[0].lat, ordered[0].lng]];
  }
  const smoothed = chaikinSmoothCoords(
    ordered.map((p): [number, number] => [p.lat, p.lng]),
    ordered.length > 200 ? 1 : 2
  );
  const out: [number, number][] = [smoothed[0]];
  for (let i = 1; i < smoothed.length; i++) {
    const a = smoothed[i - 1];
    const b = smoothed[i];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    if (segLen < 0.5) continue;
    const steps = Math.max(1, Math.round(segLen / stepMeters));
    for (let s = 1; s <= steps; s++) {
      const frac = s / steps;
      out.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
    }
  }
  return out;
}
