import { Minus, Plus } from 'lucide-react';
import { Tip } from './components';

/**
 * The viewer's zoom, the same small `−  100%  +` on the desktop and phones,
 * bottom middle and out of the way. The percentage steps through Fit, 1:1
 * and Full Size.
 */
export function ViewerZoomControls({ zoom, nativeZoom, onZoom, onCycle }: {
  zoom: number;
  nativeZoom: number;
  onZoom: (zoom: number) => void;
  onCycle: () => void;
}) {
  const percent = `${Math.round(zoom / nativeZoom * 100)}%`;
  return <div className="viewer-zoom-controls" role="group" aria-label="Image Zoom">
    <button type="button" className="viewer-zoom-step" aria-label="Zoom Out" disabled={zoom <= 0.01} onClick={() => onZoom(zoom / 1.25)}><Minus size={14} /></button>
    <Tip content="Fit, 1:1 or Full Size"><button type="button" className="viewer-zoom-percent is-toggle" aria-label="Image Zoom Percentage" onClick={onCycle}>{percent}</button></Tip>
    <button type="button" className="viewer-zoom-step" aria-label="Zoom In" disabled={zoom >= 64} onClick={() => onZoom(zoom * 1.25)}><Plus size={14} /></button>
  </div>;
}
