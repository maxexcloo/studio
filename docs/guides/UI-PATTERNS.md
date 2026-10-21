# UI Patterns

The single reference for how Studio's interface looks, moves and behaves on the
desktop and on phones. Read it before UI work. When something is inconsistent
or a better pattern appears, update this file and apply the change everywhere
the pattern occurs in the same piece of work.

## Motion

- **Tokens:** every duration and easing comes from `tokens.css`:
  `--motion-instant` (90 ms) for presses, `--motion-fast` (140 ms) for hover,
  focus and small state changes, `--motion-base` (200 ms) for surfaces
  entering or leaving, `--motion-slow` (320 ms) for height changes such as a
  row's details expanding. `--motion-ease` for interactive state changes;
  `--ease-soft` for staged sequences and sheets. Beyond those four:
  `--motion-tick` (1 s, linear) for progress that follows the once-a-second
  clock, `--motion-emphasis` (420 ms) for a one-off "look here" (ready, wrong
  password), `--motion-app-in` for the app fading in and `--motion-stagger`
  between a menu's items. No raw milliseconds or `cubic-bezier()` in
  transitions; looping spinners and shimmers keep their own cycle lengths.
- **Framer motion** uses `src/lib/springs.ts` only: `tweens.*` match the CSS
  tokens, `springs.*` have no bounce, and `springs.sheet` (`stiffness: 420,
  damping: 40`) is only for sheets that follow a finger. Nothing overshoots.
- **Presses never move anything.** No control scales, shrinks, lifts or shifts
  when it is pressed or hovered. A press darkens the fill in place at
  `--motion-instant` (one global rule in `motion.css`): `--press-overlay`
  on dark controls, `--press-overlay-dark` on light ones, a slight dim on
  Generate, and `--press-media` on the picture of a tile or thumbnail.
- **Animate only `transform` and `opacity`.** Never transition `top`, `left`,
  `width`, `height`, margins, padding or grid tracks; such changes are
  instant. The one exception is an inline section's framer `height: 'auto'`
  at `--motion-slow`. Never `transition: all`.
- **Enter and exit:** popovers fade and scale from 0.96 at their trigger
  (`popoverMotion` in `composerSurface.ts`, the `surfaceIn` keyframe in CSS);
  sheets, nested ones too, slide up from the bottom edge and leave the same
  way; inline sections grow their height from 0 with opacity. Exits are as
  long as entries or shorter, never longer. No filter blur in any entry.
- **Reduced motion:** with `prefers-reduced-motion` (or `useReducedMotion()`),
  movement becomes a plain fade or an instant change, and smooth scrolling
  becomes `behavior: 'auto'`. The CSS kill-switch covers CSS; framer height,
  width and filter animations and JS scrolling branch on `useReducedMotion()`.
  Nothing essential depends on an animation finishing.
- **Media:** a picture never resizes or zooms while it loads. Reserve its
  final box from its known size, show the thumbnail in it, and cross-fade the
  sharp copy over the top (no fade with reduced motion).
- Switching Images | Videos fades the new list in as one surface at
  `--motion-base`; tiles don't pop in one by one.
- Gallery column changes keep moving tiles inside the grid horizontally. Clip
  overflow on the virtual spacer without creating another scrolling container,
  so focus and selection cannot pan the gallery or move its toolbar sideways.
  A resize that keeps the columns moves the tiles with the window at once.
- **A new list appears in place:** after Images | Videos, a search or a filter,
  tiles mount where they belong (the grid measures its width before it places
  any), never gliding from a provisional place, and a mode's saved scroll
  position is back before the list first paints.
- **The desktop gallery stays still** while what sits above it changes height:
  an activity pill joining the top or the filter row opening under the toolbar
  makes room at the top of the gallery, but once scrolled the scroll moves with
  it so the tiles on screen don't (`useGalleryTopAnchor.ts`).
  `desktop-stability.spec.ts` samples every frame in normal, narrow, short and
  tablet windows.
- No decorative motion: no hover lifts or nudges, no bouncing rows, no
  staggered entrances, no reorder animation, no sliding highlights, no
  bobbing, wobble or endless glow (real progress and status indicators may
  pulse or spin), and no odd open/close flourishes on pickers.

## Geometry

Use the tokens in `tokens.css`, never raw values:

- **Spacing:** gaps and padding step through `--space-1`…`--space-7`
  (2, 4, 6, 8, 12, 16, 24 px). No 1, 3, 5, 7, 9, 10, 11 or 14 px gaps.
- **Control sizes:** `--control-h` (40 px) on the desktop, `--control-h-touch`
  (44 px) on touch screens, `--control-h-sm` (32 px) for controls inside rows
  (Advanced Settings selects, pickers, toggles and segments) and small icon
  buttons in lists (Star, View Source, Search, Close), which are round.
- **Touch targets:** on the phone everything a finger taps reaches 44 px; a
  control drawn smaller keeps its look and gets a centred 44 px hit area (the
  touch-target rule at the end of `phone.css`).
- **Segmented tracks** come in two sizes only, large (`--control-h`) and small
  (`--control-h-sm`), with `--seg-pad` (3 px) of track around the options.
- **Rows:** `--row-h-menu` (38 px) in desktop menus and popovers,
  `--row-h-settings` (44 px) in Settings, `--list-row-h` (48 px, 44 px on
  short screens) in phone sheets and pop-up lists.
- **Lines:** `--glass-border` for the edge of a surface, `--line` for
  separators between rows and groups, `--line-strong` for a focused field's
  edge. One edge per side: a panel with a shadow has no extra border.
- **Radii** follow radius = inner + padding: `--r-panel` (28) for the
  composer, sidebar and modals, `--r-menu` (22) for menus and popovers,
  `--r-item` (14) for rows and options inside them, `--r-media` (10) for tiles
  and thumbnails, `--r-field` (10) for fields that are not pills, `--r-check`
  (5) for checkboxes and `--r-pill` for controls, chips and every circle.
  Nothing inside a rounded surface has square corners.
- **Icons:** 16 px (`--icon`) for actions, 14 px (`--icon-sm`) in chips and
  rows, 20 px (`--icon-touch`) on phone bars; the default stroke, and check
  marks at `--check-stroke` (2.5).

### Stylesheet

`src/styles.css` imports one file per concern in cascade order: `tokens`,
`base` (Tailwind, fonts, element defaults), `motion` (press feedback and
transition defaults), `surfaces` (modals), `controls`, `lists`, `focus` (the
neutral ring), `shell`, `pickers`, `composer`, `dropdowns`, `gallery`,
`viewer`, `settings`, `library`, `messages`, `lockscreen`, `phone` and
`forced-colors`. A component's rules, its responsive and reduced-motion
variants included, live in its file; a container's file comes after the parts
it holds, so its contextual rules win at equal specificity. Put a new rule in
its component's file, and only reach for `!important` to beat inline styles,
third-party markup or every component at once (the reduced-motion kill
switch, `[data-settling]`, the press overlay, forced colours).

### Breakpoints

