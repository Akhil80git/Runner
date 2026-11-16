import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { MapStyle, RunRecord, DistanceUnit } from '../types/run';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
} from '../utils/geo';
import { RoutePreviewMap } from './RoutePreviewMap';

interface RunSummaryModalProps {
  run: RunRecord;
  unit: DistanceUnit;
  mapStyle: MapStyle;
  onSaveDetails: (id: string, title: string, notes: string) => void;
  onClose: () => void;
  onViewHistory: () => void;
}

export const RunSummaryModal: React.FC<RunSummaryModalProps> = ({
  run,
  unit,
  mapStyle,
  onSaveDetails,
  onClose,
  onViewHistory,
}) => {
  const [title, setTitle] = useState(run.title);
  const [notes, setNotes] = useState(run.notes ?? '');

  const speedUnit = unit === 'mi' ? 'mph' : 'km/h';

  const handleDone = () => {
    onSaveDetails(run.id, title.trim() || run.title, notes.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl bg-white border border-slate-200 shadow-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-emerald-700">
              Saved to Local Storage
            </p>
            <h3 className="mt-0.5 text-xl font-bold text-slate-900">
              Run Complete
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close summary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <RoutePreviewMap
          points={run.points}
          splits={run.splits}
          mapStyle={mapStyle}
          className="h-52 w-full"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-xl bg-slate-50 p-3">
            <span className="text-[11px] text-slate-500">Distance</span>
            <p className="mt-0.5 font-mono text-base font-bold text-slate-900">
              {formatDistance(run.distanceMeters, unit)} {unit}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <span className="text-[11px] text-slate-500">Duration</span>
            <p className="mt-0.5 font-mono text-base font-bold text-slate-900">
              {formatDuration(run.durationMs)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <span className="text-[11px] text-slate-500">Avg Pace</span>
            <p className="mt-0.5 font-mono text-base font-bold text-slate-900">
              {formatPace(run.avgPaceSecPerKm, unit)} /{unit}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <span className="text-[11px] text-slate-500">Avg Speed</span>
            <p className="mt-0.5 font-mono text-base font-bold text-slate-900">
              {formatSpeed(run.avgSpeedKmh, unit)} {speedUnit}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="summary-title"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Run Name
            </label>
            <input
              id="summary-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label
              htmlFor="summary-notes"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Notes (Optional)
            </label>
            <input
              id="summary-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How did the legs feel?"
              className="w-full min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => {
              onSaveDetails(run.id, title.trim() || run.title, notes.trim());
              onClose();
              onViewHistory();
            }}
            className="min-h-[48px] flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
          >
            View History
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="min-h-[48px] flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 transition-colors"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>Save &amp; Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};
