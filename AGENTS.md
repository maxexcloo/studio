# Project Guidance

## Ownership

- This is Studio, a hard fork of HEISS UI. It no longer syncs upstream: Studio owns all of its code and may restructure any of it, including the core (model and family detection, graphs, composer, gallery, viewer).
- User-facing text, documentation, settings (`STUDIO_*`), headers, cookies, browser storage and internal identifiers say Studio. Every Studio setting starts with `STUDIO_` and old names are not read as aliases; third-party credentials keep their standard names (`HF_TOKEN`, `CIVITAI_API_TOKEN`), as do the platform's `HOST` and `PORT` and the worker's `RADIANCE_*` variables.
- Text written for generation models (prompts and the styles, themes and guides that shape them) uses American English, as `americanEnglish` in `backend/domain/writing-standard.ts` tells every prompt writer; everything else stays Australian English.
- Runtime state is authoritative. Studio reads and writes only Studio names on disk (`studio` media folder, the `studio` profile block); no legacy names or fallbacks. Runtime files are moved or renamed only by `migrate-runtime` ([Data & Migrations](CONFIGURATION.md#data--migrations)), never implicitly.
- Keep externally used names stable: MCP tool names (lowercase snake_case with lowercase titles, such as `generate` and `upload_link`), `/api` routes, the profile file format and result links, including the `heiss-mcp-result-link-v2` sealing label.
- Studio owns live generation profiles, prompting guides and model/LoRA catalogue definitions in its runtime data folder, including uncensored content. Administrators edit and approve them in Studio. Live data is the only source: the sample profiles in `config/profiles/` seed only a data folder that has never held a profile. Keep deployment/workload configuration in kubelab.
- The whole repository is AGPL-3.0 (`LICENSE`). Keep the MIT notices for HEISS UI, J-AI Studio and MantineHub in `NOTICE`, shipped in both images, and their credits in Settings › About and `README.md`.
- Read [UI Patterns](#ui-patterns) before UI work. Keep that section to cross-cutting interaction rules and apply each rule everywhere it occurs.

## Delivery

- The container image on GHCR, built and verified by CI, is the only delivery. There is no `docs/` website, desktop launcher, packaged download, self-updater or release signing; do not add them.
- Studio builds the app and `studio-worker` GPU images. Deployment configuration belongs to kubelab (`apps/base/studio`); Studio controls configured GPU workloads: Radiance on both GPUs is the default placement and switches its own models; while an administrator's placement includes Radiance, waiting ComfyUI-only work swaps its ComfyUI workloads in once Radiance's accepted work and any waiting Radiance work of a higher tier finish, and Radiance returns after two minutes without ComfyUI work. A placement without Radiance in Settings › Workers pauses swapping until Radiance is placed again. After a Radiance load fails because host memory can't be pinned, Studio restarts Radiance once it is idle and runs the failed job once more.
- Every green `main` commit publishes images and deploys through kubelab. CI owns versioning and releases: a `main` commit whose tree a pull request run already verified releases that run's image without rebuilding or retesting it, and Deploy then bumps kubelab's Studio and worker tags in a `studio-release` pull request that merges once Check passes. If Deploy fails or `KUBELAB_TOKEN` is missing, tick the manual-run box on kubelab's Dependency Dashboard (issue 23) so the hosted Renovate app deploys the release instead.
- Open a pull request for large changes. Merge only what is ready for production, including any real-model verification it needs.
- Single-user mode keeps working for local development.
- When coordinating Orca workers here, answer their questions and approvals, close finished workers, and review and merge their PRs, including large ones, without waiting for the user. Product direction, secrets and other people's accounts stay the user's decisions.
- Restore live service (rollout restarts, GPU workload restores, unwedging a runtime change) without asking, back to its previous intended state, then report. GPU workloads may be swapped or parked while testing; restore GPU 1 and GPU 2 afterwards.

## Verification

- Browser specs run only in CI. They cover meaningful desktop, Chromium phone and WebKit phone flows through accessible roles and event-driven fixtures, with shared mocks in `fixtures.ts` and cross-feature journeys in `workflows.spec.ts`. Avoid exact animation timing and cosmetic-only assertions; fixtures never become production fallbacks.
- Keep runtime data out of Git and test output.
- Tests never generate media or call cloud providers. Verify real behaviour on the live deployment, never on a local copy of production data.
- Report measured conditions for performance claims.
- To use live Studio or LibreChat in agent-browser, sign in as the user: run `mise run browser-sign-in` then `agent-browser --session <name> state load <file>` with the file it names (`--state` is ignored on the shared browser). Audits may read other Studio accounts' data, but nothing an agent does may write to, generate in or carry data between accounts.

## UI Patterns

Studio has one responsive React interface. Compose recurring layouts and
interactions from shared components across pages and breakpoints. Use Mantine
for standard controls, forms, dialogs, drawers, menus, notifications and focus
management. Media tools such as masking, zoom, comparison and virtualised media
layouts may use custom components. Do not add another primitive or styling
framework. Use [Mantine’s documentation index](https://mantine.dev/llms.txt) as
the primary component reference and verify APIs against the installed version.
Feature behaviour belongs to its code; this section holds only the rules that
recur across features.

### Code Structure

- `frontend/src/features/<area>/` owns each area's components, hooks and server
  access; `features/shell/` owns navigation and status. `ui/` holds
  feature-independent primitives and never imports features.
- Each server resource has one exported TanStack `queryOptions` beside its
  owner. Consumers import its key, fetcher and response type. Shared types
  belong in `types.ts` or `shared/`.
- TanStack Query owns server data, polling and invalidation; drafts stay within
  their editor. Derive repeated permission, breakpoint and submission checks
  once rather than repeating them in consumers.
- Reuse the shared generation editor, item actions, pickers, tables, setting
  rows, text boxes, confirmation, empty/loading states and clipboard helpers.
- `ui/icons.ts` owns the icons of actions, modes and records by meaning; one
  meaning keeps one icon. Plain glyphs (chevrons, checks, arrows, search,
  close) may come from `lucide-react` directly.
- `theme.ts` owns tokens, component defaults, control densities, breakpoints
  and motion. Use Mantine props and theme defaults before co-located CSS
  modules; avoid global class rules and per-call values that restate defaults.

### Theme & Layout

- Keep the theme independent of app features: tokens and component defaults
  only. Follow the system colour scheme by default. Shared glass surfaces
  must remain readable over media in both schemes.
- Follow the theme's size and emphasis scale. Give each view one filled
  primary action; use secondary and subtle treatments for other actions.
  A per-call size may step down a tier but must not restate a default.
- Use Mantine spacing, typography, colours and breakpoints in custom CSS too.
  Give Paper padding and borders explicitly where needed; avoid defaults that
  leak into dialogs and navigation.
- Preferences follow the account rather than the device, Appearance included;
  the browser keeps a copy of Appearance only for the moments before sign-in.
  Appearance controls live in the header's Appearance popover.
- Library and Settings use the shared route-backed modal and
  `WorkspaceSections` navigation, with scrolling inside a stable body. Mount
  sections on first visit, preserve visited forms and edits, and render a
  section failure inline without taking down the workspace.
- Use one section heading and toolbar; group further parts with `SettingGroup`.
  Use compact `DataTable` rows for dense records and cards for visual content.
  Phone tables fold secondary information into the main cell. Use headings
  rather than accordions, and popups to create or configure records.
- Settings use `SettingGroup` and `SettingRow`. Switches apply on/off settings
  immediately and optimistically, rolling back or refetching after failure;
  checkboxes select records or form options. Number fields commit on blur or
  Enter. Free text, passwords and record editing use a dialog with Save.
  Selects and segmented choices sit in `wide` rows (segmented ones
  `fullWidth`): one width on desktop, the full row under the label on phones,
  where a picker and its row's buttons share that row, the picker filling it.
  Profile and model choices use the composer's picker (`ProfileSelect`) as a
  field. A row's actions are plain compact buttons named by their verb, never
  a dropdown.
- Every dialog, sheet and chip popup ends with one right-aligned
  `DialogFooter` of real buttons: any default secondary actions, Cancel, then
  one filled primary, which follows the secondaries alone (Done, Close) where
  there is nothing to cancel. An action that adds content (Add, Upload) is the
  footer's `leading` action instead, alone at its left edge. A footer stays on
  one row, phones included: there two or more secondaries fold into one ⋯
  menu. An anchored chip popup (desktop, or `floating`)
  whose only button would be Done has no footer and closes on outside click
  or Escape; phone sheets keep Done. A primary is its bare verb (Save,
  Compare, Create), adding a noun only where the verb alone is ambiguous. Clearing a
  form or popup is the shared `ClearButton` ✕ immediately before the primary,
  as in the composer's Generate row, never a text action in a heading; no
  other action sits beside or below the primary. Consequential actions sit in
  a final Danger Zone or row menu and use `ConfirmDialog`, titled with the
  action and no question mark.
- Choose controls by selection semantics: a SegmentedControl or radio group
  selects exactly one choice, a Switch changes one setting, and toggle chips
  or MultiSelect combine options. All and Any are choices, not deselection.
- Empty views use `EmptyState`: one short, subdued line and at most the action
  that fills the view. `LoadingState` centres within the content while the
  shell stays mounted. Empty, loading and failure remain distinct states.
  Loading greys a control out (`disabled`) rather than spinning or changing its
  text. Popups and dialogs share a minimum height, with empty text centred.

### Actions & Menus

- Search clears only its query; filters preserve it. Toolbars show search as a
  field when there is room, otherwise open it from an icon. A Library or Settings list's Filter
  popover shows each filter's choices inline as chips (`FilterChoices`), All
  first, never a dropdown; its sections sort alphabetically.
- Named controls that open a picker or menu show ▾ (Animate ▾, Copy ▾), small
  beside an action bar's icon; ⋯ already means more, so it never carries one.
  Icon-only controls use accessible names and tooltips.
- Every menu has one shape: settings (segmented choices, switches, checked
  options) first, then its choices, then after a divider the action that runs
  or leaves it. Menus group related actions with the usual action first and
  Delete last, and share their sizing and item style. An action's settings sit
  in its menu, not a separate dialog. An option whose label alone is ambiguous
  carries a one-line `description`, except in item action and assistant menus.
- Media categories use Images, Videos, Text, with Cloud after Videos where it
  is their peer. Other unordered peers sort alphabetically, except settings
  first, Like before Dislike, Name A–Z and Name Z–A last in sort menus,
  Refresh and Custom… last and Delete last. Settings and Library pages and
  groups sort A–Z (Settings › Where Work Runs keeps Images, Videos, Dream, Text; About is
  last; Installed leads a view selector it defaults), and rows put settings
  before actions, with the Danger Zone last.
- Labels name the verb alone where the menu or box already says what it acts
  on (Upscale, Share, Clear; not Clear Prompt), adding a word only where the
  verb alone is ambiguous (Stop Upscale, Edit in Composer). One action keeps
  one label everywhere. Clear and Reset turn into Undo until the text next
  changes.
- Item actions are the same, in the same groups and order, on tiles, context
  menus, the viewer and the selection bar. `MediaActions.tsx` owns their availability and
  `itemActions.ts` their labels, icons, groups and order; there is no ⋯ More.
  The context menu shows Discover and Share options in unlabelled sections.
  Desktop menus open options in side submenus on hover or by keyboard.
  Phone menus move into their options and provide Back. Assistant menus share `assistMenu`:
  Suggestions and Templates carry icons and list text-only options as submenus only when both are offered, inline when alone
  (an empty prompt offers only its ideas, inline), with
  Custom… and Refresh at the top level.
  Desktop bars name Retry, Stop and the menus and show the rest as icons;
  phone media item bars use icons with accessible names and menu indicators. When they
  outgrow their row the last names drop, then phones narrow the controls, and
  only then do they wrap, never scrolling. On phones the gallery selection bar
  instead keeps its count, quick selects and actions on one row that scrolls
  sideways.
- Like and Dislike rate an item and teach taste. A Dislike never deletes: it
  hides the item with Undo, and the gallery's Disliked filter shows it again.
  Dream's Accept keeps a result unrated. Super Like accepts and rates it.
- The Dream Deck alone has its own look, as dating apps have it: cards filled
  by their media with the text over the bottom on a dark scrim, large round
  Pass (✕), Super Like (♥) and Accept (✓) buttons, and swipes that tilt the card
  and stamp its answer while the next card waits behind. Its actions sit below
  the card.
  Undo steps back through the session's judgements.
  Dream shows one card per unseen idea, set or comparison. Expand a set to
  inspect its members. A verdict applies to the whole set. Library rates
  existing results. Both use the same Images and Videos selector. The fullscreen
  preview fills the stage above the verdicts and shares the viewer's
  gestures, top chrome, media controls and Details surface. Verdicts in
  fullscreen use the buttons. Passing a Dream result dislikes it and keeps it in
  Discards for reference. Holding Pass
  opens the reason picker: Too Similar and Glitch pass without a rating.
  Comparisons in the deck and fullscreen video
  offer Pass, the lettered choices and Accept. Fullscreen image comparisons
  offer the single-image verdicts. Accept keeps the image shown and Super Like
  also rates it.
  On a set, Deny All dislikes every member. Super Like keeps the set and rates
  the image shown, or the cover when the set is closed. An explicit Like
  or Deny on a member overrides the set verdict for that member.
- A finished selection action ends the selection, keeping selected only the
  items it failed for; opening a menu does not. Quick selects take every
  match, not only loaded pages, and deletion confirms.

### Layers, Focus & Phones

- Suppress iOS edge history swipes once at the document, preserving native control touches and Back navigation. The installed iOS app adds no browser history entries, so its back swipe has nothing to go back to; Studio's own Back still works (`singleEntry.ts`).
- The phone layout covers screens below Mantine's `sm` breakpoint and phones
  held sideways (short touch screens up to 1000 px wide); iPads in landscape
  keep the tablet layout. `ui/usePhone.ts` owns phone detection: components use
  `usePhone()` and `useSideways()`, and CSS the root's `data-phone` attribute
  (`sideways` for a phone held sideways), never their own width queries,
  `visibleFrom` or `hiddenFrom` to tell a phone.
- Outside click and Escape close only the topmost layer; nothing beneath
  reacts. On phones the first outside tap consumes the pointer and click,
  leaving the control beneath for the next tap. A closing layer no longer
  counts while it fades out. In the viewer, Escape first leaves a text box,
  keeping its edit, then closes the docked Details, then the viewer.
  `ui/popupClicks.ts` owns this: custom handlers defer to `layerAbove(owner)`,
  and dialogs that can have another dialog above use `closeWhenTop`.
- A trigger's tooltip is a `PopupTooltip` wrapping `Popover.Target` or
  `Menu.Target`, so the trigger retains `aria-expanded` and toggles its popup
  and the tooltip hides while the popup is open. Nested Select/MultiSelect
  dropdowns stay inside their owning Popover with
  `comboboxProps.withinPortal: false` and preserve focus when selected.
- Shared chip popups (`ChipPopup`) anchor on desktop and open full-screen
  sheets on phones where the content needs the room; small forms stay
  `floating`. Their heading (`PopupHeading`, or the sheet's header beside
  Close) is one row: the title and any count, then any saved record's
  `SavedName` combobox filling the row with its Save and ⋯ menu, then compact
  subtle record actions (Remove). Their footer holds at most one
  leading action that adds content (Add), then Clear and the primary; choices
  apply as made, so the footer ends with Done where there is no other primary.
- On phones, overlays keep their actions at the bottom and always in sight:
  full-screen dialogs and sheets take the page's solid surface and pin their
  `DialogFooter` above the safe area while the content between scrolls, with
  one scroll owner per form. That surface reaches past the screen's edges, so
  the page behind never shows or scrolls, even as the keyboard moves it or iOS
  bounces; the shared theme owns this. On touch screens, popups and option lists open
  with the keyboard down; their search waits for a tap.
- Preserve drafts and focus through expansion. The positive and negative
  prompts share the same borderless layout. Actions staging a gallery draft
  use `useOpenComposer`.
- Use the shared `TextBox`. Fields with tools expose one menu button
  with each tool's options under its name. On desktop, Copy and
  Clear are left to the browser, and a box starting from its own text shows
  Reset, then Undo, as one icon beside it while it can act. The button is ⋯,
  or the AI icon when the box has an AI tool; the AI icon (`icons.assistant`)
  marks prompt assistance. An AI tool with a single option runs it on
  click, named by that option, and is a menu only while a proposal adds
  Undo. The viewer keeps its prompt send beside the text.
  Composer fields edit in place: at rest the phone Generate sheet's prompt,
  and its Negative Prompt when shown, share the room between its heading and
  the chips, which wrap onto as many rows as they need; each box shows only
  its AI menu in its corner, if it has one. Typing shows a Prompt or Negative Prompt heading above the field
  and one action bar: the box's menu,
  Copy and Clear/Reset/Undo as icons, then Done, which returns to the sheet,
  in place of the output, Clear and Generate. There Reset returns
  to the text the box had when typing began. Other phone text boxes open the
  shared full-screen editor, and AI tools stay beside the text before it
  opens. That editor shares the same tools row and keeps its heading and close
  button. The viewer offers Suggestions and Templates beside the prompt and in
  its editor. The tools menu stays
  an anchored menu on phones, fitted to the visual viewport. A box without
  tools has no ⋯, Copy or Clear.
- Respect safe areas and the phone keyboard. The viewport uses
  `interactive-widget=resizes-visual`; only the surface being typed into follows
  the visual viewport through `useKeyboard`, centred dialogs and the floating
  composer included. Keep unrelated layout stationary.
- Use semantic buttons and links with accessible names. Phone actions need
  visible names where their icons alone are ambiguous. Preserve focus trapping,
  Escape and return focus in dialogs and viewers.
- Scope shortcuts to the active surface; do not capture typing, composition or
  another overlay. Right-click, the Menu key and Shift+F10 open the same
  context menu. Holds cancel on movement and their release opens nothing.

### Generation & Media

- Preserve exact profile IDs and account-owned asset IDs. Display readable
  profile, family and reference-role names rather than backend filenames.
  Reference order, explicit slot IDs and source-result lineage survive edits
  and reordering.
- Preserve actual model/provider metadata. Studio routes work to a worker
  itself; there is no worker choice. Trigger words apply when submitting,
  without altering the typed prompt.
- Replacing unsaved work with a preset asks first. Assistant proposals replace
  text in place, leaving the box's look unchanged, with Undo first in its AI
  menu, and show the action and changed words below the field. Suggestions
  never act on their own, and nothing floats over the text. They preload for
  the viewer's and Library review's items and load as other menus open; an
  empty composer prompt's ideas load once the page is idle and again after one
  is picked, so its menu opens ready.
- Report actual endpoint health: configuration alone does not prove readiness.
  A deliberately parked worker reads Stopped, not failing; an unexpectedly
  unavailable one remains a failure. Runtime controls belong in
  Settings › Workers.
- Keep recorded provider work and saving visible. Stop requests cancellation,
  but accepted work may remain active until the provider confirms or results
  are saved. Clear Failed removes queue entries without deleting their
  records.
- The viewer is the iteration hub for finished and unfinished work. Viewers
  fill the viewport, keep the current image visible until the next loads,
  stop navigation at the first and last item, and on closing reveal and focus
  the current tile.
- The gallery viewer fits media between its header and bottom controls.
  Desktop controls float on the viewer backdrop, and phone controls use a
  separate bottom dock. A touch tap cycles through actions, actions with
  thumbnails and media alone. Hiding the chrome gives its space back to
  the media. Swipe up opens Details. In Dream fullscreen a tap or C cycles
  through its chrome, the chrome with the card's text over a scrim, and
  media alone; swipe up opens Details. Both viewers fit media between the header
  and bottom controls by default.
- The gallery defaults to newest first, with a tile per result. Sets and
  versions have separate thumbnail strips in the viewer. Version grouping
  has one owner in `gallery/versions.ts`. Viewing and upscale
  comparison share `MediaZoom`. Display, thumbnails, sharing and downloads
  respect the saved original/upscale choice through `mediaSource`.
- Reserve media dimensions, virtualise large galleries, lazy-load images and
  avoid autoplaying tile videos. Only the Dream Deck's top card plays its
  videos, in step, with sound on by default and the viewer's explicit mute
  choice remembered. A comparison plays audio from only the selected side.
  Dream and the viewer retry silently if sound blocks autoplay. Offer Play if playback still
  needs a tap. Release closed players and pause playback
  when the tab hides. Heavy tools load only when opened. Paging keeps loaded
  results and offers retry on failure.

### Data & Feedback

- Switching modes preserves unsent prompts, references and settings. Use
  `useRemembered` for settled UI state per account, including every setting in
  an action menu, shared by every surface showing that menu; a setting Settings
  also shows is an account preference instead. Do not persist open popups,
  selection or search queries.
- Keep credentials and private account records out of browser storage and
  query caches. A generated password shows once, in the view that issued it;
  an MCP token shows only to its own account, hidden until Show.
- Typing must not rerender unchanged media or history; shared provider
  commands retain their identity.
- Account groups own grants. Runtime definition edits retain administrator
  approval and conflict handling; read back saved changes.
- Failed forms show their mutation error inline. Other failures, including a
  view's background load (`useFailureBanner`), use the `MutationCache` default
  notification; avoid duplicate error surfaces. Alerts are quiet and timed.
- Routine success appears where it happened: a saved row, a copy check or a
  brief action label (`useFlash`), never status text after an action.
  Notifications serve failures, Undo and
  outcomes with nowhere else to show. Action errors and Undo use compact,
  timed banners below the header. Banners can be dismissed with an upward
  swipe. Generation submission
  and completion appear in their gallery or strip as soon as the queue reports
  them.

### Motion

- Use shared motion tokens for short transitions without layout jumps, flashes
  or blocked input. Page, tab and section navigation is immediate; animation
  must not delay content.
- Animate transform and opacity, allowing Mantine indicators to size themselves.
  Avoid decorative hover movement and layout animation in hot paths. Respect
  reduced motion in CSS and Mantine, and retain colour and focus feedback.
