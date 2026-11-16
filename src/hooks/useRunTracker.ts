import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActiveRunDraft,
  LegSwitchReason,
  RunRecord,
  RunSource,
  SplitRecord,
  TrackPoint,
  UserSettings,
} from '../types/run';
import {
  angleDiffDeg,
  computeBearingDeg,
  estimateCalories,
  getDefaultRunTitle,
  haversineMeters,
  isNearVisitedRoute,
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
  onRunSaved: (savedRun: RunRecord, updatedList: RunRecord[]) => void,
  lockSingleColor = false
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

  const lockSingleColorRef = useRef<boolean>(lockSingleColor);
  lockSingleColorRef.current = lockSingleColor;

  const watchIdRef = useRef<number | null>(null);
  const simIntervalRef = useRef<number | null>(null);
  const simStepRef = useRef<number>(0);
  const simWaypointsRef = useRef<[number, number][] | null>(null);
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

      const isResumingAfterPause = Boolean(currentDraft.pendingPauseGap);

      if (lastPt) {
        const dtSec = Math.max(0.2, (incoming.timestamp - lastPt.timestamp) / 1000);
        const segMeters = haversineMeters(
          lastPt.lat,
          lastPt.lng,
          incoming.lat,
          incoming.lng
        );

        if (isResumingAfterPause) {
          // Do not count movement during pause toward running distance, and always accept resumed point
          addedDist = 0;
          instantSpeedKmh =
            incoming.speedMps !== null && incoming.speedMps >= 0
              ? incoming.speedMps * 3.6
              : 0;
        } else {
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

      // Automatic turn-back / U-turn & live visited-path detection (disabled when locked to single-color guide mode)
      let nextLegIndex = lockSingleColorRef.current
        ? 0
        : (currentDraft.currentLegIndex ?? 0);
      let nextLegStartIdx = currentDraft.legPointStartIdx ?? 0;
      let nextLegStartDist = currentDraft.legStartDistMeters ?? 0;
      let nextWasOnVisited = lockSingleColorRef.current
        ? false
        : (currentDraft.wasOnVisitedPath ?? false);
      let nextStreak = currentDraft.visitedTransitionStreak ?? 0;
      let nextLegReason: LegSwitchReason = currentDraft.lastLegReason ?? 'start';
      let updatedPrevPoints = prevPoints;

      const distInCurrentLeg = nextDistance - nextLegStartDist;
      const hasReliableAccuracy =
        currentDraft.source === 'simulated' ||
        incoming.accuracy === null ||
        incoming.accuracy <= 55;

      let detectedTurn = false;
      let turnSplitIdx = prevPoints.length;

      const legLen = prevPoints.length - nextLegStartIdx;
      if (
        !lockSingleColorRef.current &&
        hasReliableAccuracy &&
        legLen >= 3 &&
        distInCurrentLeg >= 10 &&
        lastPt
      ) {
        const legOrigin = prevPoints[nextLegStartIdx];
        let farthestIdx = nextLegStartIdx;
        let maxSpanMeters = 0;

        for (let i = nextLegStartIdx + 1; i < prevPoints.length; i++) {
          const d = haversineMeters(
            legOrigin.lat,
            legOrigin.lng,
            prevPoints[i].lat,
            prevPoints[i].lng
          );
          if (d >= maxSpanMeters) {
            maxSpanMeters = d;
            farthestIdx = i;
          }
        }

        // Method 1: Farthest-apex reversal (>=10m span, >=8m return, 2 consecutive points moving back)
        if (maxSpanMeters >= 10 && farthestIdx > nextLegStartIdx && farthestIdx < prevPoints.length - 1) {
          const apexPt = prevPoints[farthestIdx];
          const distBackFromApex = haversineMeters(
            apexPt.lat,
            apexPt.lng,
            incoming.lat,
            incoming.lng
          );
          const lastDistFromApex = haversineMeters(
            apexPt.lat,
            apexPt.lng,
            lastPt.lat,
            lastPt.lng
          );

          if (
            distBackFromApex >= 8 &&
            lastDistFromApex >= 3 &&
            distBackFromApex > lastDistFromApex
          ) {
            let beforeApexIdx = nextLegStartIdx;
            for (let k = farthestIdx - 1; k >= nextLegStartIdx; k--) {
              if (
                haversineMeters(
                  prevPoints[k].lat,
                  prevPoints[k].lng,
                  apexPt.lat,
                  apexPt.lng
                ) >= 8
              ) {
                beforeApexIdx = k;
                break;
              }
            }
            const beforeApex = prevPoints[beforeApexIdx];
            const outBearing = computeBearingDeg(
              beforeApex.lat,
              beforeApex.lng,
              apexPt.lat,
              apexPt.lng
            );
            const backBearing = computeBearingDeg(
              apexPt.lat,
              apexPt.lng,
              incoming.lat,
              incoming.lng
            );
            if (angleDiffDeg(outBearing, backBearing) >= 115) {
              detectedTurn = true;
              turnSplitIdx = farthestIdx;
            }
          }
        }

        // Method 2: Sliding-window reversal fallback for curved U-turns (8-10m arms + sustained return)
        if (!detectedTurn && legLen >= 4) {
          let midIdx = -1;
          for (let i = prevPoints.length - 1; i > nextLegStartIdx; i--) {
            if (
              haversineMeters(
                prevPoints[i].lat,
                prevPoints[i].lng,
                incoming.lat,
                incoming.lng
              ) >= 8
            ) {
              midIdx = i;
              break;
            }
          }
          if (midIdx > nextLegStartIdx && midIdx < prevPoints.length - 1) {
            let prevIdx = -1;
            for (let j = midIdx - 1; j >= nextLegStartIdx; j--) {
              if (
                haversineMeters(
                  prevPoints[j].lat,
                  prevPoints[j].lng,
                  prevPoints[midIdx].lat,
                  prevPoints[midIdx].lng
                ) >= 10
              ) {
                prevIdx = j;
                break;
              }
            }
            if (prevIdx !== -1) {
              const prevBearing = computeBearingDeg(
                prevPoints[prevIdx].lat,
                prevPoints[prevIdx].lng,
                prevPoints[midIdx].lat,
                prevPoints[midIdx].lng
              );
              const currBearing = computeBearingDeg(
                prevPoints[midIdx].lat,
                prevPoints[midIdx].lng,
                incoming.lat,
                incoming.lng
              );
              const sustainedBack =
                haversineMeters(
                  prevPoints[midIdx].lat,
                  prevPoints[midIdx].lng,
                  lastPt.lat,
                  lastPt.lng
                ) >= 3 &&
                haversineMeters(
                  prevPoints[prevIdx].lat,
                  prevPoints[prevIdx].lng,
                  incoming.lat,
                  incoming.lng
                ) <
                  haversineMeters(
                    prevPoints[prevIdx].lat,
                    prevPoints[prevIdx].lng,
                    prevPoints[midIdx].lat,
                    prevPoints[midIdx].lng
                  );
              if (sustainedBack && angleDiffDeg(prevBearing, currBearing) >= 120) {
                detectedTurn = true;
                turnSplitIdx = midIdx;
              }
            }
          }
        }
      }

      if (detectedTurn) {
        nextLegIndex += 1;
        if (turnSplitIdx < prevPoints.length) {
          updatedPrevPoints = prevPoints.map((pt, idx) =>
            idx > turnSplitIdx ? { ...pt, legIndex: nextLegIndex } : pt
          );
        }
        nextLegStartIdx = Math.min(turnSplitIdx + 1, prevPoints.length);
        nextLegStartDist = nextDistance;
        nextWasOnVisited = settingsRef.current.autoColorVisited
          ? isNearVisitedRoute(
              incoming.lat,
              incoming.lng,
              updatedPrevPoints,
              [],
              12,
              50,
              30,
              nextLegIndex
            )
          : false;
        nextStreak = 0;
        nextLegReason = 'turn_back';
      } else if (
        !lockSingleColorRef.current &&
        settingsRef.current.autoColorVisited &&
        hasReliableAccuracy
      ) {
        const onVisitedNow = isNearVisitedRoute(
          incoming.lat,
          incoming.lng,
          prevPoints,
          [],
          12,
          50,
          30,
          nextLegIndex
        );
        if (prevPoints.length === 0) {
          nextWasOnVisited = false;
          nextStreak = 0;
          nextLegReason = 'start';
        } else if (onVisitedNow !== nextWasOnVisited) {
          nextStreak += 1;
          // Require 3 consecutive points & >=18m in current leg so road edges/curves never flicker
          if (nextStreak >= 3 && distInCurrentLeg >= 18) {
            nextLegIndex += 1;
            const splitStart = Math.max(0, prevPoints.length - 1);
            updatedPrevPoints = prevPoints.map((pt, idx) =>
              idx >= splitStart ? { ...pt, legIndex: nextLegIndex } : pt
            );
            nextLegStartIdx = splitStart;
            nextLegStartDist = nextDistance;
            nextWasOnVisited = onVisitedNow;
            nextStreak = 0;
            nextLegReason = onVisitedNow ? 'revisited' : 'new_path';
          }
        } else {
          nextStreak = 0;
        }
      }

      const stampedPoint: TrackPoint = {
        ...incoming,
        legIndex: nextLegIndex,
        ...(isResumingAfterPause && lastPt ? { isPauseGapStart: true } : {}),
      };

      const nextDraft: ActiveRunDraft = {
        ...currentDraft,
        points: [...updatedPrevPoints, stampedPoint],
        splits: nextSplits,
        distanceMeters: nextDistance,
        maxSpeedKmh: Math.max(currentDraft.maxSpeedKmh, instantSpeedKmh),
        elevationGainM: currentDraft.elevationGainM + addedElevation,
        currentLegIndex: nextLegIndex,
        legPointStartIdx: isResumingAfterPause
          ? updatedPrevPoints.length
          : nextLegStartIdx,
        legStartDistMeters: nextLegStartDist,
        wasOnVisitedPath: nextWasOnVisited,
        visitedTransitionStreak: nextStreak,
        lastLegReason: nextLegReason,
        pendingPauseGap: false,
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
      const guideWaypoints = simWaypointsRef.current;
      if (guideWaypoints && guideWaypoints.length > 0) {
        const idx = Math.min(simStepRef.current, guideWaypoints.length - 1);
        const [lat, lng] = guideWaypoints[idx];
        const prevIdx = Math.max(0, idx - 1);
        const [prevLat, prevLng] = guideWaypoints[prevIdx];
        const atEnd = simStepRef.current >= guideWaypoints.length - 1;
        const heading =
          idx > 0
            ? computeBearingDeg(prevLat, prevLng, lat, lng)
            : guideWaypoints.length > 1
              ? computeBearingDeg(
                  lat,
                  lng,
                  guideWaypoints[1][0],
                  guideWaypoints[1][1]
                )
              : 0;
        simStepRef.current += 1;

        appendPointToDraft({
          lat,
          lng,
          timestamp: Date.now(),
          speedMps: atEnd ? 0 : 3.2,
          accuracy: 5,
          altitude: 215,
          heading,
        });
        return;
      }

      simStepRef.current += 1;
      const t = simStepRef.current;
      // 40-second cycle: 0->+1 (new), +1->0 (revisited/back), 0->-1 (new path past start), -1->0 (revisited/back)
      const phaseDuration = 10;
      const cyclePos = (t - 1) % (phaseDuration * 4);
      const phase = Math.floor(cyclePos / phaseDuration);
      const stepInPhase = (cyclePos % phaseDuration) + 1;
      const frac = stepInPhase / phaseDuration;

      let progress = 0;
      let forward = true;
      if (phase === 0) {
        progress = frac;
        forward = true;
      } else if (phase === 1) {
        progress = 1 - frac;
        forward = false;
      } else if (phase === 2) {
        progress = -frac;
        forward = false;
      } else {
        progress = -1 + frac;
        forward = true;
      }

      const maxSpanLat = 0.00048;
      const maxSpanLng = 0.00058;

      const lat = center.lat + progress * maxSpanLat;
      const lng = center.lng + progress * maxSpanLng;
      const speedMps = 3.35 + Math.sin(t * 0.4) * 0.35;
      const heading = forward ? 48 : 228;

      appendPointToDraft({
        lat,
        lng,
        timestamp: Date.now(),
        speedMps,
        accuracy: 5,
        altitude: 215 + Math.sin(Math.abs(progress) * Math.PI) * 5,
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
    (source: RunSource = 'gps', guideWaypoints?: [number, number][]) => {
      const now = Date.now();
      const initialPoints: TrackPoint[] = [];

      if (source === 'gps') {
        simWaypointsRef.current = null;
        startRealGPSWatcher();
        if (
          currentLocation &&
          (currentLocation.accuracy === null || currentLocation.accuracy <= 35)
        ) {
          initialPoints.push({
            ...currentLocation,
            timestamp: now,
            legIndex: 0,
          });
        }
      } else {
        simStepRef.current = 0;
        simWaypointsRef.current =
          guideWaypoints && guideWaypoints.length > 0 ? guideWaypoints : null;
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
        currentLegIndex: 0,
        legPointStartIdx: 0,
        legStartDistMeters: 0,
        wasOnVisitedPath: false,
        visitedTransitionStreak: 0,
        lastLegReason: 'start',
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
    // Automatically advance to a fresh route color when resuming (unless locked to single-color guide mode)
    const prevLeg = lockSingleColorRef.current
      ? 0
      : (current.currentLegIndex ?? 0);
    const hasPoints = current.points.length > 0;
    const hasPointsInCurrentLeg =
      current.points.length - (current.legPointStartIdx ?? 0) >= 2;
    const nextLeg = lockSingleColorRef.current
      ? 0
      : hasPointsInCurrentLeg
        ? prevLeg + 1
        : prevLeg;
    const nextStartIdx = hasPointsInCurrentLeg
      ? current.points.length
      : (current.legPointStartIdx ?? 0);

    if (current.source === 'simulated' && hasPoints) {
      // Advance simulation cursor slightly so pause-to-resume dotted gap is clearly visible
      simStepRef.current += 3;
    }

    const next: ActiveRunDraft = {
      ...current,
      status: 'running',
      lastResumedAt: now,
      currentLegIndex: nextLeg,
      legPointStartIdx: nextStartIdx,
      legStartDistMeters: current.distanceMeters,
      visitedTransitionStreak: 0,
      lastLegReason: hasPointsInCurrentLeg
        ? 'resumed'
        : (current.lastLegReason ?? 'start'),
      pendingPauseGap: hasPoints,
    };
    draftRef.current = next;
    setDraft(next);
    saveActiveRun(next);
    requestWakeLock();
  }, [requestWakeLock]);

  const markTurnBack = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    const nextLeg = (current.currentLegIndex ?? 0) + 1;
    const nextStartIdx = Math.max(0, current.points.length - 1);
    const next: ActiveRunDraft = {
      ...current,
      currentLegIndex: nextLeg,
      legPointStartIdx: nextStartIdx,
      legStartDistMeters: current.distanceMeters,
      visitedTransitionStreak: 0,
      lastLegReason: 'manual',
    };
    draftRef.current = next;
    setDraft(next);
    saveActiveRun(next);
  }, []);

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
    simWaypointsRef.current = null;
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
    simWaypointsRef.current = null;
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
    markTurnBack,
    finishRun,
    discardRun,
    retryGPS: startRealGPSWatcher,
  };
}
