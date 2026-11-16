export type DistanceUnit = 'km' | 'mi';
export type MapStyle = 'standard' | 'topo' | 'dark';
export type RunSource = 'gps' | 'simulated';

export interface TrackPoint {
  lat: number;
  lng: number;
  timestamp: number;
  speedMps: number | null;
  accuracy: number | null;
  altitude: number | null;
  heading?: number | null;
}

export interface SplitRecord {
  index: number; // 1, 2, 3...
  distanceMeters: number;
  durationMs: number;
  paceSecPerKm: number;
  speedKmh: number;
}

export interface RunRecord {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  distanceMeters: number;
  avgPaceSecPerKm: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  calories: number;
  elevationGainM: number;
  points: TrackPoint[];
  splits: SplitRecord[];
  notes?: string;
  source: RunSource;
}

export interface ActiveRunDraft {
  id: string;
  status: 'running' | 'paused';
  startedAt: number;
  accumulatedActiveMs: number;
  lastResumedAt: number | null;
  points: TrackPoint[];
  splits: SplitRecord[];
  distanceMeters: number;
  maxSpeedKmh: number;
  elevationGainM: number;
  source: RunSource;
}

export interface UserSettings {
  unit: DistanceUnit;
  weightKg: number;
  weeklyGoalKm: number;
  soundCues: boolean;
  mapStyle: MapStyle;
  autoCenter: boolean;
}
