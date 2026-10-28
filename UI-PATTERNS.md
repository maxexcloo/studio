# UI Patterns

Studio has one responsive React interface. Compose recurring layouts and interactions from one shared component with data
and purposeful props across pages and breakpoints; update that owner instead
of copying a separate page or phone implementation. Use Mantine for standard controls,
forms, dialogs, drawers, menus, notifications and focus management. Purposeful
media tools such as masking, zoom, comparison and virtualised media layouts may
use custom components. Do not add another primitive or styling framework.
Use [Mantine’s LLM documentation index](https://mantine.dev/llms.txt) as the
primary component reference and verify APIs against the installed version.

## Code Structure

- `frontend/src/features/<area>/` owns each area's components, hooks and server
  access; `features/shell/` owns the header, status, queue entry and mode tabs.
  `ui/` holds feature-independent primitives only and never imports features.
- Each server resource has one exported TanStack `queryOptions` (key, fetcher
  and response type) beside its owner; consumers import it rather than
  redeclaring keys or types. Shared types have one owner (`types.ts` or `shared/`).
- Derive repeated checks once: `useIsAdmin()`, `usePhone()` from the theme
  breakpoints, a single submit label and blocked reason per editor.
- Failed forms render their mutation error inline; other action failures use the
  `MutationCache` default notification. Do not add per-call duplicate surfaces.
- Recurring UI has one owner: `GenerationEditor` for gallery and timeline
  editing, one item-actions list for every media surface, `ConfirmDialog`,
  `DataTable`, `EmptyState`, `LoadingState`, `StudioLogo` and `copyText`.
- Style with Mantine props and theme `extend` defaults first; component-specific
  CSS lives in a co-located CSS module and shared tokens in `theme.ts`. Avoid
  global class rules and per-call sizes that the theme should own.
- Browser specs are organised by topic with shared mocks in `fixtures.ts`;
  `workflows.spec.ts` holds only cross-feature journeys.

## Theme & Layout

- `frontend/src/theme.ts` owns the MantineHub Shadcn-inspired theme, shared radii,
  spacing, motion and workspace width. It is one self-contained module, shaped to
  become a shared package for other apps: tokens and component defaults only, no
  app-specific CSS. Translucent blurred ("glass") surfaces apply throughout
  (header, sidebars, cards, overlays, viewer chrome, composer) through theme
  defaults, with readable contrast over media. Follow the system colour scheme by
  default. The header Theme popover owns persisted Animations, Background, Colour,
  Colour Scheme, Corners and Layout controls in that order; Settings does not duplicate appearance controls.
- Controls follow one size and emphasis scale from the `theme.ts` defaults.
  Standard: Button and inputs `md`, ActionIcon 36 px, SegmentedControl `sm`.
  Compact surfaces (list rows, toolbars, chip rails, popover forms) step down
  one tier: Button `compact-sm`, inputs and SegmentedControl `xs`/`sm`, Badge
  `xs`/`sm`. Emphasis: one filled primary action per view, `default` for
  secondary actions, `subtle` for row and toolbar actions, `light` status
  Badges and filled count dots. Set a per-call size only to step down a tier, never to restate a default.
- Use Mantine spacing, typography, colours and breakpoints, including custom
  media CSS. Give Paper padding and borders explicitly where needed; do not
  apply global Paper defaults that leak into dialogs and navigation.
- Primary modes are Chat, Dream, Images and Videos in that order; Images is the
  landing page at `/images`; videos use `/video`, conversation uses
  `/chat` and `/chat/:id`, and Dream uses `/dream`. Call conversations Chat everywhere
  (New Chat, No Chats), never Session. `/` redirects to Images. Phone tabs use MessageCircle, Sparkles, Image and Video icons with
  accessible names and tooltips. The selected mode's pill slides between items (`FloatingIndicator`). On every breakpoint one status action sits
  right of the Studio logo: a spinner while work is generating, otherwise an
  icon coloured by actual gateway/worker health (partial readiness is yellow;
  cloud configuration alone is not proof of availability). It opens the same
  slideout everywhere: Chats in Chat, active and failed generations with Stop,
  Retry and Clear in gallery modes, and the compact service summary at the bottom.
  Endpoint selection and full runtime controls live in Settings › Workers, not
  in the header. Readiness comes from actual text/media endpoints, with unknown
  placement shown honestly. The phone overflow orders Account, Library,
  Settings, Theme, a divider, the account name and supported Sign Out. Desktop
  Library and Settings are followed by Theme and the account icon; the header
  follows the workspace width. The account menu shows the actual name,
  Account and supported Sign Out.
- Full/Fixed controls the workspace. Chat has a structural desktop sessions
  sidebar, flush below the header through the viewport bottom, with a distinct
  neutral surface and divider. Phones use a session Drawer. The Chat composer
  stays centred in its main pane and capped at the same `--studio-composer-width` as the gallery composer in
  both layout modes; Full does not impose a separate conversation width.
- Dialogs are centred on a raised plane from the theme defaults: a dimmed,
  blurred backdrop, a clear border and a deep shadow, `lg` by default and `md`
  for `ConfirmDialog`. Full-screen dialogs (the viewer, phone panels) fill the
  viewport instead.
- Library and Settings are route-backed Mantine modals with blurred overlays.
  Keep the same bounded dimensions and title typography across both workspaces,
  with scrolling inside the stable modal body. Use shared `WorkspaceSections`: NavLink navigation on desktop and a compact
  Section Select in the phone modal header. Mount sections on first visit and
  keep visited forms mounted to preserve edits. Navigation items carry an icon;
  each section shows its heading and one-line description, segmented views,
  an expanding search and filters in one popover above compact rows with status
  badges and row menus. Dense records use the shared `DataTable` on Mantine Table
  (sortable headers, the toolbar query, one empty line, loading and the row menu;
  phones drop secondary columns into the main cell); preview cards are for visual
  content. Account authentication follows the standard Mantine form
  layout, retaining local and OIDC sign-in.
- A click outside an open popover, menu or dropdown only closes it; nothing
  beneath reacts until no popup is open. `ui/popupClicks.ts` owns this for every
  Mantine dropdown (marked `data-popup` by the theme); outside-click handlers
  check `closingPopup()` and match popup layers with `popupLayer`. A trigger's
  Tooltip wraps `Popover.Target`/`Menu.Target`, so the trigger itself carries
  `aria-expanded` and pressing it still toggles the popup.
- Nested Select/MultiSelect dropdowns stay inside their owning Mantine Popover
  with `comboboxProps.withinPortal: false`; choosing an option must preserve the
  parent controls and keyboard focus.
- Use shared `EmptyState` for empty views: one short, centred, subdued Title
  Case line with no title, explanation or decorative card, and at most the one
  action that fills the view (Turn On, Resume, New Chat on phones). Use the exact empty copy
  No Images, No Videos, No Chats in an empty sidebar, No Chat Selected in
  the unselected conversation area, and Empty Queue. Shared `LoadingState` centres
  loading within the content area while the shell and navigation stay mounted.
  Loading and failure remain distinct states.

## Generation & Conversation

- Gallery modes keep one compact bottom prompt row with reference thumbnails,
  generation-input action and icon-only Generate. Expanded controls are one prompt
  box with a history action inside it and a row of compact chips: Profile,
  Reference Role (once references are placed), References, LoRAs, Aspect, Count,
  a set Seed (clearable), Expert settings, Compare and Presets, then
  Image/Video and Generate. References, LoRAs and Presets share one picker
  (`Picker.tsx`): tabs, inline search and a filter toggle on one row; a
  selected tile fades with a check and a second click removes it; saved stacks
  and presets sort, rename, update and delete, and ask before replacing the
  draft; Save sits at the footer's start and Clear at its end. No section labels or accordions. Clicking inside expands; clicking outside collapses.
  Nested Mantine pickers belong to the active composer. Do not add custom
  collapse controls. Phones open a full-height Drawer upward with a short
  transition and the standard accessible close action.
- Keep expanded generation actions reachable while fields scroll. Desktop
  panels bound the fields above their action row; the phone Drawer owns scrolling
  with a sticky action row at the safe bottom. Avoid nested form scroll owners.
- The Chat composer is one quiet inline row: compact reference picker,
  growing writing area, compact actual text model/provider selector and one
  Send/Stop action. Media settings belong
  to timeline input cards, never a second mode in the bottom Chat composer.
  Header status owns connection information; keep it out of the conversation.
- Render assistant Markdown semantically with the shared safe renderer, using
  Mantine typography. Defer parsing streamed changes and keep scroll anchored
  only while the user remains at the bottom.
- Generation cards are compact: prompt, setting chips, results grid and the
  shared actions. Edit expands the shared editor inline; submitting an edited card
  appends a new iteration at the bottom. Chats can be renamed and deleted; new
  chats get a short LLM title. Deleting a chat offers an unticked per-result
  checklist of media to delete as well.
- Chat retains streamed text, generation snapshots and results chronologically.
  Assistant text appears above each input card and results below it. Discussion
  stays text-only; explicit media requests use selected settings without model
  fallback or an extra confirmation. Refine/Animate stage a new timeline card.
- Editing and submitting an old card sends a structured Chat revision with its
  source job and full normalised input. The assistant sees the changed prompt,
  references, settings and LoRAs; successful admission creates a new iteration
  while leaving the original intact. Keep card forms independent of the shared
  gallery draft. Do not bypass the assistant with a direct queue request.
- Profile selection is one searchable Mantine selector grouped by readable family
  names such as Flux 2. Each option is a complete profile; preserve exact profile IDs.
  LoRAs follow Family → catalogue Type; unknown types remain unclassified.
- References share a Gallery & Upload picker. Gallery drag-and-drop passes an
  owned item identifier, never arbitrary media URLs or shared worker history.
  Preserve intentional reference order and source-result lineage across edits.
  Explicit slot IDs survive reordering; optional End-only inputs and one asset
  used in several roles must work. Group linked `follows` slots of the same role
  into one picker choice, filling their declared capacity without a global reference
  limit. A custom workflow's filename mapping accepts one image; use separate mapped
  inputs for multiple references. Display numbered thumbnails and profile roles,
  never filenames; submission and Chat use owned asset IDs. Phones show the shared filtered gallery
  inside generation controls, desktop uses an anchored popover.
- Profile and size controls share the gallery/card implementation. The prompt
  comes first; `GenerationInputControls` owns the wrapping chip rail in both
  gallery and timeline editors. Phones keep the full-height editor, giving the
  prompt generous, easy-to-edit space above the chips. The footer
  places the Image/Video toggle left and Clear/Generate right. Size uses
  a vertical list of profile-provided aspect presets with their resolution,
  alongside constrained custom dimensions. Selected
  LoRAs retain enable, weight and drag/keyboard ordering controls even when
  catalogue filters hide them; suggested strength ranges remain visible hints.
  Saved LoRA stacks reuse the account-owned library and preserve exact family
  keys, order, strengths and disabled entries; legacy profile groups remain explicit.
  Trigger words use copy controls and source links use the published catalogue URL.
  Each stacked LoRA has a Trigger Words toggle (on by default); Studio inserts
  enabled LoRAs' trigger words at the start of the prompt in stack order, on
  every generation path.
  Prompt history uses native Combobox keyboard selection alongside pin/forget controls.

## Dream & Taste

- Dream is a full-screen card deck of background results. Swipe left discards,
  right keeps, up keeps and queues variations; Star and Animate are buttons
  that keep the result too. Dream results stay in their own pool until kept;
  every discard is kept and can be shown with a filter.
- Dream generates images, videos and (with Uncensored Models) spicy content only
  while no other work is queued, yields to user and text work, and stops at its
  unseen buffer or daily cap.
- Dream also mixes in random older gallery items, as single cards and
  occasional this-or-that pairs, to calibrate taste without using the GPU;
  judging them never alters the gallery beyond an optional Star.
- An editable, LLM-maintained taste profile learns from swipes, stars,
  iterations, prompts and LoRAs. It informs Dream, composer prompt ideas,
  viewer next-step suggestions and Chat.
- Suggestions never move the layout or act on their own: prompt ideas float
  over an empty, focused prompt and fill it (in Chat as "Create an image: …");
  viewer next steps hold their row with placeholder chips while loading, written
  ahead of time while Studio is idle; a step puts its prompt in the prompt bar
  and generates it, showing progress on the chip, and a small refresh action
  asks for different ones. With none to offer, nothing shows.

## Data & Feedback

- TanStack Query owns server data, polling and invalidation; drafts stay within
  their feature. Chat and gallery generation drafts are independent; switching
  modes preserves unsent prompts, references and settings. Typing must not rerender an unchanged gallery or conversation
  history; shared provider commands retain their identity. Keep account data
  and credentials out of browser storage.
- Account access groups own model grants and Cloud Models/uncensored permissions.
  Read back saved changes. Studio owns editable runtime definitions, with
  administrator approval and conflict handling; user presets support updates and copies.
- Preserve actual model/provider metadata. Wait for the selected backend unless
  the user explicitly permits fallback. Animate is the exception: without a
  chosen profile it takes the shared backend pick (local video while it runs,
  otherwise granted Grok) and shows that model, and any note, before queuing. Show truthful queue states and reasons.
  A prompt the assistant writes for a generation is the queue item's Writing Prompt stage, queued
  in one click without a review pause: its thinking and prompt stream in the item, and Details keeps
  the thinking collapsed under the prompt.
- The status panel shows compact active rows with a muted spinner and Stop;
  completed/cancelled work leaves the list, failed work retains Retry and Clear.
  Stop All and Clear Failed use `ConfirmDialog`. Stop All requests cancellation
  of owned active jobs; accepted work may remain active until the provider
  confirms cancellation or outputs are safely saved. Clearing only takes failed
  jobs out of the queue; their records and chat cards stay.
- Retry actions share the owned queue command. Bulk retry deduplicates job IDs
  and keeps unsuccessful items selected, preserving unrelated selections.
- The gallery toolbar keeps its search box in the row on desktop; phones expand
  it from an icon into a full-width focused input, and Escape closes it while
  preserving the query. Filter and Select are compact chips at the row's end
  (icons on phones); Filter swaps the leading controls for a row of facet chips,
  each opening a scrollable Mantine popover, beside the search box on desktop.
  Search narrows within the active filters, which show beside the search as
  removable chips. Normal, search, filters and selection modes use the same
  toolbar region. Search/filter actions preserve queries.
  Shared `SearchInput` clears only the query, never a selected model/profile.
  Queue access has one owner: the header status action.
- Use notifications for action outcomes and inline alerts for failed forms or
  views. Generation is the exception: submitting and completing show in the
  gallery, strip or card, never as toasts. Avoid duplicate error surfaces. Use Title Case for headings, labels
  and actions, and Australian English for explanatory prose.

## Media, Motion & Accessibility

- The viewer is the iteration hub. Under the image, its prompt bar is the
  composer collapsed (the same `ComposerDock`, in its own draft that never
  touches the page's), prefilled with the item's settings; clicking it expands
  in place over the open viewer with the prompt focused, and a click outside it
  only folds it back to the bar. Its runs queue as usual
  into a strip of the item's versions, grouped as the grid groups them
  (`gallery/versions.ts`); choosing one makes it current. Its action bar is the
  shared item actions, sized to them; Animate opens its LLM prompt menu
  (Cinematic Camera, Living Photo, Action, Spicy for accounts with Uncensored
  Models, Custom Animation, Animate in Composer) and Upscale its settings with
  Show Upscale and Compare Upscale. Details lists
  every input in run order with Copy Prompt and Copy Settings beside its title;
  prompts sit on a subtle surface aligned with the column and scroll within a
  bounded height. The desktop details sidebar is open by
  default and its toggle is remembered. Phones show the image full-bleed with
  an icon row and prompt bar; swipe left/right navigates, down closes and up
  reveals details and further options. Running, failed and cancelled work opens
  too, in the gallery and in Chat: the stage shows its status (streaming the
  prompt while it is written) and Details its prompt; once saved, the viewer
  follows it to the result (`currentMedia`).
- Images and Videos offer Grid and Runs views. Runs shows each run as a stacked
  card that fans out in place; its images open the viewer hub. Grid shows a
  result and its versions (runs made from it: Edit, Recreate, New Seed and the
  like, linked by `parentJobId` and `parentItemId`) as one tile showing the latest,
  with a version count; crossing it with the pointer, or a sideways swipe on
  phones, flips through them. The All Versions filter chip lists them
  separately. `versions.ts` owns the grouping for every consumer.
- Viewers always fill the viewport independently of workspace width. Transparent
  stage/content reveal the blurred gallery behind. Empty-stage clicks close,
  including just outside the image; a near-miss within an invisible margin
  around the viewer's controls does not. Media, native video controls and
  details/actions remain interactive. Images open fitted but never beyond
  their actual size, showing the gallery thumbnail until the full image has
  loaded. Opened videos play, muted when the browser refuses sound. Keep
  focus trapping, Escape and return focus. Image zoom and bottom details are
  domain behaviour; retain the common generation actions and full settings.
  Mask editing uses the installed zoom/pan library with Paint, Erase and Hand;
  zoom and panning preserve mask pixels and undo history.
- Item actions have one definition (`gallery/MediaActions.tsx`): Animate, Edit,
  Recreate ▾, Reference | Compare, Upscale | Copy ▾, Download | Delete, Star,
  alphabetical within each section, in every menu and action bar. Options are
  submenus in menus and split buttons or menus in bars: Animate › themes,
  Custom Animation, Animate in Composer (Extend for videos); Recreate › In
  Composer, New Seed, Exact Repeat; Upscale › Show Upscale, Compare Upscale;
  Copy (Details by default) › Details, Prompt. Phones that share natively show
  Share Image in Download's place; desktop has no Share. The viewer and gallery
  selection share one `ActionBarGroups` bar of divided groups that scrolls
  sideways when it overflows. The selection bar labels its buttons on desktop, greys out
  actions for one item at a time and ends with Close.
  Keep the current decoded image visible while another saved version loads,
  then refit its new dimensions before painting.
  Image viewing and original/upscale comparison share `MediaZoom` for named
  zoom modes, native transforms, keyboard shortcuts and transient controls.
- Display, thumbnails, sharing and downloads use the saved original/upscale
  choice through `mediaSource`. Video upscales stay videos; comparison is an
  image action. Upscale quality, size and optional face detail use the worker’s
  reported capabilities and the durable queue.
- Reserve media dimensions, virtualise large galleries, lazy-load images and
  avoid autoplaying gallery tile videos. Closing a viewer releases its player;
  hiding the tab pauses playback. Heavy tools load only when opened. Near-bottom
  paging preserves loaded results and exposes a retry after failure. Closing
  after viewer navigation reveals and focuses the current gallery item.
- Tiles share one Mantine actions menu for More and context clicks; Star and
  Download also sit on the tile. Desktop
  reveals quick controls on hover/focus; phones keep More visible and show a
  persistent star for favourites. Selection replaces these controls.
- Use semantic buttons/links and accessible names for icons. Preserve drafts
  and keyboard focus through expansion. Honour the phone keyboard and safe
  areas. Failed images must not expose broken-image icons.
- The shared gallery toolbar opens search with `/` or Ctrl/Cmd+F only in its
  active surface, without capturing typing, composition or another overlay.
  Viewer F toggles Star and Delete opens the standard confirmation, including
  single-item viewers. Phone hold-to-select uses Mantine's touch gesture with
  movement cancellation; its release must not also open the viewer.
- Every interaction should feel fluid and intuitive: state changes (opening,
  expanding, fanning out run stacks, swiping cards, variations arriving, chips
  updating) use short, subtle shared-token transitions rather than jumps, and
  never shift layout unexpectedly or block input. Treat visible jank, flashes
  of empty content and layout jumps as defects.
- `theme.ts` owns one motion system: the duration token (`--studio-motion-duration`,
  Off/Fast/Standard/Relaxed, 160ms by default, 0 under reduced motion), quicker
  exits (`--studio-motion-exit`) and ease-out entrances without bounce or overshoot
  (`--studio-ease-enter`, `--studio-ease-exit`; `easing` in code). Mantine popups,
  menus and modals grow from scale 0.98 on their trigger side; drawers slide;
  selection indicators slide between items. Items appearing move a few pixels or
  scale from 0.98 at most. Motion makes a change continuous and never adds a wait
  before content: switching pages, tabs and sections is instant, without fades.
- Animate only transform and opacity (Mantine's sliding indicators also size
  themselves); no decorative hover movement or layout animation in hot paths.
  Respect reduced motion in CSS and Mantine transitions. Desktop composer
  expansion uses a bottom-anchored transform/opacity transition. Background
  previews use labelled, contrasting swatches and preserve readable elevated
  surfaces in both schemes. Disable native pressed translation centrally with
  Mantine’s `activeClassName`; retain colour and focus feedback. Aim for smooth
  120Hz interaction; report measured environment and frame intervals rather than
  claiming hardware-independent frame rates.
- Browser tests cover meaningful desktop, Chromium phone and WebKit phone
  flows using accessible roles and event-driven fixtures. Avoid exact animation
  timing and cosmetic-only tests. Fixtures are never production fallbacks.
