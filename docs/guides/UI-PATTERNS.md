# UI Patterns

The single reference for how Studio's interface looks, moves and behaves on the
desktop and on phones. Read it before UI work. When something is inconsistent
or a better pattern appears, update this file and apply the change everywhere
the pattern occurs in the same piece of work.

## Motion

- **Durations:** `--motion-instant` (90 ms) for presses, `--motion-fast`
  (140 ms) for hover, focus and small state changes, `--motion-base` (200 ms)
  for surfaces entering or leaving, `--motion-slow` (320 ms) for height
  changes such as a row's details expanding.
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

## Media

Media pauses when it is covered or closed. Closing the video viewer, stepping
to another item or hiding the tab stops playback for good (pause, drop the
source and `load()`), so nothing plays in the background. On a phone, a
sheet, picker or Details over a playing video or the gallery pauses the
viewer's video and the grid previews (`mediaCover.ts`); when the last cover
goes, the viewer resumes only if it was playing, and previews resume as usual.

## Layering

- Avoid modals unless they are clearly the best option. Modals are for
  destructive confirmations and genuinely focused tasks (inpainting, a
  first-run setup).
- **Phone:** at most one layer above the main screen. A new surface replaces
  the current one, or navigates within it with a back step; it never stacks on
  top. Every sheet and sheet-style picker registers with `phoneLayers.ts`:
  only the newest shows, the ones under it step aside (`is-covered`) until it
  closes, one dimmed backdrop stays behind, and a nested sheet shows Back
  instead of Close. A destructive confirmation is the one exception.
- Messages and status never cover controls (see [Messages](#messages)).
- Stacking uses the `--z-*` tokens, never raw numbers.

## Surfaces

Pick the lightest surface that fits:

1. **Inline expansion** for more of the same thing (a row's details). It
   pushes content down with a smooth height transition.
2. **Anchored popover** on the desktop for choosing or tuning something
   (model, LoRAs, references, Advanced Settings, size, filters). It opens at
   its trigger and closes on outside click or Escape. On the phone the same
   content is a bottom sheet.
3. **Side panel or sheet** for a task with several steps or a long list
   (Settings, the Details panel, Create on the phone). Sheets have a handle,
   swipe down to close, a backdrop, and scroll inside themselves.

### Glass

Every translucent surface uses one token set from `00-tokens.css`, at one of
two levels:

| Level | Used for | Tokens |
| --- | --- | --- |
| Bar | Floating bars and chips over content: toolbars, the dock, the Images/Videos switch, search and filters, the viewer bar, the phone top bar, create pill and select bar, the status pill | `--glass-bar-bg`, `--glass-bar-blur`, `--glass-border`, `--glass-bar-shadow` |
| Panel | Popovers, menus, sheets and side panels | `--glass-panel-bg`, `--glass-panel-blur`, `--glass-border`, `--glass-panel-shadow` |

Use both `backdrop-filter` and `-webkit-backdrop-filter`. Do not mix in
ad-hoc alpha, blur or shadow values.

### Accent

One accent, warm amber like the lock mark's glow: `--accent-amber`,
`--accent-amber-hover`, `--accent-amber-subtle` (backgrounds and tints) and
`--accent-amber-ink` (text on a solid accent). Every active, selected and
highlight state uses it: active filters and search, selected tabs and chips,
pressed toggles, Star and progress. Errors and destructive actions keep their
own colours. `--ember` is an older name for the same colour.

## Messages

There are no floating toasts. A message (a confirmation, a failure, an Undo)
shows in the **Studio status pill** (`src/app/StatusMessage.tsx`): the
status light takes the message's tone, then the words, its one action (Undo,
View, Try Again) and Dismiss. It times out (failures wait), pauses while
hovered or focused, and a sideways flick dismisses it. Screen readers hear it
through one announcer (polite, failures assertive).

- **Where:** the phone's top bar, where the Studio pill sits (the title steps
  aside for the moment); the desktop gallery's top bar, before its tools
  (narrowing rather than pushing them); above the dock in zen mode, which has
  no top bar.
- **Covered:** a surface that covers the bar (a sheet, a sheet-style picker, a
  dialog, the viewer) shows the pill at its own top edge while open: on its
  title row short of Back and Close, or between the viewer's corner buttons.
  Only the newest open host shows it, so a message is never on screen twice.
- **Never over controls:** the pill takes the place of a title or hint, never
  floats over fields, and touching it never dismisses the surface under it.
- Undo stays inside the pill; a surface never grows its own undo strip.

## Pickers

- The reference and LoRA choosers share one top bar: the tab pills (This
  Model | All Models | Selected n/max), then **Clear All** beside them, shown
  only while something is picked. Clear All empties the selection at once and
  offers Undo in the status pill; it never asks first.
- One tap adds or removes; a picked item shows its order number and stays
  pinned across searches and tabs.

## Composer

- **References:** a model with several reference slots shows one References
  button (the picked thumbnails overlapping, "References" and n/max), never a
  control per slot. It opens the chooser, which picks several at once up to
  the model's limit (a picked image shows its order number; tapping it takes
  it off) and has a **Selected n/max** tab to review, reorder and remove. A
  single-slot model keeps its one thumbnail chip. Edit | Reference and the
  inpaint brush sit beside the button.
