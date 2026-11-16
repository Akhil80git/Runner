import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, LocateFixed, WifiOff } from 'lucide-react';
import type { MapStyle, SplitRecord, TrackPoint } from '../types/run';
import {
  createOfflineGridLayer,
  getFreeTileConfig,
  TRANSPARENT_TILE_DATA_URL,
} from '../utils/leafletOfflineGrid';

interface LiveMapProps {
  points: TrackPoint[];
  splits: SplitRecord[];
  currentLocation: TrackPoint | null;
  mapStyle: MapStyle;
  onChangeMapStyle: (style: MapStyle) => void;
  autoCenter: boolean;
  onToggleAutoCenter: (next: boolean) => void;
  isOnline: boolean;
  isRunning: boolean;
}

const DEFAULT_VIEW: [number, number] = [28.6129, 77.2295];

export const LiveMap: React.FC<LiveMapProps> = ({
  points,
  splits,
  currentLocation,
  mapStyle,
  onChangeMapStyle,
  autoCenter,
  onToggleAutoCenter,
  isOnline,
  isRunning,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const offlineGridRef = useRef<L.GridLayer | null>(null);
  const casingPolylineRef = useRef<L.Polyline | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const currentMarkerRef = useRef<L.CircleMarker | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);
  const splitMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const hasCenteredInitialRef = useRef(false);
  const [tileOfflineFallback, setTileOfflineFallback] = useState(false);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] = currentLocation
      ? [currentLocation.lat, currentLocation.lng]
      : DEFAULT_VIEW;

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    map.on('dragstart', () => {
      onToggleAutoCenter(false);
    });

    casingPolylineRef.current = L.polyline([], {
      color: '#FFFFFF',
      weight: 8,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    routePolylineRef.current = L.polyline([], {
      color: '#EA580C',
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    splitMarkersLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
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

  // Update route polyline, start pin, and split markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routePolylineRef.current || !casingPolylineRef.current) return;

    const latLngs: L.LatLngExpression[] = points.map((p) => [p.lat, p.lng]);
    casingPolylineRef.current.setLatLngs(latLngs);
    routePolylineRef.current.setLatLngs(latLngs);

    // Start marker
    if (points.length > 0) {
      const startPt: [number, number] = [points[0].lat, points[0].lng];
      if (!startMarkerRef.current) {
        startMarkerRef.current = L.circleMarker(startPt, {
          radius: 7,
          fillColor: '#059669',
          color: '#FFFFFF',
          weight: 2.5,
          fillOpacity: 1,
        }).addTo(map);
      } else {
        startMarkerRef.current.setLatLng(startPt);
      }
    } else if (startMarkerRef.current) {
      map.removeLayer(startMarkerRef.current);
      startMarkerRef.current = null;
    }

    // Split markers along the route
    if (splitMarkersLayerRef.current) {
      splitMarkersLayerRef.current.clearLayers();
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
          L.marker([pt.lat, pt.lng], { icon: badgeIcon, interactive: false }).addTo(
            splitMarkersLayerRef.current!
          );
        });
      }
    }
  }, [points, splits]);

  // Update current runner marker, accuracy ring, and auto-centering
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentLocation) return;

    const pos: [number, number] = [currentLocation.lat, currentLocation.lng];

    if (currentLocation.accuracy && currentLocation.accuracy < 120) {
      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = L.circle(pos, {
          radius: currentLocation.accuracy,
          color: '#EA580C',
          fillColor: '#EA580C',
          fillOpacity: 0.1,
          weight: 1,
          opacity: 0.35,
        }).addTo(map);
      } else {
        accuracyCircleRef.current.setLatLng(pos);
        accuracyCircleRef.current.setRadius(currentLocation.accuracy);
      }
    }

    if (!currentMarkerRef.current) {
      currentMarkerRef.current = L.circleMarker(pos, {
        radius: 9,
        fillColor: isRunning ? '#EA580C' : '#0F172A',
        color: '#FFFFFF',
        weight: 3,
        fillOpacity: 1,
      }).addTo(map);
    } else {
      currentMarkerRef.current.setLatLng(pos);
      currentMarkerRef.current.setStyle({
        fillColor: isRunning ? '#EA580C' : '#0F172A',
      });
    }

    if (!hasCenteredInitialRef.current) {
      hasCenteredInitialRef.current = true;
      map.setView(pos, 16, { animate: false });
    } else if (autoCenter) {
      map.panTo(pos, { animate: true, duration: 0.45 });
    }
  }, [currentLocation, autoCenter, isRunning]);

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    onToggleAutoCenter(true);
    if (currentLocation) {
      map.setView([currentLocation.lat, currentLocation.lng], 16, {
        animate: true,
      });
    } else if (points.length > 0) {
      const last = points[points.length - 1];
      map.setView([last.lat, last.lng], 16, { animate: true });
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

      {/* Bottom-Left Live Geolocation Coordinate Readout */}
      {currentLocation && (
        <div className="absolute bottom-3 left-3 z-[400] rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 px-3 py-1.5 text-[11px] font-mono text-slate-800 shadow-md pointer-events-none">
          {currentLocation.lat.toFixed(5)}, {currentLocation.lng.toFixed(5)}
          {currentLocation.altitude !== null &&
            ` · Alt ${Math.round(currentLocation.altitude)}m`}
        </div>
      )}

      {/* Map Floating Recenter Control */}
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
      </div>
    </div>
  );
};
