import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { MapStyle, SplitRecord, TrackPoint } from '../types/run';
import { buildColoredLegSegments, getLegColor } from '../utils/geo';
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

    const cfg = getFreeTileConfig('standard');
    createOfflineGridLayer(cfg.isDark).addTo(map);
    L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      subdomains: cfg.subdomains,
      maxZoom: cfg.maxZoom,
      zIndex: 2,
      errorTileUrl: TRANSPARENT_TILE_DATA_URL,
    }).addTo(map);

    if (points.length > 0) {
      const segments = buildColoredLegSegments(points);
      const boundsPoints: L.LatLngExpression[] = points.map((p) => [p.lat, p.lng]);

      segments.forEach((seg) => {
        if (seg.isPauseGap) return;
        L.polyline(seg.latLngs, {
          color: '#FFFFFF',
          weight: 8,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 1.5,
        }).addTo(map);
      });

      segments.forEach((seg) => {
        if (!seg.isPauseGap) return;
        L.polyline(seg.latLngs, {
          color: '#475569',
          weight: 3.5,
          opacity: 0.85,
          dashArray: '1 9',
          lineCap: 'round',
        }).addTo(map);

        const [pausePt, resumePt] = seg.latLngs;
        if (pausePt) {
          L.circleMarker(pausePt, {
            radius: 4,
            fillColor: '#475569',
            color: '#FFFFFF',
            weight: 2,
            fillOpacity: 1,
          }).addTo(map);
        }
        if (resumePt) {
          L.circleMarker(resumePt, {
            radius: 4,
            fillColor: getLegColor(seg.legIndex),
            color: '#FFFFFF',
            weight: 2,
            fillOpacity: 1,
          }).addTo(map);
        }
      });

      segments.forEach((seg) => {
        if (seg.isPauseGap) return;
        L.polyline(seg.latLngs, {
          color: seg.color,
          weight: 4.5,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
          smoothFactor: 1.5,
        }).addTo(map);
      });

      const boundsLine = L.polyline(boundsPoints, { opacity: 0 });

      // Point A (Start) marker
      const pointAIcon = L.divIcon({
        className: 'pacetrail-endpoint-a',
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:#059669;color:#FFFFFF;border:2.5px solid #FFFFFF;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,0.35);font-family:Inter,sans-serif;">A</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([points[0].lat, points[0].lng], {
        icon: pointAIcon,
        interactive: false,
      }).addTo(map);

      // Point B (End) marker
      const last = points[points.length - 1];
      const pointBIcon = L.divIcon({
        className: 'pacetrail-endpoint-b',
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:#0F172A;color:#FFFFFF;border:2.5px solid #FFFFFF;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,0.35);font-family:Inter,sans-serif;">B</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([last.lat, last.lng], {
        icon: pointBIcon,
        interactive: false,
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
        map.fitBounds(boundsLine.getBounds(), { padding: [28, 28] });
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
