import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Tip } from './components';

/**
 * The viewer's zoom. The phone keeps 1:1 and Fit as buttons beside the
 * percentage; the desktop's percentage is itself the button, stepping
 * through Fit, 1:1 and Full Size (`onCycle`).
 */
export function ViewerZoomControls({ zoom, nativeZoom, onZoom, onNative, onFit, onCycle }: {
  zoom: number;
  nativeZoom: number;
  onZoom: (zoom: number) => void;
  onNative: () => void;
  onFit: () => void;
  onCycle?: () => void;
}) {
  const percent = `${Math.round(zoom / nativeZoom * 100)}%`;
  const zoomOut = <button type="button" className="icon-button" aria-label="Zoom Out" disabled={zoom <= 0.01} onClick={() => onZoom(zoom / 1.25)}><ZoomOut size={17} /></button>;
  const zoomIn = <button type="button" className="icon-button" aria-label="Zoom In" disabled={zoom >= 64} onClick={() => onZoom(zoom * 1.25)}><ZoomIn size={17} /></button>;
  if (onCycle) return <div className="viewer-zoom-controls" role="group" aria-label="Image Zoom">
    {zoomOut}
    <Tip content="Fit, 1:1 or Full Size"><button type="button" className="text-button viewer-zoom-percent is-toggle" aria-label="Image Zoom Percentage" onClick={onCycle}>{percent}</button></Tip>
    {zoomIn}
  </div>;
  return <div className="viewer-zoom-controls" role="group" aria-label="Image Zoom">
    {zoomOut}
    <button type="button" className="text-button" aria-label="1:1" title="Native Size (1:1)" onClick={onNative}>1:1</button>
    {zoomIn}
    <button type="button" className="icon-button" aria-label="Fit Whole Image" onClick={onFit}><Maximize2 size={17} /></button>
    <output className="viewer-zoom-percent" aria-label="Image Zoom Percentage">{percent}</output>
  </div>;
}
