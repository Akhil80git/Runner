import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActiveRunDraft,
  RunRecord,
  RunSource,
  SplitRecord,
  TrackPoint,
  UserSettings,
} from '../types/run';
import {
  estimateCalories,
  getDefaultRunTitle,
  haversineMeters,
  METERS_PER_MILE,
  playMilestoneChime,
} from '../utils/geo';
import {
  addRun,
  loadActiveRun,
  saveActiveRun,
} from '../utils/storage';

export type GPSState =
  | 'searching'
  | 'locked'
  | 'denied'
  | 'unavailable'
  | 'simulated';

const DEFAULT_FALLBACK_COORDS = { lat: 28.6129, lng: 77.2295 }; // Open park loop fallback for simulation

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function useRunTracker(
  settings: UserSettings,
  onRunSaved: (savedRun: RunRecord, updatedList: RunRecord[]) => void
) {
  const [draft, setDraft] = useState<ActiveRunDraft | null>(() => {
    const existing = loadActiveRun();
    if (!existing) return null;
    // If browser reloaded while running, resume safely in paused state so elapsed time stays accurate
    if (existing.status === 'running' && existing.lastResumedAt) {
      const recoveredElapsed =
        existing.accumulatedActiveMs +
        Math.max(0, Date.now() - existing.lastResumedAt);
      return {
        ...existing,
        status: 'paused',
        accumulatedActiveMs: recoveredElapsed,
        lastResumedAt: null,
      };
    }
    return existing;
  });

  const [currentLocation, setCurrentLocation] = useState<TrackPoint | null>(
    () => {
      const existing = loadActiveRun();
      if (existing && existing.points.length > 0) {
        return existing.points[existing.points.length - 1];
      }
      return null;
    }
  );
  const [gpsState, setGpsState] = useState<GPSState>('searching');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(
    () => loadActiveRun()?.accumulatedActiveMs ?? 0
  );
  const [liveSpeedKmh, setLiveSpeedKmh] = useState<number>(0);

  const draftRef = useRef<ActiveRunDraft | null>(draft);
  draftRef.current = draft;

  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const watchIdRef = useRef<number | null>(null);
  const simIntervalRef = useRef<number | null>(null);
  const simStepRef = useRef<number>(0);
  const simCenterRef = useRef<{ lat: number; lng: number }>(
    DEFAULT_FALLBACK_COORDS
  );
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      void wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  const requestWakeLock = useCallback(() => {
    const nav = navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    };
    if (nav.wakeLock?.request) {
      void nav.wakeLock
        .request('screen')
        .then((sentinel) => {
          wakeLockRef.current = sentinel;
        })
        .catch(() => {});
    }
  }, []);

  const appendPointToDraft = useCallback(
    (incoming: TrackPoint) => {
      setCurrentLocation(incoming);

      const currentDraft = draftRef.current;
      if (!currentDraft || currentDraft.status !== 'running') {
        return;
      }

      const prevPoints = currentDraft.points;
      const lastPt =
        prevPoints.length > 0 ? prevPoints[prevPoints.length - 1] : null;

      let addedDist = 0;
      let instantSpeedKmh =
        incoming.speedMps !== null && incoming.speedMps >= 0
          ? incoming.speedMps * 3.6
          : 0;

      if (lastPt) {
        const dtSec = Math.max(0.2, (incoming.timestamp - lastPt.timestamp) / 1000);
        const segMeters = haversineMeters(
          lastPt.lat,
          lastPt.lng,
          incoming.lat,
          incoming.lng
        );

        // Filter out unrealistic GPS teleports (> 16 m/s = 57.6 km/h)
        if (segMeters / dtSec > 16) {
          return;
        }

        // Filter out standing GPS drift when accuracy is poor or micro-jitter < 2.2m
        if (
          incoming.accuracy !== null &&
          incoming.accuracy > 55 &&
          prevPoints.length > 2
        ) {
          return;
        }
        if (segMeters < 2.2 && (incoming.speedMps ?? 0) < 0.4) {
          setLiveSpeedKmh(0);
          return;
        }

        addedDist = segMeters;
        const computedKmh = (segMeters / dtSec) * 3.6;
        if (incoming.speedMps === null || incoming.speedMps === 0) {
          instantSpeedKmh = computedKmh;
        } else {
          // Light smoothing between hardware speed and segment speed
          instantSpeedKmh = incoming.speedMps * 3.6 * 0.65 + computedKmh * 0.35;
        }
      }

      if (instantSpeedKmh > 45) instantSpeedKmh = 0;
      setLiveSpeedKmh(instantSpeedKmh);

      let addedElevation = 0;
      if (
        lastPt &&
        lastPt.altitude !== null &&
        incoming.altitude !== null &&
        incoming.altitude - lastPt.altitude > 0.8 &&
        incoming.altitude - lastPt.altitude < 25
      ) {
        addedElevation = incoming.altitude - lastPt.altitude;
      }

      const nextDistance = currentDraft.distanceMeters + addedDist;
      const currentActiveMs =
        currentDraft.accumulatedActiveMs +
        (currentDraft.lastResumedAt
          ? Math.max(0, incoming.timestamp - currentDraft.lastResumedAt)
          : 0);

      // Check split milestones (every 1000m for km, or 1609.344m for mi)
      const splitUnitMeters =
        settingsRef.current.unit === 'mi' ? METERS_PER_MILE : 1000;
      const nextSplits: SplitRecord[] = [...currentDraft.splits];
      const completedSplitsCount = Math.floor(nextDistance / splitUnitMeters);

      if (completedSplitsCount > nextSplits.length) {
        const prevCumulativeMs = nextSplits.reduce(
          (sum, s) => sum + s.durationMs,
          0
        );
        const splitDurationMs = Math.max(1000, currentActiveMs - prevCumulativeMs);
        const paceSecPerKm =
          (splitDurationMs / 1000) / (splitUnitMeters / 1000);
        const speedKmh =
          (splitUnitMeters / 1000) / (splitDurationMs / 3600000);

        nextSplits.push({
          index: nextSplits.length + 1,
          distanceMeters: splitUnitMeters,
          durationMs: splitDurationMs,
          paceSecPerKm,
          speedKmh,
        });

        if (settingsRef.current.soundCues) {
          playMilestoneChime();
        }
      }

      const nextDraft: ActiveRunDraft = {
        ...currentDraft,
        points: [...prevPoints, incoming],
        splits: nextSplits,
        distanceMeters: nextDistance,
        maxSpeedKmh: Math.max(currentDraft.maxSpeedKmh, instantSpeedKmh),
        elevationGainM: currentDraft.elevationGainM + addedElevation,
      };

      draftRef.current = nextDraft;
      setDraft(nextDraft);
      saveActiveRun(nextDraft);
    },
    []
  );

  const startRealGPSWatcher = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsState('unavailable');
      setGpsError('Geolocation is not supported on this browser.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setGpsState('searching');
    setGpsError(null);

    // Fast coarse lock so OpenStreetMap centers immediately while high-accuracy GPS warms up
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsState('locked');
        setGpsError(null);
        const pt: TrackPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: pos.timestamp || Date.now(),
          speedMps: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          heading: pos.coords.heading,
        };
        simCenterRef.current = { lat: pt.lat, lng: pt.lng };
        setCurrentLocation((prev) => prev ?? pt);
      },
      () => {
        // High-accuracy watchPosition below handles errors/permissions cleanly
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60000,
        timeout: 5000,
      }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsState('locked');
        setGpsError(null);
        const pt: TrackPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: pos.timestamp || Date.now(),
          speedMps: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          heading: pos.coords.heading,
        };
        simCenterRef.current = { lat: pt.lat, lng: pt.lng };
        if (draftRef.current?.source !== 'simulated') {
          appendPointToDraft(pt);
        } else if (!draftRef.current) {
          setCurrentLocation(pt);
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsState('denied');
          setGpsError(
            'Location permission denied. Allow GPS access or try Simulate Run.'
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGpsState('unavailable');
          setGpsError(
            'GPS signal unavailable indoors. Move outdoors or use Simulate Run.'
          );
        } else {
          setGpsState('searching');
          setGpsError('Searching for stronger GPS signal...');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000,
      }
    );
  }, [appendPointToDraft]);

  // Initialize passive GPS watcher on mount
  useEffect(() => {
    startRealGPSWatcher();
    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (simIntervalRef.current !== null) {
        window.clearInterval(simIntervalRef.current);
      }
      releaseWakeLock();
    };
  }, [startRealGPSWatcher, releaseWakeLock]);

  // Smooth elapsed timer tick when running
  useEffect(() => {
    if (!draft || draft.status !== 'running') {
      setElapsedMs(draft?.accumulatedActiveMs ?? 0);
      return;
    }

    const updateTick = () => {
      const current = draftRef.current;
      if (!current || current.status !== 'running' || !current.lastResumedAt) {
        return;
      }
      setElapsedMs(
        current.accumulatedActiveMs +
          Math.max(0, Date.now() - current.lastResumedAt)
      );
    };

    updateTick();
    const id = window.setInterval(updateTick, 250);
    return () => window.clearInterval(id);
  }, [draft?.status, draft?.id, draft?.accumulatedActiveMs, draft?.lastResumedAt]);

  // Manage simulated GPS loop when running in simulated mode
  useEffect(() => {
    if (simIntervalRef.current !== null) {
      window.clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }

    if (!draft || draft.status !== 'running' || draft.source !== 'simulated') {
      return;
    }

    setGpsState('simulated');
    const center =
      draft.points.length > 0
        ? {
            lat: draft.points[0].lat - 0.0022,
            lng: draft.points[0].lng,
          }
        : simCenterRef.current;

    const emitSimPoint = () => {
      simStepRef.current += 1;
      const t = simStepRef.current;
      // Oval park loop (~1.4km per full loop, ~3.2 m/s = 11.5 km/h)
      const angularSpeed = 0.0155;
      const angle = t * angularSpeed;
      const radiusLat = 0.0022 + Math.sin(angle * 3) * 0.00018;
      const radiusLng = 0.0031 + Math.cos(angle * 2) * 0.00022;

      const lat = center.lat + Math.cos(angle) * radiusLat;
      const lng = center.lng + Math.sin(angle) * radiusLng;
      const speedMps = 3.15 + Math.sin(t * 0.25) * 0.45; // ~9.7 - 13.0 km/h
      const heading = ((angle * 180) / Math.PI + 90) % 360;

      appendPointToDraft({
        lat,
        lng,
        timestamp: Date.now(),
        speedMps,
        accuracy: 6,
        altitude: 215 + Math.sin(angle * 2) * 4,
        heading,
      });
    };

    if (draft.points.length === 0) {
      emitSimPoint();
    }
    simIntervalRef.current = window.setInterval(emitSimPoint, 1000);

    return () => {
      if (simIntervalRef.current !== null) {
        window.clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    };
  }, [draft?.status, draft?.source, draft?.id, appendPointToDraft]);

  const startRun = useCallback(
    (source: RunSource = 'gps') => {
      const now = Date.now();
      const initialPoints: TrackPoint[] = [];

      if (source === 'gps') {
        startRealGPSWatcher();
        if (currentLocation) {
          initialPoints.push({ ...currentLocation, timestamp: now });
        }
      } else {
        simStepRef.current = 0;
        simCenterRef.current = currentLocation
          ? { lat: currentLocation.lat, lng: currentLocation.lng }
          : DEFAULT_FALLBACK_COORDS;
        setGpsState('simulated');
      }

      const newDraft: ActiveRunDraft = {
        id: `run_${now}_${Math.random().toString(36).slice(2, 7)}`,
        status: 'running',
        startedAt: now,
        accumulatedActiveMs: 0,
        lastResumedAt: now,
        points: initialPoints,
        splits: [],
        distanceMeters: 0,
        maxSpeedKmh: 0,
        elevationGainM: 0,
        source,
      };

      draftRef.current = newDraft;
      setDraft(newDraft);
      setElapsedMs(0);
      setLiveSpeedKmh(0);
      saveActiveRun(newDraft);
      requestWakeLock();
    },
    [currentLocation, requestWakeLock, startRealGPSWatcher]
  );

  const pauseRun = useCallback(() => {
    const current = draftRef.current;
    if (!current || current.status !== 'running') return;
    const now = Date.now();
    const accumulated =
      current.accumulatedActiveMs +
      (current.lastResumedAt ? Math.max(0, now - current.lastResumedAt) : 0);

    const next: ActiveRunDraft = {
      ...current,
      status: 'paused',
      accumulatedActiveMs: accumulated,
      lastResumedAt: null,
    };
    draftRef.current = next;
    setDraft(next);
    setElapsedMs(accumulated);
    setLiveSpeedKmh(0);
    saveActiveRun(next);
    releaseWakeLock();
  }, [releaseWakeLock]);

  const resumeRun = useCallback(() => {
    const current = draftRef.current;
    if (!current || current.status !== 'paused') return;
    const now = Date.now();
    const next: ActiveRunDraft = {
      ...current,
      status: 'running',
      lastResumedAt: now,
    };
    draftRef.current = next;
    setDraft(next);
    saveActiveRun(next);
    requestWakeLock();
  }, [requestWakeLock]);

  const finishRun = useCallback((): RunRecord | null => {
    const current = draftRef.current;
    if (!current) return null;
    const now = Date.now();
    const totalMs =
      current.accumulatedActiveMs +
      (current.status === 'running' && current.lastResumedAt
        ? Math.max(0, now - current.lastResumedAt)
        : 0);

    const distanceKm = current.distanceMeters / 1000;
    const hours = totalMs / 3600000;
    const avgSpeedKmh = hours > 0 && distanceKm > 0 ? distanceKm / hours : 0;
    const avgPaceSecPerKm =
      distanceKm > 0.01 ? (totalMs / 1000) / distanceKm : 0;

    const record: RunRecord = {
      id: current.id,
      title: getDefaultRunTitle(current.startedAt),
      startedAt: current.startedAt,
      endedAt: now,
      durationMs: totalMs,
      distanceMeters: current.distanceMeters,
      avgPaceSecPerKm,
      avgSpeedKmh,
      maxSpeedKmh: Math.max(current.maxSpeedKmh, avgSpeedKmh),
      calories: estimateCalories(
        current.distanceMeters,
        totalMs,
        settingsRef.current.weightKg
      ),
      elevationGainM: Math.round(current.elevationGainM),
      points: current.points,
      splits: current.splits,
      source: current.source,
    };

    const updatedList = addRun(record);
    saveActiveRun(null);
    draftRef.current = null;
    setDraft(null);
    setElapsedMs(0);
    setLiveSpeedKmh(0);
    releaseWakeLock();
    if (current.source === 'simulated') {
      startRealGPSWatcher();
    }
    onRunSaved(record, updatedList);
    return record;
  }, [onRunSaved, releaseWakeLock, startRealGPSWatcher]);

  const discardRun = useCallback(() => {
    const wasSimulated = draftRef.current?.source === 'simulated';
    saveActiveRun(null);
    draftRef.current = null;
    setDraft(null);
    setElapsedMs(0);
    setLiveSpeedKmh(0);
    releaseWakeLock();
    if (wasSimulated) {
      startRealGPSWatcher();
    }
  }, [releaseWakeLock, startRealGPSWatcher]);

  const currentPaceSecPerKm =
    liveSpeedKmh > 0.8 ? 3600 / liveSpeedKmh : 0;
  const avgSpeedKmh =
    elapsedMs > 2000 && (draft?.distanceMeters ?? 0) > 5
      ? (draft!.distanceMeters / 1000) / (elapsedMs / 3600000)
      : 0;
  const avgPaceSecPerKm = avgSpeedKmh > 0.5 ? 3600 / avgSpeedKmh : 0;

  return {
    draft,
    currentLocation,
    gpsState,
    gpsError,
    elapsedMs,
    liveSpeedKmh,
    currentPaceSecPerKm,
    avgSpeedKmh,
    avgPaceSecPerKm,
    startRun,
    pauseRun,
    resumeRun,
    finishRun,
    discardRun,
    retryGPS: startRealGPSWatcher,
  };
}