Width queries use these values only (min-width variants start one pixel up):

| Name | Query | For |
| --- | --- | --- |
| Wide | `max-width: 1600px` | The gallery toolbar's filters stop anchoring beside search |
| Desk | `min-width: 1051px` and `max-width: 1120px` | The viewer's zoom pill beside Details |
| Tablet | `max-width: 1050px` | The two-row gallery toolbar, the stacked deck, Details over the image and closed at first (`useViewerControls.ts`) |
| Side | `min-width: 901px` | The viewer's summary clears the Details column |
| Phone | `max-width: 760px` | The phone layout (`NARROW_QUERY` in `device.ts`) |
| Small | `max-width: 640px` | Compact docks, viewer and dialogs, the one-column gallery toolbar |
| Compact | `max-width: 480px` | Two gallery columns, compact empty states and sheets |
| Library | `max-width: 400px` | The Library's link and pick rows wrap |
| Narrow | `max-width: 379px` | The phone's name hides, Create's footer stacks |
| Tiny | `max-width: 359px` | The smallest phones' bar labels and picker tabs |

Height queries: `max-height: 700px` (shorter list rows), `max-height: 520px`
(phones held sideways), and `PHONE_QUERY`'s 500 px in `device.ts`. Input
queries (`hover`, `pointer`), `prefers-reduced-motion` and `forced-colors`
describe the device, not its size.

## Media

Media pauses when it is covered or closed. Closing the video viewer, stepping
to another item or hiding the tab stops playback for good (pause, drop the
source and `load()`), so nothing plays in the background. On a phone, a
sheet, picker or Details over a playing video or the gallery pauses the
viewer's video and the grid previews (`mediaCover.ts`); when the last cover
goes, the viewer resumes only if it was playing, and previews resume as usual.

## Layering

