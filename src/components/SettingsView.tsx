import React, { useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import type { MapStyle, UserSettings } from '../types/run';
import { getLocalStorageStats } from '../utils/storage';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  settings: UserSettings;
  onChangeSettings: (next: UserSettings) => void;
  onClearAllRuns: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onChangeSettings,
  onClearAllRuns,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const storageStats = getLocalStorageStats();

  const update = <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    onChangeSettings({ ...settings, [key]: value });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 lg:pb-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Tracker Settings
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Preferences and run data stay 100% offline in your browser
            localStorage.
          </p>
        </div>
        <PWAInstallButton />
      </div>

      {/* Units & Metrics */}
      <section className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Distance &amp; Speed Unit
            </p>
            <p className="text-xs text-slate-500">
              Applies to live speed, pace splits, and history totals.
            </p>
          </div>
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => update('unit', 'km')}
              className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                settings.unit === 'km'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kilometers (km)
            </button>
            <button
              type="button"
              onClick={() => update('unit', 'mi')}
              className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                settings.unit === 'mi'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Miles (mi)
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <label
              htmlFor="weekly-goal-input"
              className="text-sm font-semibold text-slate-900 block"
            >
              Weekly Distance Goal ({settings.unit})
            </label>
            <p className="text-xs text-slate-500">
              Displayed in your weekly progress ring on the History tab.
            </p>
          </div>
          <input
            id="weekly-goal-input"
            type="number"
            min={1}
            max={500}
            value={settings.weeklyGoalKm}
            onChange={(e) => {
              const val = Math.max(1, Math.min(500, Number(e.target.value) || 1));
              update('weeklyGoalKm', val);
            }}
            className="w-28 min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-right font-mono text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <label
              htmlFor="body-weight-input"
              className="text-sm font-semibold text-slate-900 block"
            >
              Body Weight (kg)
            </label>
            <p className="text-xs text-slate-500">
              Used for offline calorie burn estimation during runs.
            </p>
          </div>
          <input
            id="body-weight-input"
            type="number"
            min={30}
            max={250}
            value={settings.weightKg}
            onChange={(e) => {
              const val = Math.max(
                30,
                Math.min(250, Number(e.target.value) || 70)
              );
              update('weightKg', val);
            }}
            className="w-28 min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-right font-mono text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </section>

      {/* Map & Audio */}
      <section className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
        <div className="p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Free Open-Source Map Style
            </p>
            <p className="text-xs text-slate-500">
              Visited tiles are cached automatically for offline viewing.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'standard', label: 'OpenStreetMap' },
                { id: 'topo', label: 'Topo Terrain' },
                { id: 'dark', label: 'Night Dark' },
              ] as { id: MapStyle; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => update('mapStyle', opt.id)}
                className={`min-h-[44px] rounded-xl border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  settings.mapStyle === opt.id
                    ? 'border-orange-600 bg-orange-50 text-orange-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Split Milestone Chime
            </p>
            <p className="text-xs text-slate-500">
              Plays a gentle offline tone after each completed {settings.unit}.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.soundCues}
            onClick={() => update('soundCues', !settings.soundCues)}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              settings.soundCues ? 'bg-orange-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                settings.soundCues ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Auto-Follow Runner on Map
            </p>
            <p className="text-xs text-slate-500">
              Keep the live map centered on your current GPS position.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.autoCenter}
            onClick={() => update('autoCenter', !settings.autoCenter)}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              settings.autoCenter ? 'bg-orange-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                settings.autoCenter ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Local Storage Info */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Local Storage Usage
            </p>
            <p className="text-xs text-slate-500 font-mono">
              {storageStats.runCount} saved runs · ~{storageStats.usedKB} KB used
            </p>
          </div>
        </div>

        {storageStats.runCount > 0 && (
          <div>
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClearAllRuns();
                    setConfirmClear(false);
                  }}
                  className="min-h-[44px] rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
                >
                  Yes, Delete All
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Clear All Runs</span>
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
