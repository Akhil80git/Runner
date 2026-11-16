import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, History, LocateFixed, WifiOff } from 'lucide-react';
import type {
  GuideRouteState,
  GuideTarget,
  MapStyle,
  RunRecord,
  SplitRecord,
  TrackPoint,
} from '../types/run';
import {
  buildColoredLegSegments,
  chaikinSmoothCoords,
  getLegColor,
  type RouteGuidanceInfo,
} from '../utils/geo';
import {
  createOfflineGridLayer,
  getFreeTileConfig,
  TRANSPARENT_TILE_DATA_URL,
} from '../utils/leafletOfflineGrid';

interface LiveMapProps {
  points: TrackPoint[];
  splits: SplitRecord[];
  pastRuns?: RunRecord[];
  currentLegIndex?: number;
  currentLocation: TrackPoint | null;
  mapStyle: MapStyle;
  onChangeMapStyle: (style: MapStyle) => void;
  autoCenter: boolean;
  onToggleAutoCenter: (next: boolean) => void;
  isOnline: boolean;
  isRunning: boolean;
  guideRoute?: GuideRouteState | null;
  guideGuidance?: RouteGuidanceInfo | null;
  onSelectGuideTarget?: (target: GuideTarget) => void;
}

const DEFAULT_VIEW: [number, number] = [28.6129, 77.2295];

