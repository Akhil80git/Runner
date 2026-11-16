import { useCallback, useState } from 'react';
import {
  Activity,
  History,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Square,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { LiveMap } from './components/LiveMap';
import { PWAInstallButton } from './components/PWAInstallButton';
import { RunHistoryView } from './components/RunHistoryView';
import { RunSummaryModal } from './components/RunSummaryModal';
import { SettingsView } from './components/SettingsView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useRunTracker } from './hooks/useRunTracker';
import type { MapStyle, RunRecord, UserSettings } from './types/run';
import {
  estimateCalories,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
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

  const isOnline = useOnlineStatus();

  const handleRunSaved = useCallback(
    (savedRun: RunRecord, updatedList: RunRecord[]) => {
      setRuns(updatedList);
      setSummaryRun(savedRun);
      setConfirmDiscard(false);
    },
    []
  );

  const tracker = useRunTracker(settings, handleRunSaved);

  const handleUpdateSettings = useCallback((next: UserSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleChangeMapStyle = useCallback(
    (mapStyle: MapStyle) => {
      handleUpdateSettings({ ...settings, mapStyle });
    },
    [settings, handleUpdateSettings]
  );

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
  }, []);

  const handleClearAllRuns = useCallback(() => {
    clearAllRuns();
    setRuns([]);
  }, []);

  const handleImportJSON = useCallback((jsonText: string) => {
    const res = importRunsFromJSON(jsonText);
    setRuns(res.runs);
  }, []);

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
              <span>Offline Mode</span>
            </span>
          )}
          <PWAInstallButton compact />
          {activeTab !== 'track' && (
            <button
              type="button"
              onClick={() => setActiveTab('track')}
              className="hidden sm:inline-flex items-center justify-center rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
            >
              {hasActiveRun ? 'Active Run' : 'Track Run'}
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {activeTab === 'track' && (
          <div className="mx-auto w-full max-w-7xl flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 p-3 sm:p-4 lg:p-6 pb-20 lg:pb-6 items-stretch">
            {/* Live Interactive Map */}
            <div className="lg:col-span-7 h-[39vh] min-h-[260px] lg:h-[calc(100vh-124px)] lg:min-h-[540px] rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
              <LiveMap
                points={tracker.draft?.points ?? []}
                splits={tracker.draft?.splits ?? []}
                currentLocation={tracker.currentLocation}
                mapStyle={settings.mapStyle}
                onChangeMapStyle={handleChangeMapStyle}
                autoCenter={settings.autoCenter}
                onToggleAutoCenter={handleToggleAutoCenter}
                isOnline={isOnline}
                isRunning={isRunning}
              />
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
                      onClick={() => tracker.startRun('gps')}
                      className="sm:col-span-8 min-h-[52px] w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-orange-600 px-5 py-3 text-base font-bold text-white shadow-sm hover:bg-orange-700 active:scale-[0.99] transition-all whitespace-nowrap"
                    >
                      <Play className="w-5 h-5 fill-current shrink-0" />
                      <span>Start Run</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => tracker.startRun('simulated')}
                      className="sm:col-span-4 min-h-[52px] w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 active:scale-[0.99] transition-all whitespace-nowrap"
                    >
                      <Activity className="w-4 h-4 shrink-0" />
                      <span>Simulate Run</span>
                    </button>
                  </div>
                )}

                {isRunning && (
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
