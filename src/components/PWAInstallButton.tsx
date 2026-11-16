import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          void install();
        }}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white font-medium transition-colors hover:bg-slate-800 active:scale-[0.98] whitespace-nowrap shrink-0 min-h-[44px] ${
          compact ? 'px-3 py-2 text-xs' : 'px-4 py-2 text-sm'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 min-h-[44px]"
        >
          <Share className="w-3.5 h-3.5 shrink-0" />
          <span>Install App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-lg font-bold text-slate-900">
                  Install PaceTrail on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Close installation guide"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="mt-3 space-y-2.5 text-sm text-slate-600 leading-relaxed">
                <li>
                  1. Tap the <strong className="text-slate-900">Share</strong>{' '}
                  button in Safari&apos;s toolbar.
                </li>
                <li>
                  2. Scroll down and choose{' '}
                  <strong className="text-slate-900">Add to Home Screen</strong>.
                </li>
                <li>
                  3. Open PaceTrail from your home screen for full offline use.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
