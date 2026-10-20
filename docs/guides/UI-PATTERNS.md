# UI Patterns

The single reference for how Studio's interface looks, moves and behaves on the
desktop and on phones. Read it before UI work. When something is inconsistent
or a better pattern appears, update this file and apply the change everywhere
the pattern occurs in the same piece of work.

## Motion

- **Durations:** `--motion-instant` (90 ms) for presses, `--motion-fast`
  (140 ms) for hover, focus and small state changes, `--motion-base` (200 ms)
  for surfaces entering or leaving, `--motion-slow` (320 ms) for height
  changes such as Advanced settings expanding.
- **Easing:** `--motion-ease` for interactive state changes; `--ease-soft` for
  staged sequences and sheets; framer-motion springs (`stiffness: 420,
  damping: 40`) only for sheets that follow a finger.
- **Enter and exit:** popovers fade and scale from 0.96 at their trigger;
  sheets slide up from the bottom edge and leave the same way; inline sections
  grow their height from 0 with opacity. Exits are as long as entries or
  shorter, never longer.
- **Reduced motion:** with `prefers-reduced-motion` (or `useReducedMotion()`),
  movement becomes a plain fade or an instant change, and smooth scrolling
  becomes `behavior: 'auto'`. Nothing essential depends on an animation
  finishing.
- **Media:** a picture never resizes while it loads. Reserve its final box from
  its known size, show the thumbnail in it, and cross-fade the sharp copy over
  the top (no fade with reduced motion).
- No decorative motion: no bouncing rows, no reorder animation, no odd
  open/close flourishes on pickers.

## Layering

- Avoid modals unless they are clearly the best option. Modals are for
  destructive confirmations and genuinely focused tasks (inpainting, a
  first-run setup).
- **Phone:** at most one layer above the main screen. A new surface replaces
  the current one, or navigates within it with a back step; it never stacks on
  top. A picker opened from the Create sheet replaces the sheet's content and
  shows Back.
- Toasts and status never cover controls: on the phone they sit above the
  create pill or select bar, never over the top bar or a sheet's buttons.
- Stacking uses the `--z-*` tokens, never raw numbers.

## Surfaces

Pick the lightest surface that fits:

1. **Inline expansion** for more of the same thing (Advanced settings, a row's
   details). It pushes content down with a smooth height transition.
2. **Anchored popover** on the desktop for choosing something (model, LoRAs,
   references, size, filters). It opens at its trigger and closes on outside
   click or Escape. On the phone the same content is a bottom sheet.
3. **Side panel or sheet** for a task with several steps or a long list
   (Settings, the Details panel, Create on the phone). Sheets have a handle,
   swipe down to close, a backdrop, and scroll inside themselves.

### Glass

Every translucent surface uses one token set from `00-tokens.css`, at one of
two levels:

| Level | Used for | Tokens |
| --- | --- | --- |
| Bar | Floating bars and chips over content: toolbars, the dock, the Images/Videos switch, search and filters, the viewer bar, the phone top bar, create pill and select bar, toasts | `--glass-bar-bg`, `--glass-bar-blur`, `--glass-border`, `--glass-bar-shadow` |
| Panel | Popovers, menus, sheets and side panels | `--glass-panel-bg`, `--glass-panel-blur`, `--glass-border`, `--glass-panel-shadow` |

Use both `backdrop-filter` and `-webkit-backdrop-filter`. Do not mix in
ad-hoc alpha, blur or shadow values.

## Buttons & Icon Bars

- Icon buttons are 40 px on the desktop and 44 px on the phone, round, ghost
  until hovered, with an accessible name and a tooltip naming the action.
- Icon bars group related actions with a divider between groups; the same
  action has the same icon everywhere.
- **Image/Video switches are icon pairs everywhere:** the gallery's
  Images/Videos switch and the composer's Image/Video mode use the same image
  and video icons as a segmented toggle, with accessible names ("Images",
  "Videos"; "Image", "Video") and tooltips.
- Segmented toggles (`role="group"` with `aria-pressed` buttons) choose one of
  a few native options, such as Image/Video or a resolution (1K | 2K | 4K).

## Selected & Focus States

- Focus rings show only for keyboard focus (`:focus-visible`). A click never
  leaves a ring, highlight or pill behind.
- A selected option shows its checkmark or pressed fill, not an extra row
  highlight. Plain text (such as "N Selected") never looks selected.
- Hover is never the only way to reach something; tile captions also show on
  `:focus-visible`/`:focus-within`.

## Action Placement

- `src/app/itemActions.ts` is the one list of what an item offers on each
  surface (tile, context menu, viewer, long-press sheet, selection bar) and in
  which order. Surfaces render from it and never build their own lists.
- Bulk actions come from `bulkItemActions`: Select All, Select Failed,
  Download (a zip when several), Star, Retry for failed items and Delete.
- The desktop downloads; phones share (iOS's share sheet has Save Image) and
  keep Download only where the browser can't share files.

## Phone

### Main screens scroll the document

The gallery scrolls `document.scrollingElement`, not a box inside the page:
iOS only scrolls the document to the top on a tap on the status bar. The top
bar, search, create pill and select bar are `position: fixed` with safe-area
insets. Sheets and the viewer scroll inside themselves and lock the page behind
them (`overflow: hidden` on `html`), so the gallery keeps its place. Code that
reads the gallery's scroller uses `src/app/scroller.ts`, which treats the
document and a scrolling box alike. History entries for overlays never restore
scroll (`history.scrollRestoration = 'manual'`).

### Top bar

- One row: status, title, the Images/Videos icon pair, then Search, Filter and
  More. The search field and the icon pair share one height.
- **Search and Filter share one space.** Opening one expands it to the full
  width of the bar's second row and collapses the other to its icon; opening
  the other swaps them. Only one is expanded at a time.
- **Active indication:** with a query or any filter applied, the collapsed
  icon is tinted and carries a count badge, and the expanded bar shows the
  same tint.
- **Closing clears:** closing the expanded search or filter row clears the
  query and every filter. Tapping outside closes it too.

### Filter row

Desktop and phone show the same filters in the same order: **Starred | Models |
LoRAs | Size | Aspect Ratio**, then one Clear. On the phone they are one
horizontal row of compact triggers that scrolls sideways (momentum, no
wrapping). Active filters are highlighted the same way on both. Each trigger
opens its options in the one-layer style: a popover on the desktop, the
filter row's own panel on the phone. Filters combine with AND over the
server's paginated results and never show misleading zero counts.

### Keyboard & visual viewport

`useKeyboardInset` publishes `--kb-inset`, `--vv-height` and `--vv-top` and
toggles `.kb-open` on `html`. While the keyboard is up, sheets size and place
themselves in the visual viewport (`--vv-height`), drop their home-indicator
padding, and the page returns to where it rested once the keyboard closes.

## Labels

- Title Case for headings, labels and actions, with `&` instead of "And";
  sentence case for explanations. Australian English ("Favourite",
  "Catalogue", "Colour").
- Standard words: Images/Videos (gallery modes), Image/Video (generation),
  Model, Prompt, Negative Prompt, Reference Image, LoRAs, Animate, Star.
- Item actions: "Use Prompt", "Use Settings", "Copy Prompt", "Retry".
- Chat and links name results "Result N".
- Toasts: "Couldn’t …" for failures, without a full stop; "Prompt copied".
