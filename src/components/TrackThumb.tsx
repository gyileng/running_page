/**
 * 单条轨迹的 SVG 缩略图。
 *
 * 原本内联在 TracksPage 里，鞋柜页的「该鞋跑过的轨迹」也要用同一套渲染，
 * 因此抽到这里共用 —— 行为与抽出前完全一致。
 */
import * as polyline from '@mapbox/polyline';
import type { Activity } from '../types';

export function renderTrackSVG(summaryPolyline: string, size = 80): string {
  try {
    const coords = polyline.decode(summaryPolyline);
    if (coords.length < 2) return '';
    const lats = coords.map((c) => c[0]);
    const lngs = coords.map((c) => c[1]);
    const minLat = Math.min(...lats),
      maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs),
      maxLng = Math.max(...lngs);
    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;
    const scale = Math.min((size - 8) / lngRange, (size - 8) / latRange);
    const offsetX = (size - lngRange * scale) / 2;
    const offsetY = (size - latRange * scale) / 2;
    return coords
      .map(([lat, lng]) => {
        const x = (lng - minLng) * scale + offsetX;
        const y = size - ((lat - minLat) * scale + offsetY);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  } catch {
    return '';
  }
}

export function TrackThumb({
  activity,
  color,
  selected,
  onClick,
}: {
  activity: Activity;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const size = 80;
  const points = activity.summary_polyline
    ? renderTrackSVG(activity.summary_polyline, size)
    : '';
  if (!points) return null;
  return (
    <div
      className={`group relative cursor-pointer rounded transition-all ${selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]' : ''}`}
      onClick={onClick}
      title={`${activity.name} — ${(activity.distance / 1000).toFixed(1)} km`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={`transition-opacity ${selected ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}
      >
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={selected ? '2' : '1.5'}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
