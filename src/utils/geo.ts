import type { DistanceUnit, RunRecord } from '../types/run';

const EARTH_RADIUS_M = 6371000;
export const METERS_PER_MILE = 1609.344;

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
