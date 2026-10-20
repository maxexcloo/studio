/**
 * The upscale mark: a broad arrow pointing up, drawn as an outline at the same
 * weight as the other action icons (lucide's 2 unit stroke, round joins), so
 * it sits in a bar of outline icons without reading as the odd one out. Used
 * for every upscale affordance, so the tile, the viewer and the dialogs all
 * speak with one mark.
 */
export function UpscaleArrow({ size = 15 }: { size?: number }) {
  return (
    <svg
      className="upscale-arrow"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 20v-7.5H4.5L12 4.5l7.5 8H15V20Z" />
    </svg>
  );
}
