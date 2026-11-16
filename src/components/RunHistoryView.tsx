import React, { useMemo, useRef, useState } from 'react';
import {
  Download,
  FileDown,
  MapPin,
  Navigation,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import type { RunRecord, UserSettings } from '../types/run';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  generateGPX,
  METERS_PER_MILE,
} from '../utils/geo';
import { RoutePreviewMap } from './RoutePreviewMap';

interface RunHistoryViewProps {
  runs: RunRecord[];
  settings: UserSettings;
  onUpdateRun: (id: string, updates: { title?: string; notes?: string }) => void;
  onDeleteRun: (id: string) => void;
  onImportJSON: (jsonText: string) => void;
  onStartNewRun: () => void;
  onTrackRoute: (run: RunRecord) => void;
}

export const RunHistoryView: React.FC<RunHistoryViewProps> = ({
  runs,
  settings,
  onUpdateRun,
  onDeleteRun,
  onImportJSON,
  onStartNewRun,
  onTrackRoute,
}) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    runs[0]?.id ?? null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedRun = useMemo(() => {
    if (runs.length === 0) return null;
    return runs.find((r) => r.id === selectedRunId) ?? runs[0];
  }, [runs, selectedRunId]);

  const stats = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diffToMon = day === 0 ? 6 : day - 1;
    startOfWeek.setDate(startOfWeek.getDate() - diffToMon);
    startOfWeek.setHours(0, 0, 0, 0);
    const weekStartMs = startOfWeek.getTime();

    let totalMeters = 0;
    let totalMs = 0;
    let weekMeters = 0;
    let bestPace = Infinity;

    for (const r of runs) {
      totalMeters += r.distanceMeters;
      totalMs += r.durationMs;
      if (r.startedAt >= weekStartMs) {
        weekMeters += r.distanceMeters;
      }
      if (
        r.distanceMeters >= 400 &&
        r.avgPaceSecPerKm > 0 &&
        r.avgPaceSecPerKm < bestPace
      ) {
        bestPace = r.avgPaceSecPerKm;
      }
    }

    const goalMeters =
      settings.unit === 'mi'
        ? settings.weeklyGoalKm * METERS_PER_MILE
        : settings.weeklyGoalKm * 1000;
    const goalPct =
      goalMeters > 0 ? Math.min(100, (weekMeters / goalMeters) * 100) : 0;

    return {
      totalMeters,
      totalMs,
      weekMeters,
      goalPct,
      bestPace: bestPace === Infinity ? 0 : bestPace,
    };
  }, [runs, settings.unit, settings.weeklyGoalKm]);

  const handleDownloadGPX = (run: RunRecord) => {
    const gpx = generateGPX(run);
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${run.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'run'}.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportAllJSON = () => {
    const blob = new Blob([JSON.stringify(runs, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pacetrail-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      onImportJSON(text);
      setImportMessage('Runs imported into local storage.');
    } catch (err) {
      setImportMessage(
        err instanceof Error ? err.message : 'Failed to import JSON file.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const startEditing = (run: RunRecord) => {
    setEditingId(run.id);
    setDraftTitle(run.title);
    setDraftNotes(run.notes ?? '');
  };

  const saveEdit = (id: string) => {
    onUpdateRun(id, {
      title: draftTitle.trim() || 'Untitled Run',
      notes: draftNotes.trim(),
    });
    setEditingId(null);
  };

  const unitLabel = settings.unit;
  const speedUnitLabel = settings.unit === 'mi' ? 'mph' : 'km/h';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 lg:pb-10 space-y-6">
      {/* Weekly Goal & Cumulative Totals */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 flex items-center gap-5">
          <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r="33"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="7"
              />
              <circle
                cx="40"
                cy="40"
                r="33"
                fill="none"
                stroke="#EA580C"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 33}
                strokeDashoffset={
                  2 * Math.PI * 33 * (1 - stats.goalPct / 100)
                }
              />
            </svg>
            <span className="absolute font-mono text-sm font-bold text-slate-900">
              {Math.round(stats.goalPct)}%
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">Weekly Goal</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900">
              {formatDistance(stats.weekMeters, unitLabel)}{' '}
              <span className="text-sm font-normal text-slate-500">
                / {settings.weeklyGoalKm} {unitLabel}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Saved locally in browser storage
            </p>
          </div>
        </div>

        <div className="md:col-span-7 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">
              Total Distance
            </span>
            <p className="mt-2 font-mono text-xl sm:text-2xl font-bold text-slate-900">
              {formatDistance(stats.totalMeters, unitLabel)}{' '}
              <span className="text-xs font-normal text-slate-500">
                {unitLabel}
              </span>
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">
              Total Runs
            </span>
            <p className="mt-2 font-mono text-xl sm:text-2xl font-bold text-slate-900">
              {runs.length}
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">
              Best Avg Pace
            </span>
            <p className="mt-2 font-mono text-xl sm:text-2xl font-bold text-slate-900">
              {formatPace(stats.bestPace, unitLabel)}{' '}
              <span className="text-xs font-normal text-slate-500">
                /{unitLabel}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Run History</h2>
          {importMessage && (
            <p className="mt-1 text-xs text-emerald-700 font-medium">
              {importMessage}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4 shrink-0" />
            <span>Import JSON</span>
          </button>

          {runs.length > 0 && (
            <button
              type="button"
              onClick={handleExportAllJSON}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Backup JSON</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {runs.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600">
            <MapPin className="w-6 h-6" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-900">
            No runs recorded yet
          </h3>
          <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
            Start a GPS run outdoors or test with Simulate Run. Every route,
            speed, and split is automatically saved offline in your browser.
          </p>
          <button
            type="button"
            onClick={onStartNewRun}
            className="mt-6 min-h-[44px] inline-flex items-center justify-center rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 transition-colors whitespace-nowrap"
          >
            Go to Live Tracker
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Run List */}
          <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {runs.map((run) => {
              const isSelected = selectedRun?.id === run.id;
              const dateStr = new Date(run.startedAt).toLocaleDateString(
                undefined,
                {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }
              );
              const timeStr = new Date(run.startedAt).toLocaleTimeString(
                undefined,
                {
                  hour: '2-digit',
                  minute: '2-digit',
                }
              );

              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => {
                    setSelectedRunId(run.id);
                    setEditingId(null);
                    setConfirmDeleteId(null);
                  }}
                  className={`w-full text-left px-4 py-3.5 transition-colors flex items-center justify-between gap-3 min-h-[64px] ${
                    isSelected
                      ? 'bg-orange-50/70'
                      : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        isSelected ? 'text-orange-950' : 'text-slate-900'
                      }`}
                    >
                      {run.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 flex items-center gap-1.5 truncate">
                      <span>{dateStr}</span>
                      <span aria-hidden="true">·</span>
                      <span>{timeStr}</span>
                      {run.source === 'simulated' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Simulated</span>
                        </>
                      )}
                    </p>
                    {run.notes && run.notes.trim().length > 0 && (
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2 break-words">
                        {run.notes}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-bold text-slate-900">
                      {formatDistance(run.distanceMeters, unitLabel)} {unitLabel}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {formatDuration(run.durationMs)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Run Details */}
          {selectedRun && (
            <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 space-y-5">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                {editingId === selectedRun.id ? (
                  <div className="w-full space-y-3">
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 text-base font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Run title"
                    />
                    <textarea
                      value={draftNotes}
                      onChange={(e) => setDraftNotes(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Add route notes, weather, or how you felt..."
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(selectedRun.id)}
                        className="min-h-[44px] rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        Save Changes
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold text-slate-900">
                        {selectedRun.title}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {new Date(selectedRun.startedAt).toLocaleString()}
                        {selectedRun.source === 'simulated'
                          ? ' · Simulated GPS'
                          : ' · Live GPS'}
                      </p>
                      {selectedRun.notes && (
                        <p className="mt-2 text-sm text-slate-600">
                          {selectedRun.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {selectedRun.points.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onTrackRoute(selectedRun)}
                          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-orange-700 active:scale-[0.98] transition-all whitespace-nowrap"
                          title="Follow this route in real time to Point A or B"
                        >
                          <Navigation className="w-3.5 h-3.5 shrink-0" />
                          <span>Track Route</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEditing(selectedRun)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
                        title="Edit run title & notes"
                        aria-label="Edit run"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadGPX(selectedRun)}
                        className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        title="Export GPX route"
                      >
                        <FileDown className="w-4 h-4 shrink-0" />
                        <span>GPX</span>
                      </button>
                      {confirmDeleteId === selectedRun.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteRun(selectedRun.id);
                            setConfirmDeleteId(null);
                          }}
                          className="min-h-[44px] rounded-xl bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
                        >
                          Confirm Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(selectedRun.id)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 text-red-600 hover:bg-red-50"
                          title="Delete run"
                          aria-label="Delete run"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Route Map */}
              <RoutePreviewMap
                points={selectedRun.points}
                splits={selectedRun.splits}
                mapStyle={settings.mapStyle}
                className="h-64 sm:h-72 w-full"
              />

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <span className="text-xs text-slate-500">Distance</span>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                    {formatDistance(selectedRun.distanceMeters, unitLabel)}{' '}
                    {unitLabel}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <span className="text-xs text-slate-500">Duration</span>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                    {formatDuration(selectedRun.durationMs)}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <span className="text-xs text-slate-500">Avg Pace</span>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                    {formatPace(selectedRun.avgPaceSecPerKm, unitLabel)} /
                    {unitLabel}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <span className="text-xs text-slate-500">Avg Speed</span>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                    {formatSpeed(selectedRun.avgSpeedKmh, unitLabel)}{' '}
                    {speedUnitLabel}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <span className="text-xs text-slate-500">Max Speed</span>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                    {formatSpeed(selectedRun.maxSpeedKmh, unitLabel)}{' '}
                    {speedUnitLabel}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <span className="text-xs text-slate-500">Calories</span>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                    {selectedRun.calories} kcal
                  </p>
                </div>
              </div>

              {/* Splits Table */}
              {selectedRun.splits.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 mb-2">
                    Splits ({unitLabel === 'mi' ? 'Per Mile' : 'Per Kilometer'})
                  </h4>
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-3.5 py-2.5 font-medium">Split</th>
                          <th className="px-3.5 py-2.5 font-medium">Time</th>
                          <th className="px-3.5 py-2.5 font-medium">Pace</th>
                          <th className="px-3.5 py-2.5 font-medium">Speed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-slate-800">
                        {selectedRun.splits.map((s) => (
                          <tr key={s.index}>
                            <td className="px-3.5 py-2.5 font-semibold">
                              {s.index} {unitLabel}
                            </td>
                            <td className="px-3.5 py-2.5">
                              {formatDuration(s.durationMs)}
                            </td>
                            <td className="px-3.5 py-2.5">
                              {formatPace(s.paceSecPerKm, unitLabel)} /
                              {unitLabel}
                            </td>
                            <td className="px-3.5 py-2.5">
                              {formatSpeed(s.speedKmh, unitLabel)}{' '}
                              {speedUnitLabel}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