- **LoRAs** use the same pattern: This Model | All Models | Selected n/max in
  the library, one tap to add or remove, no row animations.
- **Number steppers:** one `NumberPicker` (minus, value, plus) everywhere; on
  touch screens each part is a 44 px target. Names read "Decrease Images",
  "Increase Steps".
- **Phone Create sheet order:** Prompt · Negative · Image/Video with Model ·
  References with LoRAs · Size, count, Advanced and Generate.

- The desktop composer stays bottom centre and expands upwards; its pickers
  are anchored popovers.
- **Advanced Settings** open in the composer popover, like LoRAs and
  References: anchored above the composer at its width, the same glass,
  motion and dismissal (outside click, Escape, its button again; focus returns
  to the button). The phone shows the same controls as a sheet that replaces
  the Create sheet, with Back (one layer).
- **Size** stays open while choosing: the resolution is a segmented toggle of
  the model's native options (Default · 2K · 4K), beside the shapes, so both
  can be picked in one go.

## Settings

One side panel with a list of sections on the left (a sideways row on the
phone) and one page at a time, each with its title and one line on what it
holds:

| Section | Holds | Who |
| --- | --- | --- |
| Account | Your MCP connection and this browser's session | Every account |
| Users | Access profiles, accounts, chat gateway users, password resets | Administrators |
| Studio | General (layout, keyboard, safety), Generation, Features (Smart Upscale, Inpainting) and the gallery's display, grouping and sharing, each under a quiet subheading | Everyone |
| Models | Defaults, model types, installed models, the manifest, LoRA library, integrations (Civitai, Hugging Face) and output folders | Administrators |
| Workers | ComfyUI connections, restart and other devices | Administrators |
| Maintenance | Clean up, export, reset and diagnostics | Everyone (each item as the device allows) |
| About | Version, stats, links and credits | Everyone |

A new setting goes in the section that matches who changes it and why;
destructive actions live in Maintenance, never beside everyday switches.

## Buttons & Icon Bars

- Icon buttons are 40 px on the desktop and 44 px on the phone, round, ghost
  until hovered, with an accessible name and a tooltip naming the action.
- Icon bars group related actions with a divider between groups; the same
  action has the same icon everywhere.
- **Image/Video switches:** the composer's Image/Video mode and the phone
  dock's Images/Videos switch are icon pairs (the same image and video icons,
  with accessible names and tooltips). The desktop gallery's top switch has
  the room for words and reads "Images" | "Videos".
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
  surface (viewer bar, tile, context menu, select bar) and in which order.
  Surfaces render from it and never build their own lists.
- **Order by intent,** with a divider between groups: keep it (Copy,
  Download or Share) | make more (Animate or Extend, Recreate, Reuse,
  Reference, Retry, Upscale, Compare) | organise (Star, Select, Delete) | Info.
- **One-word names** everywhere: Copy, Download, Share, Animate, Extend,
  Recreate, Reuse, Reference, Retry, Upscale, Star, Delete, Info. Tooltips
  may say more.
- **Recreate** is an exact rerun: it loads the model, both prompts, size,
  LoRAs, references, every setting and the same seed into the prompt box.
  **Reuse** loads both prompts only; a prompt's own **Use** loads just that
  prompt. After any of them the viewer closes and the prompt box opens.
- **Viewer, desktop:** Copy · Download | Animate · Recreate · Reference ·
  Upscale | Star · Delete, then Close. Info sits alone in the top right (beside
  the corner Close on tablets); it opens Details, and the open Details panel
  has its own Close in its header, as Info's corner is under it.
- **Viewer, phone:** Star top left; Info top right beside Close; the bottom
  bar Copy · Share | Animate · Recreate · Reference · Upscale | Delete.
  Download replaces Share only where the browser can't share files. Info
  toggles Details: the bar is a trigger surface, so a tap on Info while
  Details is open closes it.