- Avoid modals unless they are clearly the best option. Modals are for
  genuinely focused tasks (inpainting, a first-run setup, naming something);
  confirmations ask inline in the status pill (see [Messages](#messages)).
- **Phone:** at most one layer above the main screen. A new surface replaces
  the current one, or navigates within it with a back step; it never stacks on
  top. Every sheet and sheet-style picker registers with `phoneLayers.ts`:
  only the newest shows, the ones under it step aside (`is-covered`) until it
  closes, one dimmed backdrop stays behind, and a nested sheet shows Back
  instead of Close. One exception: **pop-up lists**. A pop-up list (Create's Model, References, LoRAs, Size and Advanced
  Settings; the top bar's menu and what's running) opens over Create or the
  page, one at a time, anchored to the row or button that opened it, the
  screen's width less a margin, on the solid panel glass. What is under it
  stays in view, dimmed and inert, and Escape, Close or a tap outside closes
  it.
- **A tap outside only closes.** On the phone a tap outside any pop-up,
  popover or dropdown (Size, Advanced, the `Dropdown` menus, the top bar's
  menu, the gallery filters) closes it and does nothing else: the click that
  ends the tap never reaches what was under the finger (the next Create row, a
  tile), so one tap never closes one surface and opens another
  (`useDismiss.ts`).
- Messages and status never cover the controls they are about (see
  [Messages](#messages)). On the phone the pill keeps both top corners clear
  over a sheet, pop-up, dialog or the viewer, so Close and Back stay in reach.
- Stacking uses the `--z-*` tokens, never raw numbers. The phone's order is
  `--z-phone-bar` < `--z-phone-scrim` < `--z-phone-sheet` < `--z-phone-pop` <
  `--z-phone-status`, the status pill above every sheet, pop-up, dialog and
  dropdown menu. The desktop stage climbs `--z-composer` < `--z-stage-bar` <
  `--z-dock` < `--z-toolbar` < `--z-history` < `--z-composer-open` <
  `--z-scrim` < `--z-drop` < `--z-deck` < `--z-viewer` < `--z-picker` (the
  reference picker and inpainting) < `--z-composer-menus` < `--z-modal` <
  `--z-popover` < `--z-tooltip`. Small numbers (−1 to about 7, and the run
  stacks' 20–22) only order the layers inside one component's own stacking
  context.

## Surfaces

Pick the lightest surface that fits:

1. **Inline expansion** for more of the same thing (a row's details). It
   pushes content down with a smooth height transition.
2. **Anchored popover** on the desktop for choosing or tuning something
   (model, LoRAs, references, Advanced Settings, size, filters, dropdowns). It
   opens directly above the button that opened it, start-aligned to the
   button and shifted to stay 8 px inside the screen, 8 px from the button,
   scaling from it; a trigger near the top (the gallery toolbar's filters, a
   header's menu) has no room above, so the same rule flips and it opens
   below. Its width comes from its content within limits (pickers 360–560 px).
   One helper places them all (`anchoredPlacement` in `composerSurface.ts`).
   It closes on outside click or Escape. On the phone the same content is a
   pop-up list over Create, anchored to the row that opened it (see
   [Layering](#layering)).
3. **Side panel or sheet** for a task with several steps or a long list
   (Settings, the Details panel, Create on the phone). Sheets have a handle,
   swipe down to close, a backdrop, and scroll inside themselves.

### Glass

Every translucent surface uses one token set from `tokens.css`, at one of
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
returns when it settles. Menus on the CSS `surfaceIn` entry (Model, Size)
spread `useCssSettling()` instead: `[data-settling]` from mount until their
own `animationend`. A dialog's scrim adds its blur when its fade ends.
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

There are no floating toasts, banners or alert dialogs. Every message,
question and failure shows in the **Studio status pill**
(`src/app/StatusMessage.tsx`, fed by `toast.ts`), one at a time, with the same
words and actions on both devices:

| Kind | Shows | Stays |
| --- | --- | --- |
| Info and success ("Prompt copied", "Settings applied") | The words, short, in the neutral or success tone | 3 s |
| Something undoable ("2 items deleted") | The words and **Undo** inside the pill | 3 s, then the change is final |
| A failure that needs action | The error tone, the words and one action (Try Again, Set Up) | 3 s |
| A question (confirmations) | The question, **Cancel** and the answer ("Delete 6"); under the pill, its whole text and, for several items, a scrolling list of their thumbnails and short names | Until it is answered; Escape or Cancel answers no |

- **Where, phone:** one host for the whole app (`PhoneStatus`): the top of
  the screen, centred on the top bar's line, outside every box and surface
  header, as wide as the screen less a margin, on the solid panel glass. A
  long message wraps onto more lines and is never cut short. On the main
  screen the bar's own row steps aside while it shows; over a sheet, pop-up,
  dialog or the viewer the pill keeps both top corners clear (Close and Back
  stay in reach) and the title it covers (a sheet's, a dialog's, the viewer's
  with Star and Info) steps aside. It sits above every sheet and pop-up
  (`--z-phone-status`), and every other host gives way to it, so no surface
  shows a pill of its own.
- **Where, desktop:** the gallery's top bar, before its tools. A surface that
  covers the bar (a dialog, the viewer) shows the pill at its own top edge
  while open, in its title's place. Only the newest open host shows it.
- **Timeout:** finite notifications last three visible, unpaused seconds. A
  circular ring around Dismiss shows the remaining time; hover, focus and a
  background tab pause both. A repeated or merged notification resets the
  countdown. Reduced motion keeps a static ring. Confirmation questions wait
  for an answer, and explicitly persistent operation progress stays until its
  producer finishes; its completion notification lasts three seconds.
- **One at a time:** a new message replaces what is showing; nothing stacks or
  turns up stale later. Failures and questions wait for their answer, and
  plain news that arrives behind an Undo or a failure is dropped. A repeat of
  the same message folds into the one on screen and restarts its time, with
  no "×3"; only a count the words themselves say ("4 items deleted") grows.
- **Almost nothing asks first.** Reversible actions (delete with Undo, stop,
  disable, restart, revoke) act at once; only what can't be undone (Reset All
  Settings) asks. There is no Confirm Before Removing Things setting.
- **Confirmations ask inline** in the pill, never in a dialog (`useConfirmation`), with
  the question once and one line on what happens under it.
  Cancel takes the focus first. The pill is an `alertdialog` named by the
  question. On the phone the question's text hangs under the pill, the
  screen's width, clear of the control that asked. Deleting several items lists them under the question, with the
  count in it ("Delete 6 Items?"), and Undo follows in the same pill.
- **Status, not messages:** status messages always go to the pill, never
  inline under a field or row. Field validation (a JSON editor's error) and
  empty or failed lists (`EmptyState`, with Try Again) stay where they are.
- **Never over controls:** on the desktop the pill takes the place of a title
  or hint and never floats over fields; on the phone it covers only the top
  bar's line and a surface's title, never the controls a question is about.
  Touching it never dismisses the surface under it.
- **Words:** Title Case for questions and actions; sentence case for news,
  without a full stop; "Couldn’t …" for failures.
- Screen readers hear every message through one announcer (`StatusAnnouncer`:
  polite, failures assertive). Generation progress (started, ready; never
  each step) speaks through the same polite region, which says whichever
  changed last. There is no second app-wide announcer; a surface's own status
  line (an import's progress, an empty state) stays where it is.

## Lists

Every phone sheet and step (Create, Model, References, LoRAs, Size, Advanced
Settings, More) and Settings use one flat list (`src/app/SheetList.tsx`,
`lists.css`), like iOS Settings without the cards:

- **Rows** are full width and one line: the label on the left, the value
  muted on the right (cut short with an ellipsis), then a chevron when the row
  opens a step or the shared amber tick (`SelectedTick`, `end="check"`) when
  it is the selected option. 48 px high on a
  phone (44 px on short screens), 38 px in desktop popovers, hairlines between
  them. No row sits in a card, and no card sits in a card.
- **Controls stay in the row:** a `NumberPicker` for numbers (Steps, CFG,
  percentages), a dropdown that shows the friendly name (the app's own on
  both devices, never the phone's native picker; see [Dropdowns](#dropdowns)),
  a pill toggle for one choice (Seed's Random), a segmented toggle for a few,
  a switch for on and off, all at `--control-h-sm`.
- **Full-row toggles:** a row with a switch toggles from anywhere on the row,
  not only the switch (`SwitchRow`).
- **Save & Discard:** an editor that changes several things at once (an access
  profile, a profile's JSON, what each GPU runs) keeps its changes as a draft
  and shows one Save & Discard row (`SaveRow`) while something differs; the
  rows above it never save on their own.
- **Names, not files:** model parts read as names ("Qwen3 VL 8B INT8"), with
  the file name only in the picker (`partNames.js`).
- **Sections** have one quiet heading, never repeating the row label under it
  ("Sampling", then Steps, Sampler, Scheduler, CFG and Seed). A heading may
  carry one action on its right, on the same line (`Group`'s `action` with
  `GroupAction`: Accounts' New Account), instead of a row that only holds a
  button.
- **External links:** a row whose only control opens a website (About's
  Changelog, Licence, Source and Credits; Help's Troubleshooting) shows a
  plain link aligned like other row values (`ExternalLink` in
  `SettingsControls.tsx`): muted text with a small external-link mark, the
  accent and an underline on hover, no button chrome.
- **Multi-selects** (`MultiSelect.tsx`): picked rows take the accent tint and
  its tick. **All** picks everything at once, even values that wait for
  another one (References need Generation): pass `onAll`. A short list
  (a group's Models) has no search box.
- **Size** shows the resolutions as one full-width toggle with no label, then
  the shapes as one vertical list, as on the desktop: the shared rows
  (`ListButton`), each with its shape, its name and the size it makes, and the
  amber tick on the pick; **Custom** is the last row, and Width and Height are
  always at the bottom. The fields are enabled only while Custom is the pick;
  choosing a shape locks them again. There is no grid of shape tiles, no
  Custom Size toggle, no saved sizes and no megapixel or ratio caption under
  the fields (the preview names the size). No preview stage on the phone.

## Dropdowns

One dropdown everywhere, desktop and phone (`Dropdown.tsx`; `StudioSelect`,
`ListSelect` and `MultiSelect` are its forms): Advanced Settings, Settings
rows, forms, the composer's Recipe and the pickers' heading menus. No native
`<select>` and no phone picker.

- **Trigger:** the value and a chevron at `--control-h-sm`: muted at the end
  of its row in a list (`row`), a compact bordered pill in a toolbar (`pill`),
  a filled well in a form (`field`), or a picker heading's menu (`heading`,
  the phone views and Stacks, in the foreground and the selected tint while
  open), or only an icon in an icon row (`icon`: the prompt assistant's caret
  on the desktop and its magic button on the phone). It is a combobox named by
  its label.
- **Menu:** the shared popover placement and motion (see
  [Surfaces](#surfaces)), on the panel glass with `--r-menu`; on a phone the
  pop-up list's width, still anchored to its trigger and one layer only. Rows
  are `--row-h-menu` (44 px on touch), `--r-item`, `--cursor-bg` under the
  pointer or keyboard cursor, and the chosen option shows the shared amber
  tick (`SelectedTick`) with no row fill. Long lists scroll and offer a search
  field behind an icon in the head; the open field carries its own Close
  Search at its end (it clears and folds the search), in place of the icon.
  The gallery's filter menus search the same way. A heading's views menu is
  as wide as its options (within the usual bounds), on the phone too.
- **Keyboard:** the arrow keys, Home and End move between options, typing
  jumps to a name, Enter or Space chooses, Escape or a click outside closes,
  and the focus returns to the trigger.
- **Several values** (`multiple`): the same rows and ticks; the menu stays
  open, with All and Clear in its head, and the trigger names the one value or
  counts them. Filters with their own All (the phone's model filters) drop
  the head. The gallery's filter menus follow the same rows and ticks.
- **Commands** (`actions`) follow the options after a divider, as plain rows
  (Delete in the danger ink); a command closes the menu unless it opens a
  `panel` in its place, such as the stack name field.

## Pickers

One chooser pattern for References, LoRAs and Models (`PickerTools.tsx`): one
heading row, then the grid or list. On the desktop it is an anchored popover;
on the phone a pop-up list over Create (see [Layering](#layering)).

- **Desktop heading:** no title or icon: the views lead (Library | Uploads |
  Selected n/max, This Model | All | Selected n/max, or the model filters All ·
  ★ · Fast · Quality, all on the same selector track), then the LoRA
  **Stacks** dropdown, Upload (References: an icon button styled like the
  search icon), **Clear**, the search icon, then Close, all on one centre line.
  There is no hint text and no toolbar row under the heading. A narrow LoRAs
  popover drops the Stacks label first.
- **Phone heading:** the title stays plain text and only the view after it
  is the dropdown ("LoRAs · [This Model ▾]", "Reference · [Library ▾]" or
  "References" with several slots, "Model · [All ▾]"); the filters that
  combine (Favourites with Fast or Quality) are ticks in the same menu, which
  stays open while choosing. Then Upload (References, an icon like search),
  Clear, the search icon and Close, every target 44 px. There are no Stacks on
  the phone (Settings › Studio › LoRA Stacks edits them). The list starts
  right under the heading, with no empty tools row.
- **Compact search:** an icon, not a permanent row. The icon (or typing
  anywhere in the chooser) opens the field with the focus in it. On the
  desktop References and LoRAs `cover` the heading: the field fills it, at
  `--control-h-sm`, over the views, Stacks, Upload and Clear (Close stays);
  Models use `row`: the field drops down under the heading, the popover's
  width, and the filters stay. On the phone it opens under the heading. The
  open field carries its own Close Search (an X at its end, in place of the
  icon and of the field's own clear); Close Search clears the query and folds
  it away, and choosing a view on the desktop starts from there. The field
  stays open while a query is active. Choosers keep a minimum height, so a
  short list or a narrow search doesn't shrink them.
- **Clear** shows only while something is picked. It empties the selection at
  once and offers Undo in the status pill; it never asks first.
- **One selected mark:** a picked row or tile shows the amber tick
  (`SelectedTick`: the same icon, size and stroke 2.5 in every chooser; it
  leads a row's right-hand icons, so in Models it sits third from the right,
  before the abilities and Star, and in LoRAs before View Source and Star; on
  a tile, an amber badge in the corner). One tap adds or removes; a pick stays where it is, across searches
  and views. Order numbers (the number on amber) appear only in the Selected
  view, where the picks are listed in order with strength and enable controls.
- **Reordering** happens in the Selected view (and the LoRA card list): drag a
  row's grip with a mouse, pen or finger (`useReorderDrag.ts`), or press the
  arrow keys on the grip. Nothing animates: the dragged row dims, the row under
  it is outlined, and the order changes on the drop. References and LoRAs use
  the same hook; there is no framer `Reorder`.
- **LoRA rows are Models rows:** the same height (58 px in the desktop
  popover; 52 px with hairlines between them and 15 px names on the phone, as
  the phone's model list), padding, rounded `--cursor-bg` hover filling the
  whole row and section headings (Favourites, this model's family, then under
  All what the rest were made for). The friendly name, then one muted line of
  its description cut short with an ellipsis; a reason it can't be added (or
  may not suit) follows in full. On the right: the amber tick when picked,
  then View Source as small icon buttons, one per host (`Globe` for
  civitai.com, `ShieldOff` for civitai.red, `ExternalLink` for any other
  source; tooltips and names "View X on civitai.com"), then Star. No pills,
  cards or hairlines on the desktop. Nothing opens under a row while
  browsing; the Selected view shows each pick's information in full in place
  of the one line, then on/off · strength · order (see [Action
  Placement](#action-placement) › LoRA information).
- **LoRA stacks:** the Stacks dropdown in the desktop heading lists the
  model family's saved stacks alphabetically with the one in use ticked;
  choosing one applies it at once with Undo. Under them: Save Current as New
  Stack, and for the stack in use Update "…" with Current Picks, Rename and
  Delete (at once, with Undo). There is no Enable All or Disable All; each pick
  has its own switch in the Selected view. Settings › Studio › LoRA Stacks
  edits them.
- **Heading dropdowns** (the phone views, the desktop's Stacks) are the shared `Dropdown`
  (`variant="heading"`; the combining filters as `multiple`), so they share its
  entry, rows, amber tick, keyboard and Escape that closes the menu only.
  There is no separate picker menu component.
- **Models** have no modal: the model button opens the chooser with the same
  heading and family groups (fine tunes under their family), and nothing else.
  Profile names show as they are, on two lines at most.
- A model's own LoRA limit shows as one quiet line under the heading
  (Radiance video: "Up to rank 64 in total").
- **Suggested:** with the prompt assistant, This Model opens with a Suggested
  section for the current prompt (cached per prompt and kept while the picker
  is open, so rows never move), each row's line giving the reason, strength
  and the trigger words it adds; the rest follow under More LoRAs. Picking a
  suggested row adds it like a chip: its strength, its triggers, Undo.

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
  single-slot model keeps its one thumbnail chip. A model that takes no reference shows no
  References control at all (no Reference With). Edit | Reference and the
  inpaint brush sit beside the button.
- **LoRAs** use the same pattern: This Model | All | Selected n/max in
  the library, one tap to add or remove, no row animations.
- **Prompt assistant** (`PromptAssistant.tsx`, `usePromptAssistant.ts`; only
  for accounts with Prompt Assistant and a configured model, otherwise absent):
  - **Magic button:** a Sparkles icon first in the prompt's action row, the
    same quiet icon button as History and Clear. On the desktop a tap rewrites
    with the last preset (Enhance at first) and a caret beside it opens the
    shared Dropdown of presets (Enhance, Spicy only with NSFW Models,
    Photographic, Cinematic, Concise, Candid), each with a one-line
    description, then Suggest LoRAs as a command. On the phone the button
    opens that list as the pop-up list, with the last preset ticked; it sits
    in the row's one free place. In the focused-text row it rewrites with the
    last preset in one tap and keeps the keyboard up, so the text streams in
    where it is being edited.
  - **While it writes:** the text streams into the field in place, the field
    is read-only (no caret), History and Clear wait, and the button becomes
    Stop. Stopping or a failure puts the original text back.
  - **When it ends:** the pill says "Prompt rewritten · Enhance" ("Prompt and
    negative rewritten" when the negative followed) with one Undo for both,
    and the replaced text goes to History. Failures say why in the pill
    ("Couldn’t rewrite the prompt. The prompt assistant took too long") with
    Try Again; offline and not-set-up say so too. Nothing asks first.
  - **References:** a vision model reads the attached references (downscaled
    to 1024 px); otherwise the rewrite is text only and the button's tooltip
    adds "References not read by this model."
  - **Negative:** a Sparkles button beside Negative's History writes one, with
    Undo. It is absent where the profile takes no negative (its capability, or
    a guide whose negative does nothing), and a rewrite refreshes the
    negative only there.
  - **Suggested LoRAs:** after a rewrite or Suggest LoRAs, one row of chips
    under the prompt (title, strength, the first triggers), ending in Add All
    and a Dismiss; it scrolls sideways when full. A tap adds the LoRA at its
    suggested strength, an added chip takes the amber tint and a second tap
    takes it off. Adding puts its missing trigger words at the start of the
    prompt (`assistantText.js`); Undo takes the LoRA and the words back. Taking
    a suggested LoRA off the stack anywhere offers **Remove Trigger Words** in
    the pill. Nothing is added without a tap.
  - **Results** record the preset, model and chosen suggestions; Details shows
    "Written By: Assistant · Enhance" ("Assistant in Chat" for MCP) and
    the inputs Copy includes it.
- **Number steppers:** one `NumberPicker` (minus, value, plus) everywhere; on
  touch screens each part is a 44 px target. Names read "Decrease Images",
  "Increase Steps".
- **Phone Create sheet:** one flat column. The prompt takes the height the
  rest leaves (it scrolls rather than grows), with the prompt assistant's magic
  button (when the account has it), Select All, History and Clear in one row at
  its top right, centred on the first line of text (the text runs beside it).
  Suggested LoRA chips follow the prompt as one sideways-scrolling row. Every icon there
  is the same quiet button: muted, `--control-hover`, the global press, amber
  only while its surface (History, the assistant's list) is open. Negative is
  two lines with its assistant button, History and Clear.
  Then one row each for Model, References, LoRAs (their Clear on the right),
  Size and Advanced; each opens its pop-up list over Create. The sticky footer
  has two lines, always in view: Steps then the image count, labelled (the
  desktop composer's order), then Image/Video · Clear All · Generate, all
  44 px high on one centre line. Clear All is a round ghost icon (an eraser)
  that clears the prompt, negative prompt, references and LoRAs at once, with
  Undo; the phone filter row's Clear is the same icon button. Nothing reaches past the right edge at
  320–430 px (`phone-create.spec.ts`). Editing Prompt or Negative with the keyboard up
  shows only that field (see [Keyboard & visual viewport](#keyboard--visual-viewport)).

- The desktop composer stays bottom centre and expands upwards; its pickers
  are anchored popovers, each above the button that opened it. Every control stays in its bar: as room runs out they
  step down to compact and then mini chips, and there is no More Settings
  drawer.
- **Advanced Settings** open in the composer popover, like LoRAs and
  References: anchored above the Advanced button, the same glass, motion and
  dismissal (outside click, Escape, its button again; focus returns to the
  button). It is one column about 400 px wide: the flat list, dense
  (`--row-h-menu` rows, labels on the left, dropdowns and `NumberPicker`
  steppers on the right at `--control-h-sm`, one quiet heading per group),
  as tall as its rows and scrolling inside past the room above, with every
  option the profile exposes but Width and Height (they belong to Size). On
  the desktop it has no heading (Escape, an outside click or its button close
  it); the groups, and the rows in each, read alphabetically, with a master
  control before what depends on it. **Upscale** and **Face Detail** are
  chosen per generation here, starting from Settings › Studio; face detail
  runs only with an upscale. The phone shows the same list as a pop-up over
  Create.
- **Size** stays open while choosing: the resolution is a segmented toggle of
  the model's native options (Default · 2K · 4K), beside the shapes, so both
  can be picked in one go. The menu holds only the model's presets and
  Custom, on the desktop and the phone: Custom is the last row of the list and
  unlocks Width and Height under it. There are no saved sizes; any kept from
  before stay where they were, unread.

## Settings

One side panel with a list of sections on the left (a sideways row on the
phone) and one page at a time, each with its title and one line on what it
holds:

| Section | Holds | Who |
| --- | --- | --- |
| Account | MCP and Profile (name, email, password) | Every account |
| About | The banner, Version, Changelog, Licence, Source, credits (HEISS UI, J-AI Studio, ComfyUI, Radiance) and stats | Everyone |
| Groups | Groups (a picker with New, multi-selects, Save & Discard) and New Accounts (Default Group, with Require Approval beside it) | Administrators |
| Maintenance | Clean Up, Help and Reset | Everyone (each item as the device allows) |
| Models | Defaults and Integrations (the assistant models, Civitai and output storage). LoRAs, the catalogue and downloads are in the [Library](#library) | Administrators |
| Profiles | One model profile at a time: Profile and Source (AI-Drafted with Approve, From the Seed, Edited in Studio), then JSON, Guide or Versions (a segmented Show row). JSON and Guide edit with Review Changes and Save & Discard; Versions is a flat list whose rows open in place to their diff and Revert. Export on the heading downloads the bundle for the profiles repository | Administrators |
| Studio | Features (Inpainting and Upscale as plain rows), Gallery (Date Headers, Stacks Look Like, Tile Captions, Wide Images), General, Generation, LoRA Stacks (each stack's name, LoRAs and strengths, with Save & Discard; Delete with Undo) and Sharing | Everyone |
| Users | Accounts (each account with its group, with Approve on a waiting one; New Account on the heading) and Chat Gateway (Chat Gateway Admin Tools, off by default, then each linked and waiting chat user) | Administrators |
| Workers | Add Worker on the Workers heading, then every ComfyUI worker in one standard group (Address, Capabilities, Status with Test, Open, Restart; Name and Remove for Studio's own) | Administrators |

**Order:** the rail reads Account, Groups, Models, Profiles, Studio, Users, Workers, Maintenance, About; a General group always leads its page; groups, rows,
option lists and pills inside them read alphabetically too. The exceptions are
logical ones: a master switch comes before what depends on it, Save & Discard
is an editor's last row, an editor's fields follow the order they are filled
in, Version leads About, Reset (destructive) stays its own group, and Workers
lists the deployment's workers before Studio's own.

**Who is an administrator** comes from one access model (`src/app/access.ts`,
`useAccess`): with accounts, the signed-in account's role, wherever Studio is
open; without them, the device (the computer Studio runs on, or a signed-in
device its owner trusts). Every surface that hides administration (Settings'
rail, the Library, model folders and downloads, installs, restarts, workflow
files) asks it; none checks the device or the account on its own. The account
status is fetched once by the sign-in gate and shared; Settings asks again
only when that answer is over a minute old.

**Groups** (access profiles on the server) grant features and local models. Cloud models are never
listed: the Cloud Models feature grants them. NSFW Models gates any model
profile marked `nsfw`. A feature the deployment switched off (LoRAs, Cloud
Models) shows disabled with "Off for This Deployment"; there are no global
switches for them in Settings. Presets & Civitai Imports is not offered: it
stays with administrators.

A new setting goes in the section that matches who changes it and why;
destructive actions live in Maintenance, never beside everyday switches.
Every row does something in the running deployment: rows for a local install
(output folders, finding ComfyUI on its own, the studio password for other
devices) hide in account mode, and there are no community, feedback or
donation links. Settings use the flat list (see [Lists](#lists)), dense:
44 px rows, a one-line description, one heading per group. **Sign Out** is in
the desktop dock's Account menu and at the top of the phone's More (not in
Settings); it never asks first, even while something is generating (the runs
finish on the server and appear on the next sign-in).

Gallery **Date Headers** ("Today", "This Evening") are a Studio › Gallery
switch, off by default. Auto-Grouping, Grid Autoplay and Failed are not
settings: they are gallery view controls (see [Gallery View
Controls](#gallery-view-controls)).

**Workers** (`WorkerSettings.tsx`) shows every worker the same way: one
group headed by its name, then the same rows in the same order with the same
words: Address (with its source tag and Edit), Capabilities, Status with Test,
Open, Restart, and Remove (a quiet text action) on Studio's own. Only the
capabilities differ; there is no separate Upscale status, as Capabilities shows
it. An action that doesn't apply stays in its place, off, with a short reason
before it ("Locked", "Offline", "Save first"). **Add Worker** sits on the
Workers heading's line, like New Account. The deployment's workers come first
and are locked; Studio's own, and a new one, are edited in place (Name and
Address as fields as wide as the account editor's, Capabilities as a
multi-select) as one draft with one Save & Discard row after the last worker.
With no workers the page is an `EmptyState` ("No Workers Yet") under the
heading. Restart acts at once.
GPU allocation is not in Studio: it stays in AI Control's own UI and Mise.

## Library

The Library (`Library.tsx`, administrators only) opens from the desktop dock
and the phone Menu and uses the Settings panel's anatomy: the same sheet, a
section rail (a sideways row on the phone) and one page at a time with its
title and one line. Choosing the page you are on starts it over (a review
returns to its list). Its five pages, in this order:

| Page | Holds |
| --- | --- |
| Import | One field: paste a Civitai or Hugging Face link, or drop a link or a PNG, WebP or JPEG on it; Image beside it chooses one (the phone's way in). Under it, the History: one row per import with its kind icon, name, kind, "From Chat" for an administrator's chat import (MCP's Import), "n Missing" and date, the grade chip and its state |
| Images | The saved Civitai images as an even 4:5 grid, each with its grade chip and missing count; search once there are two or more |
| LoRAs | Installed and catalogued LoRAs and supporting files, with provenance, version, links, trigger words and file; Installed, Catalogue and Updates views |
| Models | Checkpoints, diffusion models, text encoders, VAEs and CLIP vision the same way (Installed and Updates), then any catalogue switch that remains global |
| Downloads | Every model download in Running, Failed and Done groups |

Import and Images follow the deployment's Presets & Civitai Imports switch;
without it the Library holds LoRAs, Models and Downloads.

- **Grades:** one chip, Exact (green with its tick), Close (quiet) or Partial
  (amber), with a missing count on an Images card ("Partial · 2 Missing") and
  its reasons in the tooltip. A review lists the reasons under the chip.
- **Records open in place:** an import (or an Images card) opens its review
  where the list was, with Back ("Import", "Images") on the left of the bar and
  the source links (the LoRA rows' "com" and "red" pills, "HF") or View on
  Civitai and Delete on the right. Then the name and kind, the grade with its
  reasons and the Files group.
- **Files:** one row per file: its name, then its folder by name ("LoRAs",
  not `loras`), version, size and source; a reason when it is unavailable
  (paid, early access, restricted, no checksum) with a free version to use
  instead where there is one; the shared `set-progress` bar while it
  downloads; its state on the right. A Hugging Face file whose folder is a
  guess carries its Destination dropdown until it downloads. Check Again sits
  on the group's heading.
- **Image imports:** a dropped image's review is the Images review's
  anatomy: the picture beside its name, where the recipe came from ("A1111
  Metadata · PNG · fox.png"), the prompt, negative and settings, then the
  grade, Use With (the shared Dropdown) and Files. A file found by name only
  says Found By Filename. Describe with AI sits on the right of the bar; without
  a vision model it is disabled with the reason in its tooltip, and the Import
  page says so in one line. A described image is always Partial and lists the
  suggested profile and LoRAs in its reasons.
- **Substitutes:** a stand-in for a missing file is never silent: the row's
  state says Substitute in amber, a line under the name says "Using
  `file` · Another Version: Version 9 instead of 8", and the grade lists it.
  The row offers Download Exact File until the exact file is installed, then
  Use Exact File.
- **Other Versions:** offers sit in their own group after Files, one row per
  file: what it is (Newer Version, Older Version, Other Precision, Other
  Format), its version, variant ("GGUF Q4_K_M", "FP8"), base model and size,
  and its own Download on the right. Only offers that fit the family and the
  worker are listed; a paid or early-access one shows Unavailable · Paid
  with the reason and no button. Nothing in the group downloads until chosen.
- **Footer:** the review's actions: **Download Missing** (one tap queues every
  missing file; unavailable files and files with no recorded source never
  download), Use Prompt and Use Settings. A repository's files are optional:
  each has its own Download.
- **Drafted profiles:** a checkpoint or diffusion model import drafts its
  profile on import; the review says so in one note (AI-Drafted, for
  administrators until approved in Settings › Profiles). The parts it needs
  join the Files group. When a draft failed, its reason is among the notes and
  **Draft Profile** (Sparkles) sits in the footer before Download Missing.
- **LoRAs and Models:** compact `PickerTools` search, the Installed |
  Catalogue | Updates views (Models: Installed | Updates) and family (LoRAs)
  or kind (Models) pills on one row, then a flat list: the title, then what
  it is, version, base model and size, its provenance ("Civitai · Imported",
  "From the Seed"), trigger words and strength, and the file; the source
  links and Installed, Not Installed or Update Available on the right.
- **Updates:** the Updates tab carries its count; the view is one group with
  Check Updates on its heading and when it last checked under it. Each row
  says "Update Available: V3 · 228 MB" (and why a paid or early-access one is
  refused, with the free version) and has Update (or Update to the free
  version). While it downloads the state says Updating…; afterwards a line
  says whether the old file was removed or what still uses it. An update
  never downloads on its own. Update Available puts a dot on the dock's
  Library icon (its tooltip says so) and a count on the phone Menu's Library.
- **Downloads:** the shared progress pattern (`Progress.tsx`): the file, its
  folder and size, the bar while it runs, the failure under the name, the
  state on the right in the shared words (Queued, Downloading 45%, Checking…,
  Paused, Done, Failed, Cancelled) with one action (Cancel, Retry or Resume).
  The same `ProgressBar` (`set-progress`, dimmed while paused) and words
  serve imports, saved images, model and upscale setup, starter models and
  the activity pill for worker transfers; there is no second bar. A transfer
  that fails out of sight says why in the status pill ("Couldn’t download
  …", with Try Again or Set Up), never as an error box or a pill that waits;
  the ZIP of several items says it started there too.
- **Speed:** lists compare file names and sizes only; opening one import or
  image checks its checksums (kept on disk, so a restart never reads every
  model again). The code loads while idle (`preloadable.ts`), placeholders hold
  the list's place while it arrives, and the last list shows at once on
  reopening.
- Failures go to the status pill; the page never grows its own error box.

## Buttons & Icon Bars

- Icon buttons are 40 px on the desktop and 44 px on the phone, round, ghost
  until hovered, with an accessible name and a tooltip naming the action.
  A tooltip starts with the action's name and fits on one line ("Recreate With
  the Same Seed"), so it never covers a neighbouring control.
- **Glass icon buttons** in a 48 px bar (the docks, the viewer bar) keep the
  40 px target, but their hover and press fill is a smaller circle
  (`--icon-fill`, 32 px), inset evenly by `--icon-fill-inset` so 8 px of glass
  shows around it on every side; the phone's 44 px bars use the same pattern.
  Hover is `--control-hover`, a press darkens the fill and nothing moves, the
  keyboard ring (`--icon-ring`) traces the fill circle inside the bar. Hover
  and focus change at `--motion-fast`, presses at `--motion-instant`. Change
  only `background-color` on these buttons: the `background` shorthand resets
  the clip and the fill grows to the full target again.
- **Presses:** every button, row and tile darkens in place when pressed (see
  [Motion](#motion)); none scales, shrinks or shifts, Generate included.
- Tile corner buttons are their own glass circles: hover darkens them, a press
  darkens them further, and the keyboard ring sits just outside the circle.
  The phone viewer bar's press fill is a rounded shape inset inside its cell,
  never touching a divider or the bar's edge.
- **Tooltips** open on the side away from their bar's edge, 8 px from the
  control: below top bars (the gallery toolbar, the viewer's top corner,
  Settings and Library headers), above bottom bars (the composer, the docks,
  the viewer's action bar). `Tip` works this out from where its control sits;
  a bar or side panel that needs another side says so once with
  `data-tip-side` instead of a prop on every button. Desktop controls use
  `Tip`, never the native `title`. Nothing else floats on a bar's tooltip side:
  the viewer's zoom pill sits in the bottom right corner, level with the bar,
  not above it.
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

Selection uses the accent (`--selected-bg`, `--selected-ink`); the keyboard
cursor and hover in a list use the neutral `--cursor-bg`. One treatment per
kind of element:

| Element | Selected / on | Hover / keyboard cursor | Shape |
| --- | --- | --- | --- |
| Rows and list options (menus, pickers, filters, model, size, LoRA, starter versions) | No row fill: an amber check or lead; amber checkboxes (`--accent-amber` with an `--accent-amber-ink` check) | `--cursor-bg`, inset inside the popover | `--r-item`, never bleeding past the rounded popover |
| Chips, tabs, segmented toggles, filter triggers, pressed toggles | `--selected-bg` with `--selected-ink` | `--control-hover` | `--r-pill`; a static fill, no sliding indicator |
| Icon toggles in bars (Star, Search, Info, Filter) | An amber icon (Star filled); no disc | `--control-hover` inside `--icon-fill` | Circle |
| Switches | Track `--accent-amber`, thumb `--accent-amber-ink` | — | Pill |
| Tiles and media | A 2 px `--accent-amber` outline inside the edge and an amber check badge | `--glass-border` outline | `--r-media` |
| Section rails (Settings sections, sidebar tabs) | As chips: `--selected-bg` with `--selected-ink`; no marker or underline | `--control-hover` | `--r-item` |

- **Focus rings** show only for keyboard focus (`:focus-visible`); a click
  never leaves a ring, highlight or pill behind, so `:focus-within` styling
  uses `:has(:focus-visible)`. A standalone control takes
  `box-shadow: var(--focus-ring)`; inside a surface or bar the ring is
  `outline: 2px solid var(--icon-ring)` with `outline-offset: -2px`,
  following the element's radius. Rings are never amber, blue or white.
- **Hover** is one fill, `--control-hover` (on glass circles as a
  `background-image` so the clip stays). Hover is never the only way to reach
  something; tile captions also show on `:focus-visible`/`:focus-within`.
- Plain text (such as "N Selected") never looks selected.

## Action Placement

- `src/app/itemActions.ts` is the one list of what an item offers on each
  surface (viewer bar, tile, context menu, select bar) and in which order.
  Surfaces render from it and never build their own lists.
- **Order by intent,** with a divider between groups: keep it (Copy,
  Download or Share) | make more (Animate or Extend, Recreate,
  Reference, Retry, Upscale) | organise (Star, Select, Delete) | Info.
- **One-word names** everywhere: Copy, Download, Share, Animate, Extend,
  Recreate, Reference, Retry, Upscale, Star, Delete, Info. Tooltips
  may say more.
- **Recreate** ("Recreate With the Same Seed") loads the model, both prompts,
  size, LoRAs, references, every setting and the same seed into Create. The
  viewer closes and Create opens, ready to change or generate.
- **Tiles, desktop:** Star alone in the top left corner, and one row of 32 px
  glass circles along the top right (a 40 px target each, on the same line),
  from `itemActions.ts`'s `tile` placement in the viewer bar's order:
  Download | Animate or Extend · Recreate · Upscale | Delete, with Retry in
  Recreate's place on a failed item and a little more room between the
  groups. Images and videos place them the same way. Upscale is one of the
  row's circles, not a corner button: solid amber and pressed while the
  upscale shows, with a progress ring while it runs. A narrow tile drops the
  make group first, then Download; Delete stays longest (and Upscale while it
  runs or shows), and **More** (⋯) takes the last slot and opens the same
  menu as a right-click. The circles show on hover and keyboard focus; a set
  Star and a running or showing Upscale stay in view. The phone has no row: only a running
  upscale's ring shows, top left.
- **Tile caption, desktop:** two lines at the bottom on hover and keyboard
  focus: the prompt on one line, then the time · the profile's name (· a
  video's length), as in "2:14 PM · FLUX.1 Schnell · 6 s". Nothing else. The
  profile's name (`itemProfileName`) is the one Details' Profile row shows,
  also on a running tile's label and the phone's run sheet; the model part
  stands in only where no profile is known, never the model family.
- **Viewer, desktop:** Copy · Download | Animate · Recreate · Reference ·
  Upscale | Star · Delete, then Close. Info sits alone in the top right (beside
  the corner Close on tablets); it opens Details, and the open Details panel
  has its own Close in its header, as Info's corner is under it.
- **Viewer, phone:** a solid backdrop that hides the gallery's top bar
  completely. One top row: the title on the left (the profile's friendly name,
  then a short muted line: its place in the gallery "2 / 40", the time and the
  size · steps; it steps aside, with Star and Info, while the status pill
  shows), Star · Info · Close
  on the right, all on one centre line. The bottom bar Copy · Share | Animate ·
  Recreate · Reference · Upscale | Delete, centred with even sides in a
  bar-height row above the home indicator.
  Download replaces Share only where the browser can't share files. Info
  toggles Details (pressed, its icon turns amber with no disc): the bar is a
  trigger surface, so a tap on Info while Details is open closes it. Details
  opens under the top row, which stays as it is; the title never pushes it
  down. Gestures: swipe sideways to step, pull down to close, double-tap to
  zoom; with reduced motion they change at once.
- **Zoom:** a small `− 100% +` pill, bottom middle above the bar, faded until
  used; the percentage cycles Fit, 1:1 and Full Size. The same on both.
- **Details:** Prompt and Negative each keep Copy beside their label. The
  groups are Prompt, Model, Settings and Output (the picture, reference,
  upscale and its file together: Dimensions, File, Size and Time, with Size
  the file's size on disk, left out until it is known), then Timing, in one readable heading style;
  empty groups and rows are left out, and nothing repeats (no output Type;
  Model shows the Profile, never a Weights row). Rows within a group
  read alphabetically, except Timing (measured times before the estimates).
  The phone and the desktop show the same Details, from one component, and a
  video shows exactly an image's groups and rows under the same labels, adding
  only Duration, Frames and FPS (Denoise, which only redraws an image, is the
  one image-only row).
  The one footer is Copy · Recreate, for images and videos alike; there is no
  Refine in Chat. Copy includes generation inputs and saved
  settings, including IDs, seed and reference settings; output filenames,
  timestamps, timing and artefact metadata stay out. There is no Edit or
  separate Copy Settings action. **Timing** lists Active (the worker's run
  after queueing) before Queue and Total (which also counts transfer and
  finishing); split-up times keep "(Est.)". No explanatory line.
- **Viewer title:** always shown top left on both devices, as plain text with
  no box: the profile name (as Details' Profile row reads it, never the model
  family), then a muted line with the position ("2 / 40"),
  the time, the size and steps (a video adds its duration). The phone keeps it
  inline with Star · Info · Close. There is no Image Text button. Keep it clear
  of the Details controls and image actions.
- **LoRA information:** where a LoRA is in use (the chooser's Selected view,
  while it is on, and generation Details) it shows what it says about itself
  under its name, on the name's left edge, as plain muted text with no card or
  extra inset (`LoraDetails`): the description once, in full, in place of the
  one-line description, any catalogue note that adds something, the suggested
  strength once and the trigger words once as chips. No File or Family line,
  no "No description" placeholder, and no note that only repeats the trigger
  or the strength; with nothing to say there is no panel. Turning it off hides
  the panel at once; the friendly title stays and the file name is only in its
  tooltip. The source icons open civitai.com and civitai.red and never repeat
  inside the panel. Details lists LoRAs as flat rows like the chooser's (the
  name, then the strength and the source icons on the right, hairlines
  between), from the same components.
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
| Copy | `Copy` | Recreate | `RotateCcw` |
| Delete | `Trash2` | Reference | `ImagePlus` |
| Download | `Download` | Retry | `RotateCw` |
| Extend | `FastForward` | Recreate | `RotateCcw` |
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

One slim top bar and, at the bottom, the collapsed prompt bar; a tap on the
iOS status bar still scrolls the document to the top. No bottom navigation
and no boxes in the bars.

- **Left:** the status light (its colour says whether generation can run; a
  tap checks again) and "Studio", centred on one line. While jobs run, a
  spinner and count replace the light in the same space; a tap opens Show
  Running and Stop All. On narrow phones (under 380 px) the name hides.
- **Centre:** empty and flexible. While a message shows, the whole row steps
  aside for the status pill (see [Messages](#messages)).
- **Right,** in this order: **Search**, **Filter** and **Menu**, all 44 px
  icon buttons. There is no Select button: selecting starts with a long press
  on a tile, or Menu › Select. Menu's pop-up list, anchored at the right edge,
  holds Select, Library · Settings, then Account and Sign Out in account mode.
- **One bar height:** the top bar, the select bar, the viewer's top icons and
  the status pill share `--bar-h` and `--bar-pill-h`, so nothing jumps when one
  replaces another.
- **The prompt bar** is a slim glass bar at the bottom, on the shared bar
  height with safe-area padding: the gallery's **Images | Videos** as two icons
  at its left end, the prompt on one line in faded text (cut short, or
  "Describe an image…"), which opens the Create sheet, and Generate, which runs
  it as is (a ring fills while runs are going). A prompt waiting in Create
  keeps the faded text and adds an accent dot. The gallery's bottom padding clears it; it hides while
  selecting, when the select bar takes the bottom edge. Only this bar lives at
  the bottom: navigation never does.
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
- **Tiles** show nothing over the picture but its state: running or queued
  progress, a failed mark and, while selecting, the checks. No caption, corner
  icons or Stop. Settings › Studio › Gallery › **Tile Captions** (off by
  default) brings back the caption: the prompt and the output's name or type,
  never the generation time.
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
everywhere, only where there are videos) and **Hide Failed & Queued** (one
toggle that hides failed and not-yet-running outputs), in that order. They are pressed toggles, not settings and not filters, so
Clear leaves them alone. The desktop gallery toolbar holds them after its
filters and they step aside while selecting (grouping is off while selecting
anyway), and above Tablet the actions' column takes the room it needs from the search side (the columns stay even when there is room), so every selection action fits without being cut off; the phone's filter row ends with them, after a divider and before
Clear. Stop All, with the running count, sits in the desktop dock and in the
phone's running menu.

### Keyboard & visual viewport

`useKeyboardInset` publishes `--kb-inset`, `--vv-height` and `--vv-top` and
toggles `.kb-open` on `html`. While the keyboard is up, sheets size and place
themselves in the visual viewport (`--vv-height`), drop their home-indicator
padding, and the page returns to where it rested once the keyboard closes.

**Focused text:** while a long text field (Prompt, Negative Prompt, the
profile JSON in Settings) has the focus and the on-screen keyboard is up, it
is the only thing on screen (`useTextFocus.ts`). Prompt and Negative keep the
normal prompt box (its border, corners and fill): its top lines up with the
Create sheet's top, and it fills the visible width less a margin and the
height down to just above the keyboard, on the solid panel. The other Create
rows, the footer, the handle and the page's bars hide, and nothing scrolls
under it. Its actions (Select All, History, Clear) sit in a row along the
box's top right with a small **Done** at the end, and the text runs the box's
full width under them, never squeezed beside them; a tap on one keeps the
keyboard up. Done, a blur, Back or hiding the
keyboard puts the sheet back; a hardware keyboard leaves the layout alone.
The caret stays in view.

## Labels

- Title Case for headings, labels, actions, menu items, tooltips and
  accessible names, with `&` instead of "And";
  sentence case for explanations. Australian English ("Favourite",
  "Catalogue", "Colour").
- Standard words: Images/Videos (gallery modes), Image/Video (generation),
  Model, Prompt, Negative Prompt, Reference Image, LoRAs, Animate, Star.
- Item actions: "Recreate", "Copy", "Retry";
  the Library's "Use Prompt" and "Use Settings".
- Chat and links name results "Result N".
- Messages: "Couldn’t …" for failures, without a full stop; "Prompt copied".


## Comparisons

The variant comparison interface is hidden for now. Keep existing comparison
records and account-owned API behaviour intact until the interface returns.
The separate upscale/original comparison remains available.
