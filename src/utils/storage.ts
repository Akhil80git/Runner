import type { ActiveRunDraft, RunRecord, UserSettings } from '../types/run';

const RUNS_KEY = 'pacetrail_runs_v1';
const ACTIVE_RUN_KEY = 'pacetrail_active_run_v1';
const SETTINGS_KEY = 'pacetrail_settings_v1';

export const DEFAULT_SETTINGS: UserSettings = {
  unit: 'km',
  weightKg: 70,
  weeklyGoalKm: 25,
  soundCues: true,
  mapStyle: 'standard',
  autoCenter: true,
  autoColorVisited: true,
};

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      unit: parsed.unit === 'mi' ? 'mi' : 'km',
      weightKg:
        typeof parsed.weightKg === 'number' && parsed.weightKg >= 30 && parsed.weightKg <= 250
          ? parsed.weightKg
          : DEFAULT_SETTINGS.weightKg,
      weeklyGoalKm:
        typeof parsed.weeklyGoalKm === 'number' && parsed.weeklyGoalKm >= 1 && parsed.weeklyGoalKm <= 500
          ? parsed.weeklyGoalKm
          : DEFAULT_SETTINGS.weeklyGoalKm,
      soundCues:
        typeof parsed.soundCues === 'boolean'
          ? parsed.soundCues
          : DEFAULT_SETTINGS.soundCues,
      mapStyle:
        parsed.mapStyle === 'standard' ||
        parsed.mapStyle === 'topo' ||
        parsed.mapStyle === 'dark'
          ? parsed.mapStyle
          : DEFAULT_SETTINGS.mapStyle,
      autoCenter:
        typeof parsed.autoCenter === 'boolean'
          ? parsed.autoCenter
          : DEFAULT_SETTINGS.autoCenter,
      autoColorVisited:
        typeof parsed.autoColorVisited === 'boolean'
          ? parsed.autoColorVisited
          : DEFAULT_SETTINGS.autoColorVisited,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadRuns(): RunRecord[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RunRecord =>
          Boolean(item) &&
          typeof item.id === 'string' &&
          typeof item.startedAt === 'number' &&
          Array.isArray(item.points)
      )
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export function saveRuns(runs: RunRecord[]): boolean {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
    return true;
  } catch {
    return false;
  }
}

export function addRun(run: RunRecord): RunRecord[] {
  const existing = loadRuns();
  const next = [run, ...existing.filter((r) => r.id !== run.id)];
  saveRuns(next);
  return next;
}

export function deleteRun(id: string): RunRecord[] {
  const next = loadRuns().filter((r) => r.id !== id);
  saveRuns(next);
  return next;
}

export function updateRunDetails(
  id: string,
  updates: { title?: string; notes?: string }
): RunRecord[] {
  const next = loadRuns().map((r) =>
    r.id === id
      ? {
          ...r,
          title: updates.title !== undefined ? updates.title : r.title,
          notes: updates.notes !== undefined ? updates.notes : r.notes,
        }
      : r
  );
  saveRuns(next);
  return next;
}

export function clearAllRuns(): void {
  try {
    localStorage.removeItem(RUNS_KEY);
  } catch {
    // Ignore
  }
}

export function loadActiveRun(): ActiveRunDraft | null {
  try {
    const raw = localStorage.getItem(ACTIVE_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRunDraft;
    if (
      !parsed ||
      typeof parsed.id !== 'string' ||
      !Array.isArray(parsed.points)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveRun(draft: ActiveRunDraft | null): void {
  try {
    if (!draft) {
      localStorage.removeItem(ACTIVE_RUN_KEY);
    } else {
      localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(draft));
    }
  } catch {
    // Ignore quota errors
  }
}

export function getLocalStorageStats(): {
  runCount: number;
  usedKB: number;
} {
  try {
    let bytes = 0;
    for (const key of [RUNS_KEY, ACTIVE_RUN_KEY, SETTINGS_KEY]) {
      const val = localStorage.getItem(key);
      if (val) bytes += val.length * 2;
    }
    return {
      runCount: loadRuns().length,
      usedKB: Math.max(1, Math.round(bytes / 1024)),
    };
  } catch {
    return { runCount: 0, usedKB: 0 };
  }
}

export function importRunsFromJSON(jsonText: string): {
  imported: number;
  runs: RunRecord[];
} {
  const parsed = JSON.parse(jsonText);
  const incoming: RunRecord[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.runs)
      ? parsed.runs
      : [];
  const valid = incoming.filter(
    (item): item is RunRecord =>
      Boolean(item) &&
      typeof item.id === 'string' &&
      typeof item.startedAt === 'number' &&
      Array.isArray(item.points)
  );
  if (valid.length === 0) {
    throw new Error('No valid run records found in JSON.');
  }
  const existing = loadRuns();
  const map = new Map<string, RunRecord>();
  for (const r of existing) map.set(r.id, r);
  for (const r of valid) map.set(r.id, r);
  const merged = Array.from(map.values()).sort(
    (a, b) => b.startedAt - a.startedAt
  );
  saveRuns(merged);
  return { imported: valid.length, runs: merged };
}
