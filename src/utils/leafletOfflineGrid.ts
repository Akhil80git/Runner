import L from 'leaflet';
import type { MapStyle } from '../types/run';

export const TRANSPARENT_TILE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function getFreeTileConfig(style: MapStyle): {
  url: string;
  attribution: string;
  subdomains: string;
  maxZoom: number;
  isDark: boolean;
  label: string;
} {
  switch (style) {
    case 'topo':
      return {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors, &copy; OpenTopoMap (CC-BY-SA)',
        subdomains: 'abc',
        maxZoom: 17,
        isDark: false,
        label: 'Topo Terrain',
      };
    case 'dark':
      return {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
        isDark: true,
        label: 'Night Dark',
      };
    case 'standard':
    default:
      return {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
        subdomains: 'abc',
        maxZoom: 19,
        isDark: false,
        label: 'OpenStreetMap',
      };
  }
}

export function createOfflineGridLayer(isDark: boolean): L.GridLayer {
  const Grid = L.GridLayer.extend({
    createTile: function (coords: L.Coords) {
      const tile = document.createElement('canvas');
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const ctx = tile.getContext('2d');
      if (ctx) {
        ctx.fillStyle = isDark ? '#0F172A' : '#F1F5F9';
        ctx.fillRect(0, 0, size.x, size.y);

        // Subtle sub-grid (64px)
        ctx.strokeStyle = isDark
          ? 'rgba(148, 163, 184, 0.08)'
          : 'rgba(15, 23, 42, 0.05)';
        ctx.lineWidth = 1;
        for (let step = 64; step < size.x; step += 64) {
          ctx.beginPath();
          ctx.moveTo(step + 0.5, 0);
          ctx.lineTo(step + 0.5, size.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(0, step + 0.5);
          ctx.lineTo(size.x, step + 0.5);
          ctx.stroke();
        }

        // Major tile border
        ctx.strokeStyle = isDark
          ? 'rgba(148, 163, 184, 0.16)'
          : 'rgba(15, 23, 42, 0.10)';
        ctx.strokeRect(0.5, 0.5, size.x - 1, size.y - 1);

        // Subtle coordinate watermark for spatial orientation offline
        ctx.fillStyle = isDark
          ? 'rgba(148, 163, 184, 0.35)'
          : 'rgba(100, 116, 139, 0.45)';
        ctx.font = '500 10px ui-monospace, SFMono-Regular, monospace';
        ctx.fillText(`z${coords.z} · ${coords.x},${coords.y}`, 10, 18);
      }
      return tile;
    },
  });

  return new (Grid as unknown as {
    new (opts?: L.GridLayerOptions): L.GridLayer;
  })({ zIndex: 1 });
}
