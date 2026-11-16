import React, { useEffect, useRef } from 'react';
import type { DistanceUnit } from '../types/run';
import { formatSpeed } from '../utils/geo';

interface SpeedPulseStripProps {
  liveSpeedKmh: number;
  maxSpeedKmh: number;
  unit: DistanceUnit;
  isRunning: boolean;
}

interface EffortZone {
  label: string;
  stroke: string;
  glow: string;
  textClass: string;
  dotClass: string;
}

function getEffortZone(speedKmh: number, isRunning: boolean): EffortZone {
  if (!isRunning && speedKmh < 0.6) {
    return {
      label: 'Resting',
      stroke: '#64748B',
      glow: 'rgba(100, 116, 139, 0.45)',
      textClass: 'text-slate-400',
      dotClass: 'bg-slate-400',
    };
  }
  if (speedKmh < 1.0) {
    return {
      label: 'Calm',
      stroke: '#38BDF8',
      glow: 'rgba(56, 189, 248, 0.5)',
      textClass: 'text-sky-400',
      dotClass: 'bg-sky-400',
    };
  }
  if (speedKmh < 8.5) {
    return {
      label: 'Steady Pace',
      stroke: '#10B981',
      glow: 'rgba(16, 185, 129, 0.55)',
      textClass: 'text-emerald-400',
      dotClass: 'bg-emerald-400',
    };
  }
  if (speedKmh < 14.0) {
    return {
      label: 'Fast Tempo',
      stroke: '#F97316',
      glow: 'rgba(249, 115, 22, 0.6)',
      textClass: 'text-orange-400',
      dotClass: 'bg-orange-400',
    };
  }
  return {
    label: 'High Pressure',
    stroke: '#EF4444',
    glow: 'rgba(239, 68, 68, 0.7)',
    textClass: 'text-rose-400',
    dotClass: 'bg-rose-500',
  };
}

// Hospital ECG P-QRS-T waveform kernel for phase t in [0, 1)
function sampleEcgKernel(t: number): number {
  const gauss = (center: number, width: number, amp: number) => {
    const d = (t - center) / width;
    return amp * Math.exp(-0.5 * d * d);
  };
  return (
    gauss(0.18, 0.045, 0.18) + // P wave
    gauss(0.35, 0.018, -0.26) + // Q dip
    gauss(0.4, 0.018, 1.0) + // R spike
    gauss(0.455, 0.02, -0.42) + // S dip
    gauss(0.68, 0.06, 0.26) // T wave
  );
}

export const SpeedPulseStrip: React.FC<SpeedPulseStripProps> = ({
  liveSpeedKmh,
  maxSpeedKmh,
  unit,
  isRunning,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speedRef = useRef(liveSpeedKmh);
  const runningRef = useRef(isRunning);
  speedRef.current = liveSpeedKmh;
  runningRef.current = isRunning;

  const zone = getEffortZone(liveSpeedKmh, isRunning);
  const speedUnit = unit === 'mi' ? 'mph' : 'km/h';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const BUFFER_LEN = 220;
    const samples = new Float32Array(BUFFER_LEN);
    const sampleColors: string[] = new Array(BUFFER_LEN).fill('#64748B');

    let smoothedSpeed = speedRef.current;
    let phase = 0;
    let breathPhase = 0;
    let sampleAccum = 0;
    const STEP_SEC = 1 / 60;
    let lastTime = performance.now();
    let frameId = 0;
    let cssWidth = canvas.clientWidth || 320;
    let cssHeight = canvas.clientHeight || 44;

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssWidth = canvas.clientWidth || 320;
      cssHeight = canvas.clientHeight || 44;
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    syncSize();

    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.002, (now - lastTime) / 1000));
      lastTime = now;

      const targetSpeed = runningRef.current ? speedRef.current : 0;
      smoothedSpeed += (targetSpeed - smoothedSpeed) * Math.min(1, dt * 5.0);

      const activeZone = getEffortZone(smoothedSpeed, runningRef.current);

      sampleAccum += dt;
      while (sampleAccum >= STEP_SEC) {
        sampleAccum -= STEP_SEC;

        // Advance ECG heartbeat/breath frequency based on live speed
        const beatsPerSec =
          smoothedSpeed < 0.4
            ? 0.45
            : Math.min(2.8, 0.85 + smoothedSpeed * 0.11);
        phase = (phase + STEP_SEC * beatsPerSec) % 1;
        breathPhase = (breathPhase + STEP_SEC * 1.6) % (Math.PI * 2);

        // Compute vertical amplitude [-1, 1] scaled smoothly with speed
        let rawVal = 0;
        if (smoothedSpeed < 0.4) {
          rawVal = Math.sin(breathPhase) * 0.08;
        } else {
          const ampScale = Math.min(1.0, 0.24 + (smoothedSpeed / 16) * 0.76);
          const ecg = sampleEcgKernel(phase);
          const microBreath = Math.sin(breathPhase) * 0.05;
          rawVal = (ecg + microBreath) * ampScale;
        }

        // Shift circular sample buffer left and push newest value on right
        samples.copyWithin(0, 1);
        samples[BUFFER_LEN - 1] = rawVal;
        sampleColors.shift();
        sampleColors.push(activeZone.stroke);
      }

      // Draw clinical monitor background grid
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const midY = cssHeight * 0.56;
      ctx.moveTo(0, midY);
      ctx.lineTo(cssWidth, midY);
      const gridStepX = 28;
      for (let gx = gridStepX; gx < cssWidth; gx += gridStepX) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, cssHeight);
      }
      ctx.stroke();

      // Draw smooth multi-colored waveform segments with progressive left-to-right fade
      const stepX = cssWidth / (BUFFER_LEN - 1);
      const maxUpPx = cssHeight * 0.46;
      const maxDownPx = cssHeight * 0.34;

      const toY = (v: number) =>
        v >= 0 ? midY - v * maxUpPx : midY - v * maxDownPx;

      for (let i = 1; i < BUFFER_LEN; i++) {
        const alpha = 0.15 + (i / (BUFFER_LEN - 1)) * 0.85;
        ctx.beginPath();
        ctx.moveTo((i - 1) * stepX, toY(samples[i - 1]));
        ctx.lineTo(i * stepX, toY(samples[i]));
        ctx.strokeStyle = sampleColors[i];
        ctx.globalAlpha = alpha;
        ctx.lineWidth = i > BUFFER_LEN - 30 ? 2.2 : 1.75;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Glowing live tip dot at right edge
      const tipX = cssWidth - 2;
      const tipY = toY(samples[BUFFER_LEN - 1]);
      ctx.beginPath();
      ctx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = activeZone.stroke;
      ctx.shadowColor = activeZone.glow;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="w-full rounded-2xl bg-slate-950 border border-slate-800 px-3.5 py-2 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${zone.dotClass} ${
              isRunning ? 'animate-pulse' : ''
            }`}
          />
          <span className="text-[11px] font-semibold text-slate-300 truncate">
            Speed Pulse
          </span>
          <span className={`text-[11px] font-bold ${zone.textClass} truncate`}>
            · {zone.label}
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums shrink-0">
          <span className="text-white font-bold">
            {formatSpeed(liveSpeedKmh, unit)}{' '}
            <span className="text-slate-400 font-normal">{speedUnit}</span>
          </span>
          <span className="text-slate-400 hidden sm:inline">
            Peak {formatSpeed(maxSpeedKmh, unit)} {speedUnit}
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full h-11 block"
        aria-label="Live speed ECG pulse waveform"
      />
    </div>
  );
};
