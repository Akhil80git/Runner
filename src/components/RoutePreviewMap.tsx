import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { MapStyle, SplitRecord, TrackPoint } from '../types/run';
import {
  createOfflineGridLayer,
  getFreeTileConfig,
  TRANSPARENT_TILE_DATA_URL,
} from '../utils/leafletOfflineGrid';

interface RoutePreviewMapProps {
  points: TrackPoint[];
  splits?: SplitRecord[];
  mapStyle: MapStyle;
  className?: string;
}

export const RoutePreviewMap: React.FC<RoutePreviewMapProps> = ({
  points,
  splits = [],
  mapStyle,
  className = 'h-64 w-full',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const fallback: [number, number] =
      points.length > 0 ? [points[0].lat, points[0].lng] : [28.6129, 77.2295];

    const map = L.map(containerRef.current, {
      center: fallback,
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    });

    const cfg = getFreeTileConfig(mapStyle);
    createOfflineGridLayer(cfg.isDark).addTo(map);
    L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      subdomains: cfg.subdomains,
      maxZoom: cfg.maxZoom,
      zIndex: 2,
      errorTileUrl: TRANSPARENT_TILE_DATA_URL,
    }).addTo(map);

    if (points.length > 0) {
      const latLngs: L.LatLngExpression[] = points.map((p) => [p.lat, p.lng]);

      L.polyline(latLngs, {
        color: '#FFFFFF',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      const routeLine = L.polyline(latLngs, {
        color: '#EA580C',
        weight: 4.5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // Start marker
      L.circleMarker([points[0].lat, points[0].lng], {
        radius: 6.5,
        fillColor: '#059669',
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      }).addTo(map);

      // End marker
      const last = points[points.length - 1];
      L.circleMarker([last.lat, last.lng], {
        radius: 6.5,
        fillColor: '#0F172A',
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      }).addTo(map);

      // Split pins
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
            html: `<div style="width:20px;height:20px;border-radius:9999px;background:#0F172A;color:#FFFFFF;border:2px solid #FFFFFF;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:JetBrains Mono,monospace;">${split.index}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });
          L.marker([pt.lat, pt.lng], { icon: badgeIcon, interactive: false }).addTo(
            map
          );
        });
      }

      if (points.length > 1) {
        map.fitBounds(routeLine.getBounds(), { padding: [28, 28] });
      }
    }

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
  }, [points, splits, mapStyle]);

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 ${className}`}
    />
  );
};