- **Zoom:** a small `− 100% +` pill, bottom middle above the bar, faded until
  used; the percentage cycles Fit, 1:1 and Full Size. The same on both.
- **Details:** Prompt and Negative each with Copy and Use beside their label,
  Settings unboxed below, and a footer of Reuse · Recreate. Phones add Copy
  (the prompt) and Settings (the settings as text) at the top.
- **Selecting:** a long press on a phone tile starts selecting with that item
  (there is no long-press action sheet). The select bar offers Select All,
  Select Failed, then Download (a zip when several) or Share on a phone,
  Animate for the photos among them, Retry for failed items, Star and Delete.
  The desktop's right-click menu offers the same for several, under an
  "n Selected" heading, and the full list for one; its rows are full width
  with a muted icon, split by hairlines between the intent groups.
- **Copying on phones:** call the clipboard synchronously inside the tap
  (iOS Safari requires it), fall back to a selected text box where there is
  no clipboard API, and confirm with the button's own "Copied" and a message.
- The desktop downloads; phones share (iOS's share sheet has Save Image).
- No haptics.

### Icons

One icon per action everywhere (Lucide, 16 px on the desktop, 19–20 px on
phones, default stroke):

| Action | Icon | Action | Icon |
| --- | --- | --- | --- |
| Animate | `Clapperboard` | Info | `Info` |
| Copy | `Copy` | Recreate | `RotateCcw` |
| Delete | `Trash2` | Reference | `ImagePlus` |
| Download | `Download` | Retry | `RotateCw` |
| Extend | `FastForward` | Reuse | `TextQuote` |
| Image / Video | `Image` / `Film` | Share | `Share` |
| Use | `Undo2` | Star | `Star` (filled when on) |
| Upscale | `UpscaleArrow` | Zoom | `Minus` / `Plus` |

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

### Bottom-up

Frequently used controls sit within thumb reach, above the home indicator and
Safari's bottom bar (safe-area insets). The top keeps only a thin status strip
(status, title, what is running), so a tap on the iOS status bar still scrolls
the document to the top.

The **status** is the small Studio pill top left: its light says whether
generation can run and a tap checks again. **More** reads Select · Library ·
Settings · Account.

The **dock** at the bottom holds, from the top down: the shared Search/Filter
row when open, the create pill (prompt preview and Generate), then the
Images/Videos icon pair, Search, Filter and More. Prefer tall, vertically
scrolling surfaces over small floating popovers on the phone.

- **Search and Filter share one row.** Opening one expands it, full width and
  as tall as the Images/Videos icons, upwards above the create pill; the other
  stays an icon. Opening the other swaps them. Only one is open at a time.
- **Active indication:** with a query or any filter applied, the Search or
  Filter icon is tinted with the accent and carries a count badge; the open
  row shows an accent outline.
- **Closing clears:** closing the row (its X, its icon, Escape, or starting
  Select) clears the query and every filter. It is part of the dock, not an
  overlay, so scrolling the gallery leaves it open.

### Filter row

Desktop and phone show the same filters in the same order: **Starred | Models |
LoRAs | Size | Aspect Ratio**, then one Clear. On the phone they are one
horizontal row of compact triggers that scrolls sideways (momentum, no
wrapping). Active filters are highlighted the same way on both. Each trigger
opens its options in the one-layer style: a popover on the desktop, the
filter row's own panel on the phone. Each filter takes several values (a
tick per value, a count on its trigger when more than one, its own Clear);
values within a filter combine with OR, filters with AND, over the server's
paginated results, and never show misleading zero counts.

### Keyboard & visual viewport

`useKeyboardInset` publishes `--kb-inset`, `--vv-height` and `--vv-top` and
toggles `.kb-open` on `html`. While the keyboard is up, sheets size and place
themselves in the visual viewport (`--vv-height`), drop their home-indicator
padding, and the page returns to where it rested once the keyboard closes.

## Labels

- Title Case for headings, labels, actions, menu items, tooltips and
  accessible names, with `&` instead of "And";
  sentence case for explanations. Australian English ("Favourite",
  "Catalogue", "Colour").
- Standard words: Images/Videos (gallery modes), Image/Video (generation),
  Model, Prompt, Negative Prompt, Reference Image, LoRAs, Animate, Star.
- Item actions: "Use Prompt", "Use Settings", "Copy Prompt", "Retry".
- Chat and links name results "Result N".
- Messages: "Couldn’t …" for failures, without a full stop; "Prompt copied".
