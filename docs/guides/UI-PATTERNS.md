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
  instead of Close. Two exceptions: a destructive confirmation, and **pop-up
  lists**. A pop-up list (Create's Model, References, LoRAs, Size and Advanced
  Settings; the top bar's menu and what's running) opens over Create or the
  page, one at a time, anchored to the row or button that opened it, the
  screen's width less a margin, on the solid panel glass. What is under it
  stays in view, dimmed and inert, and Escape, Close or a tap outside closes
  it.
- Messages and status never cover controls (see [Messages](#messages)).
- Stacking uses the `--z-*` tokens, never raw numbers. The phone's order is
  `--z-phone-bar` < `--z-phone-scrim` < `--z-phone-sheet` < `--z-phone-pop`.

## Surfaces

Pick the lightest surface that fits:

1. **Inline expansion** for more of the same thing (a row's details). It
   pushes content down with a smooth height transition.
2. **Anchored popover** on the desktop for choosing or tuning something
   (model, LoRAs, references, Advanced Settings, size, filters). It opens at
   its trigger and closes on outside click or Escape. On the phone the same
   content is a pop-up list over Create (see [Layering](#layering)).
3. **Side panel or sheet** for a task with several steps or a long list
   (Settings, the Details panel, Create on the phone). Sheets have a handle,
   swipe down to close, a backdrop, and scroll inside themselves.

### Glass

Every translucent surface uses one token set from `00-tokens.css`, at one of
two levels:

| Level | Used for | Tokens |
| --- | --- | --- |
| Bar | Floating bars and chips over content: toolbars, the dock, the Images/Videos switch, search and filters, the viewer bar, the phone top bar and select bar, the status pill | `--glass-bar-bg`, `--glass-bar-blur`, `--glass-border`, `--glass-bar-shadow` |
| Panel | Popovers, menus, sheets and side panels | `--glass-panel-bg`, `--glass-panel-blur`, `--glass-border`, `--glass-panel-shadow` |

Use both `backdrop-filter` and `-webkit-backdrop-filter`. Do not mix in
ad-hoc alpha, blur or shadow values.

**Glass never blurs while it moves.** A popover or sheet spreads
`useSettling()` (`composerSurface.ts`) onto its moving element: during its
entry and exit it shows `--glass-panel-solid` without a blur, and the glass
returns when it settles. A dialog's scrim adds its blur when its fade ends.
The viewer's backdrop is near-solid with no blur. Animate only `transform`
and `opacity`; never `top`, `left`, `width`, `height`, margins or padding.

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

- **Where:** the phone's top bar, in its centre slot: it takes the place of
  Images | Videos between "Studio" and the tools, which stay; the desktop
  gallery's top bar, before its tools (narrowing rather than pushing them).
  Status messages always go to the pill, never inline under a field or row.
- **Covered:** a surface that covers the bar (a sheet, a pop-up list, a
  dialog, the viewer) shows the pill at its own top edge while open: on its
  title row short of Back and Close (a phone pop-up's title gives way to it),
  or between the viewer's corner buttons.
  Only the newest open host shows it, so a message is never on screen twice.
- **Never over controls:** the pill takes the place of a title or hint, never
  floats over fields, and touching it never dismisses the surface under it.
- Undo stays inside the pill; a surface never grows its own undo strip.

## Lists

Every phone sheet and step (Create, Model, References, LoRAs, Size, Advanced
Settings, More) and Settings use one flat list (`src/app/SheetList.tsx`,
`41-lists.css`), like iOS Settings without the cards:

- **Rows** are full width and one line: the label on the left, the value
  muted on the right (cut short with an ellipsis), then a chevron when the row
  opens a step or a check when it is the selected option. 48 px high on a
  phone (44 px on short screens), 38 px in desktop popovers, hairlines between
  them. No row sits in a card, and no card sits in a card.
- **Controls stay in the row:** a `NumberPicker` for numbers (Steps, CFG,
  percentages), a select that shows the friendly name (the phone's own picker
  on a phone, the studio's select on the desktop), a pill toggle for one choice
  (Seed's Random), a switch for on and off.
- **Full-row toggles:** a row with a switch toggles from anywhere on the row,
  not only the switch (`SwitchRow`).
- **Save & Discard:** an editor that changes several things at once (an access
  profile, a profile's JSON, what each GPU runs) keeps its changes as a draft
  and shows one Save & Discard row (`SaveRow`) while something differs; the
  rows above it never save on their own.
- **Names, not files:** model parts read as names ("Qwen3 VL 8B INT8"), with
  the file name only in the picker (`partNames.js`).
- **Sections** have one quiet heading, never repeating the row label under it
  ("Sampling", then Steps, Sampler, Scheduler, CFG and Seed).
- **Size** shows the resolutions and then the shapes as full-width toggles with
  no label, and Width and Height always at the bottom: there is no Custom Size
  toggle, on the desktop or the phone. No preview stage on the phone.

## Pickers

One chooser pattern for References, LoRAs and Models: a title bar with Close
on the right, the tab pills with Clear Selection, a search field, then the
grid or list. On the desktop it is an anchored popover; on the phone a pop-up
list over Create (see [Layering](#layering)).

- The reference and LoRA choosers share one tab row: the pills (Library |
  Uploads | Selected n/max, or This Model | All Models | Selected n/max), then
  **Clear Selection** beside them (just "Clear" under 480 px), shown only while
  something is picked. Clear Selection empties the selection at once and offers
  Undo in the status pill; it never asks first.
- One tap adds or removes; a picked item highlights in place and shows its
  order number (an empty ring, then the number on white, the same mark in
  every chooser) and stays picked across searches and tabs. It never moves and
  nothing opens under it: every item keeps its place in the list, and only the
  Selected tab lists the picks, in their order, with a LoRA's strength.
- **Reordering** happens in the Selected tab: drag a row's grip with a mouse,
  pen or finger (`useReorderDrag.ts`), or press the arrow keys on the grip.
- A LoRA row's actions sit on the right in this order: View Source (a link
  icon, when the catalogue has a source), Info, Star.
- **Models** have no modal: the model button opens the chooser with search,
  favourites, Fast | Quality and family groups (fine tunes under their
  family), and nothing else. Profile names show as they are, on two lines at
  most.
- A model's own LoRA limit shows as one muted line above the LoRA search
  (Radiance video: "Up to rank 64 in total").

## Empty States

A picker, tab or list with nothing to show uses `EmptyState`
(`src/app/EmptyState.tsx`) and nothing else:

- Plain muted words centred horizontally and vertically in the space the list
  would fill. No box, border, background or icon.
- A short Title Case heading that says what is missing ("No Uploads Yet",
  "No Matching LoRAs", "This Model Doesn’t Support LoRAs"), then at most one
  sentence-case line on what to do ("Try a different name."). Never name
  implementation details (loaders, nodes, built-in workflows).
- At most one action, such as Try Again or Clear Search, under the words.
- In a short list (a filter menu, the model menu's search results) use
  `compact`, which drops the reserved height.

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
- **Phone Create sheet:** one flat column. The prompt takes the height the
  rest leaves (it scrolls rather than grows), with History, Select All and
  Clear close together at the middle of its right edge; Negative is two lines.
  Then one row each for Model, References, LoRAs (their Clear on the right),
  Size and Advanced; each opens its pop-up list over Create. The sticky footer
  has two lines, always in view: Steps and the image count, labelled, then
  Image/Video · Clear · Generate. Nothing reaches past the right edge at
  320–430 px (`phone-create.spec.ts`).

- The desktop composer stays bottom centre and expands upwards; its pickers
  are anchored popovers. Every control stays in its bar: as room runs out they
  step down to compact and then mini chips, and there is no More Settings
  drawer.
- **Advanced Settings** open in the composer popover, like LoRAs and
  References: anchored above the composer at its width, the same glass,
  motion and dismissal (outside click, Escape, its button again; focus returns
  to the button). It is the flat list, dense, in two columns where the popover
  is wide, with every option the profile exposes but Width and Height (they
  belong to Size). Close is on the right. **Upscale** and **Face Detail** are
  chosen per generation here, starting from Settings › Studio; face detail
  runs only with an upscale. The phone shows the same list as a pop-up over
  Create.
- **Size** stays open while choosing: the resolution is a segmented toggle of
  the model's native options (Default · 2K · 4K), beside the shapes, so both
  can be picked in one go.

## Settings

One side panel with a list of sections on the left (a sideways row on the
phone) and one page at a time, each with its title and one line on what it
holds:

| Section | Holds | Who |
| --- | --- | --- |
| Account | Profile (name, email, password), MCP and Session (Sign Out) | Every account |
| Users | Accounts, Access Profiles (a picker with New, multi-selects, Save & Discard), Chat Gateway and Profiles (a JSON editor; an edited copy stops receiving repository updates) | Administrators |
| Studio | General, Generation, Features (Smart Upscale and Inpainting as plain rows), Gallery and Sharing | Everyone |
| Models | Defaults, Catalogue (LoRAs, Cloud Models, Presets & Civitai Imports), LoRAs & Supporting Files and Integrations | Administrators |
| Workers | ComfyUI connections, restart, and AI Control (what each GPU runs) | Administrators; everyone reads AI Control's status |
| Maintenance | Clean Up, Reset and Help | Everyone (each item as the device allows) |
| About | The banner, stats, licence and credits to the upstream projects | Everyone |

A new setting goes in the section that matches who changes it and why;
destructive actions live in Maintenance, never beside everyday switches.
Every row does something in the running deployment: rows for a local install
(output folders, finding ComfyUI on its own, the studio password for other
devices) hide in account mode, and there are no upstream community, feedback
or donation links. Settings use the flat list (see [Lists](#lists)), dense:
44 px rows, a one-line description, one heading per group. **Sign Out** is in
the desktop dock's Account menu and at the top of the phone's More, as well as
Settings › Account; it asks first only while something is generating.

Gallery **Date Headers** ("Today", "This Evening") are a Studio › Gallery
switch, off by default. Auto-Grouping, Grid Autoplay and Failed are not
settings: they are gallery view controls (see [Gallery View
Controls](#gallery-view-controls)).

**Workers** has one heading per backend (Image Worker, Video Worker): its
locked address, status with Test, Open and Restart. **AI Control** is manual
only: a select per GPU, a preview of what stops, starts and keeps in the Save
& Discard row, a confirmation only when something stops, and progress in the
status pill. A change to both GPUs runs as one job through AI Control's board
routes (`/api/board/plan`, then `/api/board`). Studio never switches a GPU by
itself, and non-administrators see the status read-only.

## Library

The Image & Model Library (administrators, where presets are on) uses the
Settings panel's anatomy: the same sheet, a section rail (a sideways row on the
phone) and one page at a time with its title and one line.

- **Saved Images:** a link field with Save Image on one line (the button turns
  primary once there is a link), search once there are two or more, then a grid
  of even 4:5 cards: the picture, the name, then the base model and creator. A
  card with files to fetch carries an amber "n Missing" badge.
- A card opens its **review in place** (Back reads "Saved Images"), with View on
  Civitai and Delete as icons on the right of that bar: the picture beside the
  name, where it stands in one line (Ready To Use, Needs Review, Downloading
  Models), the prompts and settings, then the Use With and Models & LoRAs
  groups. Use Prompt and Use Settings sit in the footer.
- **Models:** a link field with Preview Download, the previewed file as a row
  with Download, then Downloads: one row per file, its folder by name ("LoRAs",
  not `loras`), the shared `set-progress` bar while it runs, its state on the
  right and Retry when it failed.
- **Speed:** the list compares file names and sizes only; opening one image
  checks its checksums (kept on disk, so a restart never reads every model
  again). The code loads while idle (`preloadable.ts`), placeholders hold the
  grid's place while the list arrives, and the last list shows at once on
  reopening.
- Failures go to the status pill; the page never grows its own error box.

## Buttons & Icon Bars

- Icon buttons are 40 px on the desktop and 44 px on the phone, round, ghost
  until hovered, with an accessible name and a tooltip naming the action.
  A tooltip starts with the action's name and fits on one line ("Rerun With
  the Same Seed"), so it never covers a neighbouring control.
- **Glass icon buttons** in a 48 px bar (the docks, the viewer bar) keep the
  40 px target, but their hover and press fill is a smaller circle
  (`--icon-fill`, 32 px), inset evenly by `--icon-fill-inset` so 8 px of glass
  shows around it on every side. Hover is `--control-hover`, press
  `--control-press` with a slight shrink, the keyboard ring (`--icon-ring`)
  traces the fill circle inside the bar. Hover and focus change at
  `--motion-fast`, presses at `--motion-instant`. Change only
  `background-color` on these buttons: the `background` shorthand resets the
  clip and the fill grows to the full target again.
- Tile corner buttons are their own glass circles: hover darkens them, a press
  shrinks them, and the keyboard ring sits just outside the circle. The phone
  viewer bar's press fill is a rounded shape inset inside its cell, never
  touching a divider or the bar's edge.
- A bar's tooltips open on the side away from the screen edge and nothing else
  floats on that side: the viewer's zoom pill sits in the bottom right corner,
  level with the bar, not above it.
- Icon bars group related actions with a divider between groups; the same
  action has the same icon everywhere. Action icons are outlines at one stroke
  weight, including Upscale's arrow.
- **Image/Video switches:** the composer's and the phone Create sheet's
  Image/Video mode are icon pairs (the same image and video icons, with
  accessible names and tooltips). The gallery's switches have the room for
  words and read "Images" | "Videos": the desktop's at the top, the phone's in
  its top bar.
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
  Download or Share) | make more (Animate or Extend, Rerun, Edit,
  Reference, Retry, Upscale, Compare) | organise (Star, Select, Delete) | Info.
- **One-word names** everywhere: Copy, Download, Share, Animate, Extend,
  Rerun, Edit, Reference, Retry, Upscale, Star, Delete, Info. Tooltips
  may say more.
- **Rerun** ("Rerun With the Same Seed") is an exact rerun: it loads the
  model, both prompts, size, LoRAs, references, every setting and the same
  seed. **Edit** ("Edit Prompt & Settings in Create") loads the same with a
  new seed. After either the viewer closes and Create opens. Edit is never a
  ghost button.
- **Viewer, desktop:** Copy · Download | Animate · Rerun · Reference ·
  Upscale | Star · Delete, then Close. Info sits alone in the top right (beside
  the corner Close on tablets); it opens Details, and the open Details panel
  has its own Close in its header, as Info's corner is under it.
- **Viewer, phone:** the desktop's title top left (the profile name and its
  settings line; a message takes its place for a moment); Star · Info · Close
  top right; the bottom bar Copy · Share | Animate · Rerun · Reference ·
  Upscale | Delete, centred with even sides in a bar-height row above the home
  indicator.
  Download replaces Share only where the browser can't share files. Info
  toggles Details: the bar is a trigger surface, so a tap on Info while
  Details is open closes it.
- **Zoom:** a small `− 100% +` pill, bottom middle above the bar, faded until
  used; the percentage cycles Fit, 1:1 and Full Size. The same on both.
- **Details:** Prompt and Negative each with Copy beside their label (no
  per-prompt Use and no shortcut chips), Settings unboxed below with friendly
  profile, weight and LoRA names, and one footer, the same on both: Copy
  Prompts · Copy Settings above Edit · Rerun, equal weight. One Close only.
- **Selecting:** a long press on a phone tile starts selecting with that item
  (there is no long-press action sheet). Selecting offers Select All, then
  Select Failed (in that order on both), then Download (a zip when several)
  or Share on a phone, Retry for failed items, Star and Delete. There is no
  bulk Animate. On the phone, selecting swaps the top bar's contents (Close ·
  n Selected · All · Failed as icon buttons) and the actions sit in a bottom
  bar of the same height and glass. Bulk actions keep their one-word visible
  names, but their tooltips, accessible names and the several-item menu rows
  say what they act on: "Download Selected as a Zip", "Delete Selected".
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
| Copy | `Copy` | Rerun | `RotateCcw` |
| Delete | `Trash2` | Reference | `ImagePlus` |
| Download | `Download` | Retry | `RotateCw` |
| Extend | `FastForward` | Edit | `TextQuote` |
| Image / Video | `Image` / `Film` | Share | `Share` |
| Menu | `Menu` | Star | `Star` (filled when on) |
| Upscale | `UpscaleArrow` | Zoom | `Minus` / `Plus` |
| Select All | `CheckSquare` | Select Failed | `AlertTriangle` |

## Phone

### Main screens scroll the document

The gallery scrolls `document.scrollingElement`, not a box inside the page:
iOS only scrolls the document to the top on a tap on the status bar. The top
bar with its search row, the Create button and the select bar are `position: fixed` with safe-area
insets. Sheets and the viewer scroll inside themselves and lock the page behind
them (`overflow: hidden` on `html`), so the gallery keeps its place. Never put
`overflow: hidden` on `body` under the phone shell: while `html` is visible it
passes to the viewport and stops touch and wheel scrolling
(`phone-touch-scroll.spec.ts` drags with a real touch). Code that
reads the gallery's scroller uses `src/app/scroller.ts`, which treats the
document and a scrolling box alike. History entries for overlays never restore
scroll (`history.scrollRestoration = 'manual'`).

### Top bar and Create

One slim top bar and nothing else fixed but Create; a tap on the iOS status
bar still scrolls the document to the top. No bottom bar and no boxes in the
bar.

- **Left:** the status light (its colour says whether generation can run; a
  tap checks again) and "Studio", then what is running (a spinner and count;
  a tap opens Show Running and Stop All with its count).
- **Centre:** the gallery's **Images | Videos** as two icons. A message takes
  this slot while it shows (see [Messages](#messages)).
- **Right:** **Search**, **Filter** and the **Menu** icon. The menu is a
  pop-up list: Select · Library · Settings, then Account and Sign Out in
  account mode.
- **One bar height:** the top bar, the select bar, the viewer's top icons and
  the status pill share `--bar-h` and `--bar-pill-h`, so nothing jumps when one
  replaces another.
- **Create** is a round floating button bottom right, in thumb reach, with a
  dot while a prompt waits in Create. It opens the Create sheet.
- Selecting swaps the top bar's contents; the select bar shows at the bottom
  only while selecting.

- **Search and Filter share one row**, under the bar, full width and as tall as
  the icons. It overlays the top of the gallery rather than pushing it down.
  Opening the other swaps them. Only one is open at a time.
- **Active indication:** with a query or any filter applied, the Search or
  Filter icon is tinted with the accent and carries a count badge; the open
  row shows an accent outline.
- **Closing clears:** closing the row (the X inside the search field, the
  filter row's Clear, its icon, Escape, or starting Select) clears the query
  and every filter. It is part of the top bar, not an
  overlay, so scrolling the gallery leaves it open.
- **Tiles** show the prompt and the output's name or type, never the
  generation time (the desktop shows the time).
- **The viewer keeps the gallery's place:** opening a tile, even one half under
  the bar, never scrolls the gallery; closing lands on the same scroll position.
  Only stepping to another item brings its tile into view behind the viewer.

### Filter row

Desktop and phone show the same filters in the same order: **Starred | Models |
LoRAs | Size | Aspect Ratio**, then one Clear (on the phone a button at the end
of the row, styled like the filters). On the phone they are one
horizontal row of compact triggers that scrolls sideways (momentum, no
wrapping). Active filters are highlighted the same way on both. Each trigger
opens its options in the one-layer style: a popover on the desktop, the
filter row's own panel on the phone. Each filter takes several values (a
tick per value, a count on its trigger when more than one, its own Clear);
values within a filter combine with OR, filters with AND, over the server's
paginated results, and never show misleading zero counts.

### Gallery View Controls

How the gallery shows, the same three on both devices
(`GalleryViewControls.tsx`): **Auto-Grouping**, **Grid Autoplay** (one name
everywhere, only where there are videos) and **Failed** (whether failed
outputs show). They are pressed toggles, not settings and not filters, so
Clear leaves them alone. The desktop gallery toolbar holds them after its
filters; the phone's filter row ends with them, after a divider and before
Clear. Stop All, with the running count, sits in the desktop dock and in the
phone's running menu.

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
- Item actions: "Edit", "Rerun", "Copy Prompts", "Copy Settings", "Retry";
  the Library's "Use Prompt" and "Use Settings".
- Chat and links name results "Result N".
- Messages: "Couldn’t …" for failures, without a full stop; "Prompt copied".
