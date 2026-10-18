import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

export function ViewerZoomControls({ zoom, nativeZoom, onZoom, onNative, onFit }: {
  zoom: number;
  nativeZoom: number;
  onZoom: (zoom: number) => void;
  onNative: () => void;
  onFit: () => void;
}) {
  return <div className="viewer-zoom-controls" role="group" aria-label="Image Zoom">
    <button type="button" className="icon-button" aria-label="Zoom Out" disabled={zoom <= 0.01} onClick={() => onZoom(zoom / 1.25)}><ZoomOut size={17} /></button>
    <button type="button" className="text-button" aria-label="1:1" title="Native Size (1:1)" onClick={onNative}>1:1</button>
    <button type="button" className="icon-button" aria-label="Zoom In" disabled={zoom >= 64} onClick={() => onZoom(zoom * 1.25)}><ZoomIn size={17} /></button>
    <button type="button" className="icon-button" aria-label="Fit Whole Image" onClick={onFit}><Maximize2 size={17} /></button>
    <output className="viewer-zoom-percent" aria-label="Image Zoom Percentage">{Math.round(zoom / nativeZoom * 100)}%</output>
  </div>;
}
