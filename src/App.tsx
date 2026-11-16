import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Compass,
  History,
  Navigation,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Settings,
  Square,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { LiveMap } from './components/LiveMap';
import { RunHistoryView } from './components/RunHistoryView';
import { RunSummaryModal } from './components/RunSummaryModal';
import { SettingsView } from './components/SettingsView';
import { SpeedPulseStrip } from './components/SpeedPulseStrip';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useRunTracker } from './hooks/useRunTracker';
import type {
  GuideRouteState,
  GuideTarget,
  RunRecord,
  UserSettings,
} from './types/run';
import {
  computeRouteGuidance,
  estimateCalories,
  formatDistance,
  formatDuration,
  formatEtaDuration,
  formatPace,
  formatSpeed,
  haversineMeters,
  METERS_PER_MILE,
  playMilestoneChime,
  resampleGuideWaypoints,
} from './utils/geo';
import {
  clearAllRuns,
  deleteRun,
  importRunsFromJSON,
  loadRuns,
  loadSettings,
  saveSettings,
  updateRunDetails,
} from './utils/storage';

type TabId = 'track' | 'history' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('track');
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [runs, setRuns] = useState<RunRecord[]>(() => loadRuns());
  const [summaryRun, setSummaryRun] = useState<RunRecord | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [guideRoute, setGuideRoute] = useState<GuideRouteState | null>(null);
  const arrivedNotifiedRef = useRef(false);

  const isOnline = useOnlineStatus();

  const handleRunSaved = useCallback(
    (savedRun: RunRecord, updatedList: RunRecord[]) => {
      setRuns(updatedList);
      setSummaryRun(savedRun);
      setConfirmDiscard(false);
      setGuideRoute(null);
    },
    []
  );

  const isGuideTracking = Boolean(guideRoute && guideRoute.target);
  const tracker = useRunTracker(settings, handleRunSaved, isGuideTracking);

  const handleUpdateSettings = useCallback((next: UserSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleToggleAutoCenter = useCallback(
    (autoCenter: boolean) => {
      if (settings.autoCenter !== autoCenter) {
        handleUpdateSettings({ ...settings, autoCenter });
      }
    },
    [settings, handleUpdateSettings]
  );

  const handleUpdateRun = useCallback(
    (id: string, updates: { title?: string; notes?: string }) => {
      const next = updateRunDetails(id, updates);
      setRuns(next);
    },
    []
  );

  const handleDeleteRun = useCallback((id: string) => {
    const next = deleteRun(id);
    setRuns(next);
    setGuideRoute((prev) => (prev?.run.id === id ? null : prev));
  }, []);

  const handleClearAllRuns = useCallback(() => {
    clearAllRuns();
    setRuns([]);
    setGuideRoute(null);
  }, []);

  const handleImportJSON = useCallback((jsonText: string) => {
    const res = importRunsFromJSON(jsonText);
    setRuns(res.runs);
  }, []);

  const handleTrackRouteFromHistory = useCallback((run: RunRecord) => {
    arrivedNotifiedRef.current = false;
    setGuideRoute({ run, target: null });
    setActiveTab('track');
  }, []);

  const handleSelectGuideTarget = useCallback(
    (target: GuideTarget) => {
      arrivedNotifiedRef.current = false;
      setGuideRoute((prev) => (prev ? { ...prev, target } : null));
      if (!tracker.draft) {
        tracker.startRun('gps');
      }
      if (!settings.autoCenter) {
        handleUpdateSettings({ ...settings, autoCenter: true });
      }
    },
    [tracker, settings, handleUpdateSettings]
  );

  const guideGuidance = useMemo(() => {
    if (!guideRoute || !guideRoute.target) return null;
    return computeRouteGuidance(
      guideRoute.run.points,
      guideRoute.target,
      tracker.currentLocation,
      tracker.liveSpeedKmh,
      tracker.avgSpeedKmh
    );
  }, [
    guideRoute,
    tracker.currentLocation,
    tracker.liveSpeedKmh,
    tracker.avgSpeedKmh,
  ]);

  useEffect(() => {
    if (guideGuidance?.arrived && !arrivedNotifiedRef.current) {
      arrivedNotifiedRef.current = true;
      if (settings.soundCues) {
        playMilestoneChime();
      }
    }
  }, [guideGuidance?.arrived, settings.soundCues]);

  const guideEndpointDistances = useMemo(() => {
    if (!guideRoute || guideRoute.run.points.length === 0 || !tracker.currentLocation) {
      return { toA: null as number | null, toB: null as number | null };
    }
    const pts = guideRoute.run.points;
    const ptA = pts[0];
    const ptB = pts[pts.length - 1];
    return {
      toA: haversineMeters(
        tracker.currentLocation.lat,
        tracker.currentLocation.lng,
        ptA.lat,
        ptA.lng
      ),
      toB: haversineMeters(
        tracker.currentLocation.lat,
        tracker.currentLocation.lng,
        ptB.lat,
        ptB.lng
      ),
    };
  }, [guideRoute, tracker.currentLocation]);

  const formatShortDistance = (meters: number) => {
    if (settings.unit === 'mi') {
      const feet = meters * 3.28084;
      if (feet < 1000) return `${Math.round(feet)} ft`;
      return `${(meters / METERS_PER_MILE).toFixed(2)} mi`;
    }
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const unitLabel = settings.unit;
  const speedUnitLabel = settings.unit === 'mi' ? 'mph' : 'km/h';
  const isRunning = tracker.draft?.status === 'running';
  const isPaused = tracker.draft?.status === 'paused';
  const hasActiveRun = Boolean(tracker.draft);

  const activeDistanceMeters = tracker.draft?.distanceMeters ?? 0;
  const activeCalories = estimateCalories(
    activeDistanceMeters,
    tracker.elapsedMs,
    settings.weightKg
  );

  const gpsStatusLabel = (() => {
    if (tracker.draft?.source === 'simulated' || tracker.gpsState === 'simulated') {
      return 'Simulated GPS';
    }
    if (tracker.gpsState === 'locked') {
      const acc = tracker.currentLocation?.accuracy;
      return acc ? `GPS Locked (±${Math.round(acc)}m)` : 'GPS Locked';
    }
    if (tracker.gpsState === 'denied') return 'GPS Permission Needed';
    if (tracker.gpsState === 'unavailable') return 'GPS Signal Unavailable';
    return 'Searching GPS...';
  })();

  const gpsStatusTone = (() => {
    if (tracker.draft?.source === 'simulated' || tracker.gpsState === 'simulated') {
      return 'text-orange-700';
    }
    if (tracker.gpsState === 'locked') return 'text-emerald-700';
    if (tracker.gpsState === 'denied' || tracker.gpsState === 'unavailable') {
      return 'text-amber-700';
    }
    return 'text-slate-600';
  })();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Desktop & Mobile Top Navigation (3-zone contract) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => setActiveTab('track')}
          className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
        >
          PaceTrail
        </button>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('track')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'track'
                ? 'text-orange-600 font-semibold border-b-2 border-orange-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Track
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'history'
                ? 'text-orange-600 font-semibold border-b-2 border-orange-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            History ({runs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'settings'
                ? 'text-orange-600 font-semibold border-b-2 border-orange-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Settings
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {!isOnline && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Offline</span>
            </span>
          )}

          {/* Top Nav Direct Run Control: Start -> Pause -> Resume (new color) */}
          {!hasActiveRun && (
            <button
              type="button"
              onClick={() => {
                if (guideRoute && !guideRoute.target) {
                  setGuideRoute(null);
                }
                setActiveTab('track');
                tracker.startRun('gps');
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-orange-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Play className="w-3.5 h-3.5 fill-current shrink-0" />
              <span>Start Run</span>
            </button>
          )}

          {isRunning && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('track');
                tracker.pauseRun();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 min-h-[40px] font-mono"
            >
              <Pause className="w-3.5 h-3.5 fill-current shrink-0" />
              <span>Pause · {formatDuration(tracker.elapsedMs)}</span>
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('track');
                setConfirmDiscard(false);
                tracker.resumeRun();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-orange-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 min-h-[40px] font-mono"
            >
              <Play className="w-3.5 h-3.5 fill-current shrink-0" />
              <span>Resume · {formatDuration(tracker.elapsedMs)}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {activeTab === 'track' && (
          <div className="mx-auto w-full max-w-7xl flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 p-3 sm:p-4 lg:p-6 pb-20 lg:pb-6 items-stretch">
            {/* Live Interactive Map + Full-Width Slim Speed Pulse Bar */}
            <div className="lg:col-span-7 flex flex-col gap-3 lg:h-[calc(100vh-124px)] lg:min-h-[540px]">
              <div className="flex-1 h-[36vh] min-h-[240px] lg:h-auto rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                <LiveMap
                  points={tracker.draft?.points ?? []}
                  splits={tracker.draft?.splits ?? []}
                  pastRuns={runs}
                  currentLegIndex={tracker.draft?.currentLegIndex ?? 0}
                  currentLocation={tracker.currentLocation}
                  autoCenter={settings.autoCenter}
                  onToggleAutoCenter={handleToggleAutoCenter}
                  isOnline={isOnline}
                  isRunning={isRunning}
                  guideRoute={guideRoute}
                  guideGuidance={guideGuidance}
                  onSelectGuideTarget={handleSelectGuideTarget}
                />
              </div>

              <div className="shrink-0 w-full">
                <SpeedPulseStrip
                  liveSpeedKmh={tracker.liveSpeedKmh}
                  maxSpeedKmh={tracker.draft?.maxSpeedKmh ?? 0}
                  unit={settings.unit}
                  isRunning={isRunning}
                />
              </div>
            </div>

            {/* Telemetry & Run Controls */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-4 rounded-2xl bg-white border border-slate-200 p-4 sm:p-5">
              <div className="space-y-4">
                {/* Real GPS & Local Save Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Navigation className={`w-3.5 h-3.5 shrink-0 ${gpsStatusTone}`} />
                    <span className={gpsStatusTone}>{gpsStatusLabel}</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {hasActiveRun && !isGuideTracking && settings.autoColorVisited && (
                      <span
                        className={`font-semibold ${
                          tracker.draft?.wasOnVisitedPath
                            ? 'text-blue-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {tracker.draft?.wasOnVisitedPath
                          ? 'Revisited Road'
                          : 'New Road'}
                      </span>
                    )}
                    {hasActiveRun && !isGuideTracking && settings.autoColorVisited && (
                      <span aria-hidden="true">·</span>
                    )}
                    <span>Local Storage</span>
                    {(tracker.gpsState === 'denied' ||
                      tracker.gpsState === 'unavailable') && (
                      <button
                        type="button"
                        onClick={tracker.retryGPS}
                        className="inline-flex items-center gap-1 font-semibold text-orange-600 hover:text-orange-700 whitespace-nowrap"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry GPS</span>
                      </button>
                    )}
                  </div>
                </div>

                {tracker.gpsError && !hasActiveRun && (
                  <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3.5 py-2.5 leading-relaxed">
                    {tracker.gpsError}
                  </p>
                )}

                {/* Real-Time Guided Route HUD (Point A / Point B) */}
                {guideRoute && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-sky-900 truncate">
                          Guide: {guideRoute.run.title}
                        </p>
                        <p className="text-[11px] text-sky-700 mt-0.5">
                          Select destination Point A or Point B to track along
                          this path
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGuideRoute(null)}
                        className="min-h-[36px] min-w-[36px] -mr-1 -mt-1 flex items-center justify-center rounded-lg text-sky-700 hover:bg-sky-100"
                        title="Close route guide"
                        aria-label="Close route guide"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectGuideTarget('A')}
                        className={`min-h-[44px] rounded-xl px-3 py-2 text-left transition-all border ${
                          guideRoute.target === 'A'
                            ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                            : 'bg-white text-slate-800 border-sky-200 hover:bg-sky-100/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold">
                            Go to Point A
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              guideRoute.target === 'A'
                                ? 'text-sky-100'
                                : 'text-emerald-700'
                            }`}
                          >
                            Start
                          </span>
                        </div>
                        <p
                          className={`mt-0.5 font-mono text-[11px] ${
                            guideRoute.target === 'A'
                              ? 'text-sky-100'
                              : 'text-slate-500'
                          }`}
                        >
                          {guideEndpointDistances.toA !== null
                            ? `${formatShortDistance(guideEndpointDistances.toA)} away`
                            : 'Tap to track'}
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectGuideTarget('B')}
                        className={`min-h-[44px] rounded-xl px-3 py-2 text-left transition-all border ${
                          guideRoute.target === 'B'
                            ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                            : 'bg-white text-slate-800 border-sky-200 hover:bg-sky-100/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold">
                            Go to Point B
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              guideRoute.target === 'B'
                                ? 'text-sky-100'
                                : 'text-slate-600'
                            }`}
                          >
                            End
                          </span>
                        </div>
                        <p
                          className={`mt-0.5 font-mono text-[11px] ${
                            guideRoute.target === 'B'
                              ? 'text-sky-100'
                              : 'text-slate-500'
                          }`}
                        >
                          {guideEndpointDistances.toB !== null
                            ? `${formatShortDistance(guideEndpointDistances.toB)} away`
                            : 'Tap to track'}
                        </p>
                      </button>
                    </div>

                    {guideGuidance && (
                      <div className="rounded-xl bg-white border border-sky-100 p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {guideGuidance.arrived ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <Compass className="w-4 h-4 text-sky-600 shrink-0" />
                            )}
                            <span
                              className={`text-xs font-bold truncate ${
                                guideGuidance.arrived
                                  ? 'text-emerald-700'
                                  : guideGuidance.isOffRoute
                                    ? 'text-amber-700'
                                    : 'text-slate-900'
                              }`}
                            >
                              {guideGuidance.directionHint}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-semibold text-sky-700 shrink-0">
                            {Math.round(guideGuidance.progressPct)}%
                          </span>
                        </div>

                        {/* Progress Track */}
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              guideGuidance.arrived
                                ? 'bg-emerald-600'
                                : 'bg-sky-600'
                            }`}
                            style={{
                              width: `${Math.round(guideGuidance.progressPct)}%`,
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-0.5">
                          <div>
                            <span className="text-[10px] text-slate-500 block">
                              Remaining
                            </span>
                            <span className="font-mono text-sm font-bold text-slate-900">
                              {formatShortDistance(
                                guideGuidance.remainingMeters
                              )}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block">
                              ETA
                            </span>
                            <span className="font-mono text-sm font-bold text-slate-900">
                              {formatEtaDuration(guideGuidance.etaSeconds)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block">
                              Route Path
                            </span>
                            <span className="font-mono text-sm font-bold text-slate-900">
                              {guideGuidance.arrived
                                ? 'Reached'
                                : guideGuidance.isOffRoute
                                  ? `${Math.round(guideGuidance.offRouteMeters)}m off`
                                  : 'On Track'}
                            </span>
                          </div>
                        </div>

                        {!guideGuidance.arrived &&
                          (!hasActiveRun ||
                            (tracker.draft?.source === 'gps' &&
                              (tracker.draft?.points.length ?? 0) <= 1)) && (
                            <button
                              type="button"
                              onClick={() => {
                                const waypoints = resampleGuideWaypoints(
                                  guideRoute.run.points,
                                  guideRoute.target!
                                );
                                tracker.startRun('simulated', waypoints);
                              }}
                              className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 transition-colors"
                            >
                              <Activity className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Simulate walk along route to Point{' '}
                                {guideRoute.target}
                              </span>
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                )}

                {/* Hero Metrics: Distance & Duration */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3.5 sm:p-4">
                    <span className="text-xs font-medium text-slate-500">
                      Distance
                    </span>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="font-mono text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
                        {formatDistance(activeDistanceMeters, unitLabel)}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">
                        {unitLabel}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3.5 sm:p-4">
                    <span className="text-xs font-medium text-slate-500">
                      Duration
                    </span>
                    <div className="mt-1 font-mono text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
                      {formatDuration(tracker.elapsedMs)}
                    </div>
                  </div>
                </div>

                {/* Live Speed, Pace, Avg Pace, Calories */}
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-100 p-3.5">
                    <span className="text-xs font-medium text-slate-500">
                      Live Speed
                    </span>
                    <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900">
                      {formatSpeed(tracker.liveSpeedKmh, unitLabel)}{' '}
                      <span className="text-xs font-normal text-slate-500">
                        {speedUnitLabel}
                      </span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-100 p-3.5">
                    <span className="text-xs font-medium text-slate-500">
                      Current Pace
                    </span>
                    <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900">
                      {formatPace(tracker.currentPaceSecPerKm, unitLabel)}{' '}
                      <span className="text-xs font-normal text-slate-500">
                        /{unitLabel}
                      </span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-100 p-3.5">
                    <span className="text-xs font-medium text-slate-500">
                      Avg Pace
                    </span>
                    <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900">
                      {formatPace(tracker.avgPaceSecPerKm, unitLabel)}{' '}
                      <span className="text-xs font-normal text-slate-500">
                        /{unitLabel}
                      </span>
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-100 p-3.5">
                    <span className="text-xs font-medium text-slate-500">
                      Calories
                    </span>
                    <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-slate-900">
                      {activeCalories}{' '}
                      <span className="text-xs font-normal text-slate-500">
                        kcal
                      </span>
                    </p>
                  </div>
                </div>

                {/* Live Geolocation Sensor Readout (No API Key) */}
                <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 font-mono">
                  <span>
                    {tracker.currentLocation
                      ? `${tracker.currentLocation.lat.toFixed(5)}, ${tracker.currentLocation.lng.toFixed(5)}`
                      : 'Waiting for GPS coordinates'}
                  </span>
                  <span>
                    {tracker.currentLocation?.altitude !== null &&
                    tracker.currentLocation?.altitude !== undefined
                      ? `Alt ${Math.round(tracker.currentLocation.altitude)}m`
                      : 'Alt --'}
                    {` · +${Math.round(tracker.draft?.elevationGainM ?? 0)}m`}
                    {tracker.draft ? ` · ${tracker.draft.points.length} pts` : ''}
                  </span>
                </div>

                {/* Live Splits during run */}
                {tracker.draft && tracker.draft.splits.length > 0 && (
                  <div className="pt-1">
                    <p className="text-xs font-semibold text-slate-600 mb-2">
                      Completed Splits
                    </p>
                    <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-100">
                      {tracker.draft.splits
                        .slice()
                        .reverse()
                        .map((split) => (
                          <div
                            key={split.index}
                            className="px-3.5 py-2 flex items-center justify-between text-xs font-mono"
                          >
                            <span className="font-semibold text-slate-900">
                              {split.index} {unitLabel}
                            </span>
                            <span className="text-slate-600">
                              {formatDuration(split.durationMs)}
                            </span>
                            <span className="font-semibold text-orange-700">
                              {formatPace(split.paceSecPerKm, unitLabel)} /
                              {unitLabel}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Primary Thumb-Zone Action Controls */}
              <div className="pt-2 space-y-2.5">
                {!hasActiveRun && (
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (guideRoute && !guideRoute.target) {
                          setGuideRoute(null);
                        }
                        tracker.startRun('gps');
                      }}
                      className="sm:col-span-8 min-h-[52px] w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-orange-600 px-5 py-3 text-base font-bold text-white shadow-sm hover:bg-orange-700 active:scale-[0.99] transition-all whitespace-nowrap"
                    >
                      <Play className="w-5 h-5 fill-current shrink-0" />
                      <span>Start Run</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const waypoints =
                          guideRoute && guideRoute.target
                            ? resampleGuideWaypoints(
                                guideRoute.run.points,
                                guideRoute.target
                              )
                            : undefined;
                        tracker.startRun('simulated', waypoints);
                      }}
                      className="sm:col-span-4 min-h-[52px] w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 active:scale-[0.99] transition-all whitespace-nowrap"
                    >
                      <Activity className="w-4 h-4 shrink-0" />
                      <span>
                        {guideRoute?.target
                          ? `Simulate to ${guideRoute.target}`
                          : 'Simulate Run'}
                      </span>
                    </button>
                  </div>
                )}

                {isRunning && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={tracker.pauseRun}
                        className="min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 active:scale-[0.99] transition-all whitespace-nowrap"
                      >
                        <Pause className="w-4 h-4 fill-current shrink-0" />
                        <span>Pause</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => tracker.finishRun()}
                        className="min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-bold text-white hover:bg-orange-700 active:scale-[0.99] transition-all whitespace-nowrap"
                      >
                        <Square className="w-4 h-4 fill-current shrink-0" />
                        <span>Finish Run</span>
                      </button>
                    </div>
                    {!isGuideTracking && (
                      <button
                        type="button"
                        onClick={tracker.markTurnBack}
                        className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 active:scale-[0.99] transition-all whitespace-nowrap"
                      >
                        <Repeat className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Turn Back / New Color (Leg{' '}
                          {(tracker.draft?.currentLegIndex ?? 0) + 1})
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {isPaused && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDiscard(false);
                          tracker.resumeRun();
                        }}
                        className="min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-sm font-bold text-white hover:bg-orange-700 active:scale-[0.99] transition-all whitespace-nowrap"
                      >
                        <Play className="w-4 h-4 fill-current shrink-0" />
                        <span>Resume</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => tracker.finishRun()}
                        className="min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 active:scale-[0.99] transition-all whitespace-nowrap"
                      >
                        <Square className="w-4 h-4 fill-current shrink-0" />
                        <span>Save Run</span>
                      </button>
                    </div>

                    {confirmDiscard ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            tracker.discardRun();
                            setConfirmDiscard(false);
                          }}
                          className="min-h-[44px] flex-1 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
                        >
                          Confirm Discard Run
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDiscard(false)}
                          className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(true)}
                        className="min-h-[44px] w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Discard Run</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <RunHistoryView
            runs={runs}
            settings={settings}
            onUpdateRun={handleUpdateRun}
            onDeleteRun={handleDeleteRun}
            onImportJSON={handleImportJSON}
            onStartNewRun={() => setActiveTab('track')}
            onTrackRoute={handleTrackRouteFromHistory}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            onChangeSettings={handleUpdateSettings}
            onClearAllRuns={handleClearAllRuns}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar (Thumb Zone) */}
      <nav
        aria-label="Primary mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 h-16 pb-safe"
      >
        <button
          type="button"
          onClick={() => setActiveTab('track')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] ${
            activeTab === 'track' ? 'text-orange-600' : 'text-slate-500'
          }`}
        >
          <Activity className="w-5 h-5" />
          <span className="text-[11px] font-semibold">Track</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] ${
            activeTab === 'history' ? 'text-orange-600' : 'text-slate-500'
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[11px] font-semibold">
            History ({runs.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] ${
            activeTab === 'settings' ? 'text-orange-600' : 'text-slate-500'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[11px] font-semibold">Settings</span>
        </button>
      </nav>

      {/* Post-Run Summary Modal */}
      {summaryRun && (
        <RunSummaryModal
          run={summaryRun}
          unit={settings.unit}
          mapStyle={settings.mapStyle}
          onSaveDetails={(id, title, notes) => {
            handleUpdateRun(id, { title, notes });
          }}
          onClose={() => setSummaryRun(null)}
          onViewHistory={() => setActiveTab('history')}
        />
      )}
    </div>
  );
}
