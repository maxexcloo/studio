# UI Patterns

Studio has one responsive React interface. Compose recurring layouts and interactions from one shared component with data
and purposeful props across pages and breakpoints; update that owner instead
of copying a separate page or phone implementation. Use Mantine for standard controls,
forms, dialogs, drawers, menus, notifications and focus management. Purposeful
media tools such as masking, zoom, comparison and virtualised media layouts may
use custom components. Do not add another primitive or styling framework.
Use [Mantine’s LLM documentation index](https://mantine.dev/llms.txt) as the
primary component reference and verify APIs against the installed version.

## Theme & Layout

- `frontend/src/theme.ts` owns the MantineHub Shadcn-inspired theme, shared radii,
  spacing, motion and workspace width. Follow the system colour scheme by
  default. The header Theme popover owns persisted Animations, Background, Colour,
  Colour Scheme, Corners and Layout controls in that order; Settings does not duplicate appearance controls.
- Use Mantine spacing, typography, colours and breakpoints, including custom
  media CSS. Give Paper padding and borders explicitly where needed; do not
  apply global Paper defaults that leak into dialogs and navigation.
- Primary modes are Chat, Images and Videos in that order; Images is the
  landing page at `/images`; videos use `/video` and conversation uses
  `/chat` and `/chat/:id`. `/` redirects to Images. Phone tabs use MessageCircle, Image and Video icons with
  accessible names and tooltips. The left status action opens sessions in Chat
  and active work in gallery modes. Its slideout keeps the compact service
  summary at the bottom and contextual content above it. The icon reflects the
  current interface using actual gateway/worker health; cloud configuration
  alone is not proof of availability. The phone overflow orders Account,
  Library, Settings, Theme, a divider, the account name and supported Sign
  Out. Desktop Settings is followed by Theme and the account icon; Studio remains
  leftmost and the header follows the workspace width. One red, green or yellow
  status dot sits immediately before Library on desktop. Click opens a flat runtime panel with an endpoint selector and actual status for
  each service type; Settings reuses its full version. Partial readiness is yellow.
  Readiness comes from actual text/media endpoints, with unknown placement
  shown honestly. Queue sits before Studio and opens an anchored popover. The
  account menu shows the actual name, Account and supported Sign Out.
- Full/Fixed controls the workspace. Chat has a structural desktop sessions
  sidebar, flush below the header through the viewport bottom, with a distinct
  neutral surface and divider. Phones use a session Drawer. The Chat composer
  stays centred in its main pane and capped at the same `--studio-composer-width` as the gallery composer in
  both layout modes; Full does not impose a separate conversation width.
- Library and Settings are route-backed Mantine modals with blurred overlays.
  Keep the same bounded dimensions and title typography across both workspaces,
  with scrolling inside the stable modal body. Use shared `WorkspaceSections`: NavLink navigation on desktop and a compact
  Section Select in the phone modal header. Mount sections on first visit and
  keep visited forms mounted to preserve edits. Use Mantine Table for dense records; preview cards are for
  visual content. Account authentication follows the standard Mantine form
  layout, retaining local and OIDC sign-in.
- Nested Select/MultiSelect dropdowns stay inside their owning Mantine Popover
  with `comboboxProps.withinPortal: false`; choosing an option must preserve the
  parent controls and keyboard focus.
- Use shared `EmptyState` for centred, subdued welcome/empty copy without a
  decorative card or redundant creation button. Use the exact empty copy
  No Images, No Videos, No Chats in an empty sidebar, No Chat Selected in
  the unselected conversation area, and Empty Queue. Shared `LoadingState` centres
  loading within the content area while the shell and navigation stay mounted.
  Loading and failure remain distinct states.

## Generation & Conversation

- Gallery modes keep one compact bottom prompt row with reference thumbnails,
  generation-input action and icon-only Generate. Expanded controls show the
  labelled Generate action. Clicking inside expands; clicking outside collapses.
  Nested Mantine pickers belong to the active composer. Do not add custom
  collapse controls. Phones open a full-height Drawer upward with a short
  transition and the standard accessible close action.
- The Chat composer is one quiet inline row: compact reference picker,
  growing writing area, compact actual text model/provider selector and one
  Send/Stop action. Media settings belong
  to timeline input cards, never a second mode in the bottom Chat composer.
  Header status owns connection information; keep it out of the conversation.
- Render assistant Markdown semantically with the shared safe renderer, using
  Mantine typography. Defer parsing streamed changes and keep scroll anchored
  only while the user remains at the bottom.
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
  comes first; `GenerationInputControls` owns the wrapping
  Profile, Size and Reference rail in both gallery and timeline editors. Controls
  share the standard input height; phones give Profile its own row. The footer
  places the Image/Video toggle left and Clear/Generate right. Size uses
  a vertical list of profile-provided aspect presets with their resolution,
  alongside constrained custom dimensions. Selected
  LoRAs retain enable, weight and drag/keyboard ordering controls even when
  catalogue filters hide them; suggested strength ranges remain visible hints.
  Saved LoRA stacks reuse the account-owned library and preserve exact family
  keys, order, strengths and disabled entries; legacy profile groups remain explicit.
  Prompt history uses native Combobox keyboard selection alongside pin/forget controls.

## Data & Feedback

- TanStack Query owns server data, polling and invalidation; drafts stay within
  their feature. Chat and gallery generation drafts are independent; switching
  modes preserves unsent prompts, references and settings. Typing must not rerender an unchanged gallery or conversation
  history; shared provider commands retain their identity. Keep account data
  and credentials out of browser storage.
- Account access groups own model grants and Cloud Models/NSFW permissions.
  Read back saved changes. Studio owns editable runtime definitions, with
  administrator approval and conflict handling; user presets support updates and copies.
- Preserve actual model/provider metadata. Wait for the selected backend unless
  the user explicitly permits fallback. Show truthful queue states and reasons.
- The status panel shows compact active rows with a muted spinner and Cancel;
  completed/cancelled work leaves the list, failed work retains Retry. Cancel
  All requests cancellation of owned active jobs; accepted work may remain
  active until the provider confirms cancellation or outputs are safely saved.
- Gallery search expands into a full-width focused input; Escape closes it
  while preserving the query. Supported filters use icon-triggered Mantine
  popovers with scrollable controls. Normal, search, filters and selection
  modes use the same toolbar region. Search/filter actions preserve queries.
  Shared `SearchInput` clears only the query, never a selected model/profile.
  Queue access has one owner: the header.
- Use notifications for action outcomes and inline alerts for failed forms or
  views. Avoid duplicate error surfaces. Use Title Case for headings, labels
  and actions, and Australian English for explanatory prose.

## Media, Motion & Accessibility

- Viewers always fill the viewport independently of workspace width. Transparent
  stage/content reveal the blurred gallery behind. Empty-stage clicks close;
  media, native video controls and details/actions remain interactive. Keep
  focus trapping, Escape and return focus. Image zoom and bottom details are
  domain behaviour; retain the common generation actions and full settings.
  Mask editing uses the installed zoom/pan library with Paint, Erase and Hand;
  zoom and panning preserve mask pixels and undo history.
- Viewer actions share one bottom area with consistent 36px controls; secondary
  actions use More Viewer Actions and display/sharing switches use Viewer Options.
  Keep the current decoded image visible while another saved version loads,
  then refit its new dimensions before painting.
  Image viewing and original/upscale comparison share `MediaZoom` for named
  zoom modes, native transforms, keyboard shortcuts and transient controls.
- Display, thumbnails, copy, sharing and downloads use the saved original/upscale
  choice through `mediaSource`. Video upscales stay videos; comparison is an
  image action. Upscale quality, size and optional face detail use the worker’s
  reported capabilities and the durable queue.
- Reserve media dimensions, virtualise large galleries, lazy-load images and
  avoid autoplaying gallery videos. Closing a viewer releases its player;
  hiding the tab pauses playback. Heavy tools load only when opened. Near-bottom
  paging preserves loaded results and exposes a retry after failure. Closing
  after viewer navigation reveals and focuses the current gallery item.
- Tiles share one Mantine actions menu for More and context clicks. Desktop
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
- Prefer transform/opacity for interaction motion, no decorative hover movement
  or layout animation in hot paths. Respect reduced motion in CSS and Mantine
  transitions. Persist Off/Fast/Standard/Relaxed through one motion token; reduced
  motion takes precedence. Desktop composer expansion uses a bottom-anchored
  transform/opacity transition. Background previews use labelled, contrasting
  swatches and preserve readable elevated surfaces in both schemes.
  Disable native pressed translation centrally with Mantine’s
  `activeClassName`; retain colour and focus feedback. Aim for smooth 120Hz interaction; report measured environment
  and frame intervals rather than claiming hardware-independent frame rates.
- Browser tests cover meaningful desktop, Chromium phone and WebKit phone
  flows using accessible roles and event-driven fixtures. Avoid exact animation
  timing and cosmetic-only tests. Fixtures are never production fallbacks.