export const LiveMap: React.FC<LiveMapProps> = ({
  points,
  splits,
  pastRuns = [],
  currentLegIndex = 0,
  currentLocation,
  mapStyle,
  onChangeMapStyle,
  autoCenter,
  onToggleAutoCenter,
  isOnline,
  isRunning,
  guideRoute = null,
  guideGuidance = null,
  onSelectGuideTarget,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const offlineGridRef = useRef<L.GridLayer | null>(null);

  const pastRunsLayerRef = useRef<L.LayerGroup | null>(null);
  const guideStaticLayerRef = useRef<L.LayerGroup | null>(null);
  const guideDynamicLayerRef = useRef<L.LayerGroup | null>(null);
  const remainingCasingRef = useRef<L.Polyline | null>(null);
  const remainingLineRef = useRef<L.Polyline | null>(null);
  const offRouteLineRef = useRef<L.Polyline | null>(null);

  const activeCasingGroupRef = useRef<L.LayerGroup | null>(null);
  const activeGapGroupRef = useRef<L.LayerGroup | null>(null);
  const activeColorGroupRef = useRef<L.LayerGroup | null>(null);
  const casingPoolRef = useRef<L.Polyline[]>([]);
  const colorPoolRef = useRef<L.Polyline[]>([]);
  const gapPoolRef = useRef<L.Polyline[]>([]);
  const gapDotPoolRef = useRef<L.CircleMarker[]>([]);

  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const currentMarkerRef = useRef<L.CircleMarker | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);
  const splitMarkersLayerRef = useRef<L.LayerGroup | null>(null);

  const hasCenteredInitialRef = useRef(false);
  const lastFittedGuideIdRef = useRef<string | null>(null);
  const lastMarkerPosRef = useRef<[number, number] | null>(null);
  const lastPannedPosRef = useRef<[number, number] | null>(null);
  const markerAnimFrameRef = useRef<number | null>(null);
  const onSelectGuideTargetRef = useRef(onSelectGuideTarget);
  onSelectGuideTargetRef.current = onSelectGuideTarget;

  const [tileOfflineFallback, setTileOfflineFallback] = useState(false);
  const [showPastRuns, setShowPastRuns] = useState(false);

  const isGuideActive = Boolean(guideRoute && guideRoute.target);
  const activeLegColor = isGuideActive
    ? '#EA580C'
    : getLegColor(currentLegIndex);

  // Initialize hardware-accelerated Canvas Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = currentLocation
      ? [currentLocation.lat, currentLocation.lng]
      : DEFAULT_VIEW;

    const canvasRenderer = L.canvas({ padding: 0.5 });
    canvasRendererRef.current = canvasRenderer;

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      renderer: canvasRenderer,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    map.on('dragstart', () => {
      onToggleAutoCenter(false);
    });

    pastRunsLayerRef.current = L.layerGroup().addTo(map);
    guideStaticLayerRef.current = L.layerGroup().addTo(map);
    guideDynamicLayerRef.current = L.layerGroup().addTo(map);
    activeCasingGroupRef.current = L.layerGroup().addTo(map);
    activeGapGroupRef.current = L.layerGroup().addTo(map);
    activeColorGroupRef.current = L.layerGroup().addTo(map);
    splitMarkersLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (markerAnimFrameRef.current !== null) {
        cancelAnimationFrame(markerAnimFrameRef.current);
      }
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      canvasRendererRef.current = null;
      casingPoolRef.current = [];
      colorPoolRef.current = [];
      gapPoolRef.current = [];
      gapDotPoolRef.current = [];
      remainingCasingRef.current = null;
      remainingLineRef.current = null;
      offRouteLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update tile layer & offline fallback grid when mapStyle or online status changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    if (offlineGridRef.current) {
      map.removeLayer(offlineGridRef.current);
      offlineGridRef.current = null;
    }

    const cfg = getFreeTileConfig(mapStyle);
    const gridLayer = createOfflineGridLayer(cfg.isDark);
    gridLayer.addTo(map);
    offlineGridRef.current = gridLayer;

    let errorCount = 0;
    const tileLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      subdomains: cfg.subdomains,
      maxZoom: cfg.maxZoom,
      zIndex: 2,
      keepBuffer: 4,
      updateWhenZooming: false,
      errorTileUrl: TRANSPARENT_TILE_DATA_URL,
    });

    tileLayer.on('tileload', () => {
      errorCount = 0;
      setTileOfflineFallback(false);
    });

    tileLayer.on('tileerror', () => {
      errorCount += 1;
      if (!navigator.onLine || errorCount >= 3) {
        setTileOfflineFallback(true);
      }
    });

    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;
  }, [mapStyle, isOnline]);

  // Render past saved runs with distinct automatic colors when enabled
  useEffect(() => {
    const layer = pastRunsLayerRef.current;
    const renderer = canvasRendererRef.current ?? undefined;
    if (!layer) return;
    layer.clearLayers();

    if (!showPastRuns || pastRuns.length === 0) return;

    pastRuns.slice(0, 12).forEach((run, runIdx) => {
      if (run.points.length < 2) return;
      const segments = buildColoredLegSegments(run.points, (runIdx + 1) * 2);
      segments.forEach((seg) => {
        L.polyline(seg.latLngs, {
          renderer,
          color: '#FFFFFF',
          weight: 5.5,
          opacity: 0.55,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(layer);

        L.polyline(seg.latLngs, {
          renderer,
          color: seg.color,
          weight: 3,
          opacity: 0.65,
          dashArray: '6 5',
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(layer);
      });
    });
  }, [pastRuns, showPastRuns]);

  // Static Guide Route (base trail + clickable A/B pins) — ONLY updates when route/target changes, zero GPS-tick flicker
  useEffect(() => {
    const map = mapRef.current;
    const guideStatic = guideStaticLayerRef.current;
    const renderer = canvasRendererRef.current ?? undefined;
    if (!map || !guideStatic) return;

    guideStatic.clearLayers();

    if (!guideRoute || guideRoute.run.points.length === 0) {
      lastFittedGuideIdRef.current = null;
      return;
    }

    const gPts = guideRoute.run.points;
    const rawBaseLatLngs: [number, number][] = gPts.map((p) => [p.lat, p.lng]);
    const baseLatLngs = chaikinSmoothCoords(
      rawBaseLatLngs,
      rawBaseLatLngs.length > 350 ? 1 : 2
    );

    if (baseLatLngs.length >= 2) {
      L.polyline(baseLatLngs, {
        renderer,
        color: '#FFFFFF',
        weight: 8,
        opacity: 0.72,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 2,
        interactive: false,
      }).addTo(guideStatic);

      L.polyline(baseLatLngs, {
        renderer,
        color: '#475569',
        weight: 3.5,
        opacity: 0.55,
        dashArray: '6 7',
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 2,
        interactive: false,
      }).addTo(guideStatic);
    }

    const ptA: [number, number] = [gPts[0].lat, gPts[0].lng];
    const ptB: [number, number] = [
      gPts[gPts.length - 1].lat,
      gPts[gPts.length - 1].lng,
    ];
    const isASelected = guideRoute.target === 'A';
    const isBSelected = guideRoute.target === 'B';

    const createEndpointPin = (label: 'A' | 'B', selected: boolean) => {
      const bg = selected
        ? '#0284C7'
        : label === 'A'
          ? '#059669'
          : '#0F172A';
      const size = selected ? 34 : 28;
      const ring = selected
        ? 'box-shadow:0 0 0 4px rgba(2,132,199,0.28),0 4px 10px rgba(15,23,42,0.4);'
        : 'box-shadow:0 2px 8px rgba(15,23,42,0.35);';
      return L.divIcon({
        className: `pacetrail-guide-pin-${label.toLowerCase()}`,
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:#FFFFFF;border:3px solid #FFFFFF;font-size:${selected ? 13 : 11}px;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:pointer;${ring}font-family:Inter,sans-serif;">${label}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    };

    const markerA = L.marker(ptA, {
      icon: createEndpointPin('A', isASelected),
      zIndexOffset: isASelected ? 900 : 500,
    }).addTo(guideStatic);
    markerA.on('click', () => {
      onSelectGuideTargetRef.current?.('A');
    });

    if (gPts.length > 1) {
      const markerB = L.marker(ptB, {
        icon: createEndpointPin('B', isBSelected),
        zIndexOffset: isBSelected ? 900 : 500,
      }).addTo(guideStatic);
      markerB.on('click', () => {
        onSelectGuideTargetRef.current?.('B');
      });
    }

    if (lastFittedGuideIdRef.current !== guideRoute.run.id) {
      lastFittedGuideIdRef.current = guideRoute.run.id;
      hasCenteredInitialRef.current = true;
      const boundsCoords: [number, number][] = [...baseLatLngs];
      if (currentLocation) {
        boundsCoords.push([currentLocation.lat, currentLocation.lng]);
      }
      if (boundsCoords.length > 1) {
        map.fitBounds(L.latLngBounds(boundsCoords), {
          padding: [42, 42],
          maxZoom: 17,
        });
      } else {
        map.setView(boundsCoords[0], 16, { animate: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideRoute?.run.id, guideRoute?.target]);

  // Dynamic Remaining Guide Path — updates in place via setLatLngs (zero layer destruction/flicker)
  useEffect(() => {
    const guideDyn = guideDynamicLayerRef.current;
    const renderer = canvasRendererRef.current ?? undefined;
    if (!guideDyn) return;

    const ensureGuideLines = () => {
      if (!remainingCasingRef.current) {
        remainingCasingRef.current = L.polyline([], {
          renderer,
          color: '#FFFFFF',
          weight: 9,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 2,
          interactive: false,
        }).addTo(guideDyn);
      }
      if (!remainingLineRef.current) {
        remainingLineRef.current = L.polyline([], {
          renderer,
          color: '#0284C7',
          weight: 4.5,
          opacity: 0.88,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 2,
          interactive: false,
        }).addTo(guideDyn);
      }
      if (!offRouteLineRef.current) {
        offRouteLineRef.current = L.polyline([], {
          renderer,
          color: '#0284C7',
          weight: 3.5,
          opacity: 0.9,
          dashArray: '3 7',
          lineCap: 'round',
          interactive: false,
        }).addTo(guideDyn);
      }
    };

    if (!isGuideActive || !guideGuidance || guideGuidance.arrived) {
      remainingCasingRef.current?.setLatLngs([]);
      remainingLineRef.current?.setLatLngs([]);
      offRouteLineRef.current?.setLatLngs([]);
      return;
    }

    ensureGuideLines();

    if (guideGuidance.remainingCoords.length >= 2) {
      const smoothRemaining = chaikinSmoothCoords(
        guideGuidance.remainingCoords,
        guideGuidance.remainingCoords.length > 350 ? 1 : 2
      );
      remainingCasingRef.current?.setLatLngs(smoothRemaining);
      remainingLineRef.current?.setLatLngs(smoothRemaining);
    } else {
      remainingCasingRef.current?.setLatLngs([]);
      remainingLineRef.current?.setLatLngs([]);
    }

    if (guideGuidance.isOffRoute && currentLocation) {
      offRouteLineRef.current?.setLatLngs([
        [currentLocation.lat, currentLocation.lng],
        guideGuidance.snappedPoint,
      ]);
    } else {
      offRouteLineRef.current?.setLatLngs([]);
    }
  }, [isGuideActive, guideGuidance, currentLocation]);

  // Active Route Polyline Pool — updates coordinates in place with zero clearLayers() refresh/flicker
  useEffect(() => {
    const map = mapRef.current;
    const casingGroup = activeCasingGroupRef.current;
    const gapGroup = activeGapGroupRef.current;
    const colorGroup = activeColorGroupRef.current;
    const renderer = canvasRendererRef.current ?? undefined;
    if (!map || !casingGroup || !gapGroup || !colorGroup) return;

    const segments = buildColoredLegSegments(points);
    const solidSegs = segments.filter((s) => !s.isPauseGap);
    const gapSegs = segments.filter((s) => s.isPauseGap);

    const casingWeight = isGuideActive ? 9 : 8;
    const lineWeight = isGuideActive ? 5.4 : 4.8;

    // 1. Update solid casings + colored lines in place
    for (let i = 0; i < solidSegs.length; i++) {
      const seg = solidSegs[i];
      const lineColor = isGuideActive ? '#EA580C' : seg.color;

      let casing = casingPoolRef.current[i];
      if (!casing) {
        casing = L.polyline(seg.latLngs, {
          renderer,
          color: '#FFFFFF',
          weight: casingWeight,
          opacity: 0.92,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 1.5,
          interactive: false,
        }).addTo(casingGroup);
        casingPoolRef.current.push(casing);
      } else {
        casing.setLatLngs(seg.latLngs);
        casing.setStyle({ weight: casingWeight });
      }

      let colorLine = colorPoolRef.current[i];
      if (!colorLine) {
        colorLine = L.polyline(seg.latLngs, {
          renderer,
          color: lineColor,
          weight: lineWeight,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 1.5,
          interactive: false,
        }).addTo(colorGroup);
        colorPoolRef.current.push(colorLine);
      } else {
        colorLine.setLatLngs(seg.latLngs);
        colorLine.setStyle({ color: lineColor, weight: lineWeight });
      }
    }

    // Trim unused pool layers only when points reset (e.g. discarded/new run)
    while (casingPoolRef.current.length > solidSegs.length) {
      const removed = casingPoolRef.current.pop();
      if (removed) casingGroup.removeLayer(removed);
    }
    while (colorPoolRef.current.length > solidSegs.length) {
      const removed = colorPoolRef.current.pop();
      if (removed) colorGroup.removeLayer(removed);
    }

    // 2. Update dotted pause-gap bridges + pause/resume dots in place
    let dotCursor = 0;
    for (let i = 0; i < gapSegs.length; i++) {
      const seg = gapSegs[i];
      let gapLine = gapPoolRef.current[i];
      if (!gapLine) {
        gapLine = L.polyline(seg.latLngs, {
          renderer,
          color: '#475569',
          weight: 3.5,
          opacity: 0.85,
          dashArray: '1 9',
          lineCap: 'round',
          interactive: false,
        }).addTo(gapGroup);
        gapPoolRef.current.push(gapLine);
      } else {
        gapLine.setLatLngs(seg.latLngs);
      }

      const [pausePt, resumePt] = seg.latLngs;
      if (pausePt) {
        let pauseDot = gapDotPoolRef.current[dotCursor];
        if (!pauseDot) {
          pauseDot = L.circleMarker(pausePt, {
            renderer,
            radius: 4.5,
            fillColor: '#475569',
            color: '#FFFFFF',
            weight: 2,
            fillOpacity: 1,
            interactive: false,
          }).addTo(gapGroup);
          gapDotPoolRef.current.push(pauseDot);
        } else {
          pauseDot.setLatLng(pausePt);
          pauseDot.setStyle({ fillColor: '#475569' });
        }
        dotCursor += 1;
      }
      if (resumePt) {
        const resumeColor = isGuideActive ? '#EA580C' : getLegColor(seg.legIndex);
        let resumeDot = gapDotPoolRef.current[dotCursor];
        if (!resumeDot) {
          resumeDot = L.circleMarker(resumePt, {
            renderer,
            radius: 4.5,
            fillColor: resumeColor,
            color: '#FFFFFF',
            weight: 2,
            fillOpacity: 1,
            interactive: false,
          }).addTo(gapGroup);
          gapDotPoolRef.current.push(resumeDot);
        } else {
          resumeDot.setLatLng(resumePt);
          resumeDot.setStyle({ fillColor: resumeColor });
        }
        dotCursor += 1;
      }
    }

    while (gapPoolRef.current.length > gapSegs.length) {
      const removed = gapPoolRef.current.pop();
      if (removed) gapGroup.removeLayer(removed);
    }
    while (gapDotPoolRef.current.length > dotCursor) {
      const removed = gapDotPoolRef.current.pop();
      if (removed) gapGroup.removeLayer(removed);
    }

    // 3. Start marker
    if (points.length > 0) {
      const startPt: [number, number] = [points[0].lat, points[0].lng];
      if (!startMarkerRef.current) {
        startMarkerRef.current = L.circleMarker(startPt, {
          renderer,
          radius: 7,
          fillColor: '#059669',
          color: '#FFFFFF',
          weight: 2.5,
          fillOpacity: 1,
          interactive: false,
        }).addTo(map);
      } else {
        startMarkerRef.current.setLatLng(startPt);
      }
    } else if (startMarkerRef.current) {
      map.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }
  }, [points, isGuideActive]);

  // Split markers — only rebuild when a new split milestone completes (never every GPS second)
  useEffect(() => {
    const splitLayer = splitMarkersLayerRef.current;
    if (!splitLayer) return;
    splitLayer.clearLayers();

    if (splits.length > 0 && points.length > 1) {
      const splitInterval = Math.max(
        1,
        Math.floor(points.length / (splits.length + 1))
      );
      splits.forEach((split, idx) => {
        const ptIdx = Math.min(points.length - 1, (idx + 1) * splitInterval);
        const pt = points[ptIdx];
        if (!pt) return;
        const badgeIcon = L.divIcon({
          className: 'pacetrail-split-pin',
          html: `<div style="width:22px;height:22px;border-radius:9999px;background:#0F172A;color:#FFFFFF;border:2px solid #FFFFFF;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,0.35);font-family:JetBrains Mono,monospace;">${split.index}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        L.marker([pt.lat, pt.lng], {
          icon: badgeIcon,
          interactive: false,
        }).addTo(splitLayer);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splits.length, points.length === 0]);

  // Smooth 60 FPS runner marker glide + linear map pan
  useEffect(() => {
    const map = mapRef.current;
    const renderer = canvasRendererRef.current ?? undefined;
    if (!map || !currentLocation) return;

    const pos: [number, number] = [currentLocation.lat, currentLocation.lng];

    if (currentLocation.accuracy && currentLocation.accuracy < 120) {
      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = L.circle(pos, {
          renderer,
          radius: currentLocation.accuracy,
          color: activeLegColor,
          fillColor: activeLegColor,
          fillOpacity: 0.1,
          weight: 1,
          opacity: 0.35,
          interactive: false,
        }).addTo(map);
      } else {
        accuracyCircleRef.current.setRadius(currentLocation.accuracy);
        accuracyCircleRef.current.setStyle({
          color: activeLegColor,
          fillColor: activeLegColor,
        });
      }
    }

    if (!currentMarkerRef.current) {
      currentMarkerRef.current = L.circleMarker(pos, {
        renderer,
        radius: 9,
        fillColor: isRunning ? activeLegColor : '#0F172A',
        color: '#FFFFFF',
        weight: 3,
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
      lastMarkerPosRef.current = pos;
    } else {
      currentMarkerRef.current.setStyle({
        fillColor: isRunning ? activeLegColor : '#0F172A',
      });

      const fromPos = lastMarkerPosRef.current ?? pos;
      const dLat = pos[0] - fromPos[0];
      const dLng = pos[1] - fromPos[1];
      const distDeg = Math.hypot(dLat, dLng);

      if (distDeg > 1e-7) {
        if (markerAnimFrameRef.current !== null) {
          cancelAnimationFrame(markerAnimFrameRef.current);
          markerAnimFrameRef.current = null;
        }

        if (distDeg < 0.0025) {
          const startTime = performance.now();
          const duration = 650;
          const step = (now: number) => {
            const t = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - t, 2);
            const interp: [number, number] = [
              fromPos[0] + dLat * eased,
              fromPos[1] + dLng * eased,
            ];
            currentMarkerRef.current?.setLatLng(interp);
            accuracyCircleRef.current?.setLatLng(interp);
            lastMarkerPosRef.current = interp;
            if (t < 1) {
              markerAnimFrameRef.current = requestAnimationFrame(step);
            } else {
              markerAnimFrameRef.current = null;
            }
          };
          markerAnimFrameRef.current = requestAnimationFrame(step);
        } else {
          currentMarkerRef.current.setLatLng(pos);
          accuracyCircleRef.current?.setLatLng(pos);
          lastMarkerPosRef.current = pos;
        }
      }
    }

    if (!hasCenteredInitialRef.current) {
      hasCenteredInitialRef.current = true;
      lastPannedPosRef.current = pos;
      map.setView(pos, 16, { animate: false });
    } else if (autoCenter) {
      const prevPan = lastPannedPosRef.current;
      const panDist = prevPan
        ? Math.hypot(pos[0] - prevPan[0], pos[1] - prevPan[1])
        : 1;
      if (panDist > 1e-6) {
        lastPannedPosRef.current = pos;
        map.panTo(pos, {
          animate: true,
          duration: 0.65,
          easeLinearity: 0.9,
          noMoveStart: true,
        });
      }
    }
  }, [currentLocation, autoCenter, isRunning, activeLegColor]);

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    onToggleAutoCenter(true);
    if (currentLocation) {
      const pos: [number, number] = [currentLocation.lat, currentLocation.lng];
      lastPannedPosRef.current = pos;
      map.setView(pos, 16, { animate: true });
    } else if (points.length > 0) {
      const last = points[points.length - 1];
      const pos: [number, number] = [last.lat, last.lng];
      lastPannedPosRef.current = pos;
      map.setView(pos, 16, { animate: true });
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-200">
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Top-Left Free Map Layer Switcher & Offline Status */}
      <div className="absolute top-3 left-3 z-[400] flex flex-col items-start gap-2">
        <div className="inline-flex items-center gap-1 rounded-xl bg-white/95 backdrop-blur-md p-1 border border-slate-200/80 shadow-md">
          {(
            [
              { id: 'standard', label: 'OSM Street' },
              { id: 'topo', label: 'Topo Terrain' },
              { id: 'dark', label: 'Dark' },
            ] as { id: MapStyle; label: string }[]
          ).map((layer) => (
            <button
              key={layer.id}
              type="button"
              onClick={() => onChangeMapStyle(layer.id)}
              className={`min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                mapStyle === layer.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {layer.label}
            </button>
          ))}
        </div>

        {(!isOnline || tileOfflineFallback) && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-900/90 backdrop-blur-md px-3 py-2 text-xs font-medium text-white shadow-md">
            <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Offline Grid · Route Tracking Active</span>
          </div>
        )}
      </div>

      {/* Map Floating Controls (Top Right) */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-2">
        <button
          type="button"
          onClick={handleRecenter}
          title={autoCenter ? 'Auto-follow active' : 'Recenter map on me'}
          className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl backdrop-blur-md border shadow-md active:scale-95 transition-all ${
            autoCenter
              ? 'bg-orange-600 text-white border-orange-500'
              : 'bg-white/95 text-slate-800 border-slate-200/80 hover:bg-white'
          }`}
          aria-label="Recenter map"
        >
          {autoCenter ? (
            <LocateFixed className="w-5 h-5" />
          ) : (
            <Crosshair className="w-5 h-5" />
          )}
        </button>

        {pastRuns.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPastRuns((prev) => !prev)}
            title={
              showPastRuns
                ? 'Hide past run lines on map'
                : 'Show past run lines on map'
            }
            className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl backdrop-blur-md border shadow-md active:scale-95 transition-all ${
              showPastRuns
                ? 'bg-slate-900 text-white border-slate-800'
                : 'bg-white/95 text-slate-700 border-slate-200/80 hover:bg-white'
            }`}
            aria-label="Toggle past runs overlay"
          >
            <History className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};
