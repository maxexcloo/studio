# Project Guidance

## Ownership

- This is Studio, a hard fork of HEISS UI. It no longer syncs upstream: Studio owns all of its code and may restructure any of it, including the core (model and family detection, graphs, composer, gallery, viewer).
- User-facing text, documentation, settings (`STUDIO_*`), headers, cookies, browser storage and internal identifiers say Studio. Every Studio setting starts with `STUDIO_` and old names are not read as aliases; third-party credentials keep their standard names (`HF_TOKEN`, `CIVITAI_API_TOKEN`).
- Runtime state is authoritative. Studio reads and writes only Studio names on disk (`studio` media folder, `.studio-trash`, the `studio` profile block); no legacy names or fallbacks. Runtime files are moved or renamed only by the explicit migration in `migrate-runtime` (backup, dry run, mapping, `--restore`) or an administrator's run of its steps through `POST /api/maintenance/migrations`, never implicitly.
- Keep externally used names stable: MCP tool names (lowercase snake_case with lowercase titles, such as `generate` and `upload_link`), `/api` routes, the profile file format and result links, including the `heiss-mcp-result-link-v2` sealing label.
- Studio owns live generation profiles, prompting guides and model/LoRA catalogue definitions in its runtime data folder, including uncensored content. Administrators edit and approve them in Studio. Live data is the only source: the sample profiles in `backend/samples/` seed only a data folder that has never held a profile. Keep deployment/workload configuration in kubelab.
- The whole repository is AGPL-3.0 (`LICENSE`). Keep the MIT notices for HEISS UI, J-AI Studio and MantineHub in `NOTICE`, shipped in both images, and their credits in Settings › About and `README.md`.
- Read [UI Patterns](#ui-patterns) before UI work. Keep that section to cross-cutting interaction rules and apply each rule everywhere it occurs.

## Delivery

- The container image on GHCR, built and verified by CI, is the only delivery. There is no `docs/` website, desktop launcher, packaged download, self-updater or release signing; do not add them.
- Studio builds the app and `studio-worker` GPU images. Deployment configuration belongs to kubelab (`apps/base/studio`); Studio controls configured GPU workloads. Automatic lifecycle control stays off by default.
- Every green `main` commit publishes images and deploys through kubelab. CI owns versioning and releases.
- Open a pull request for large changes. Merge only what is ready for production, including any real-model verification it needs.
- Take a ZFS snapshot of Studio's data before merging a change that runs a data migration.
- Single-user mode keeps working for local development.

## Verification

- Retain browser interaction tests in CI.
- Keep runtime data out of Git and test output.
- Tests never generate media or call cloud providers. Verify real behaviour on the live deployment, never on a local copy of production data.
- To use live Studio or LibreChat in agent-browser as the user, run `mise run browser-sign-in` then `agent-browser --session <name> state load <file>` with the file it names (`--state` is ignored on the shared browser).

## UI Patterns

Studio has one responsive React interface. Compose recurring layouts and
interactions from shared components across pages and breakpoints. Use Mantine
for standard controls, forms, dialogs, drawers, menus, notifications and focus
management. Media tools such as masking, zoom, comparison and virtualised media
layouts may use custom components. Do not add another primitive or styling
framework. Use [Mantine’s documentation index](https://mantine.dev/llms.txt) as
the primary component reference and verify APIs against the installed version.

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
- `ui/icons.ts` owns icons by meaning. `theme.ts` owns tokens, component
  defaults, control densities, breakpoints and motion. Use Mantine props and
  theme defaults before co-located CSS modules; avoid global class rules and
  per-call values that restate defaults.

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
- Appearance controls live in the header's Appearance popover. Preferences
  follow the account rather than the device.
- Library and Settings use the shared route-backed modal and
  `WorkspaceSections` navigation, with scrolling inside a stable body.
  Mount sections on first visit and preserve visited forms and edits.
  Render a section failure inline without taking down the workspace.
- Use one section heading and toolbar; group further parts with `SettingGroup`.
  Use compact `DataTable` rows for dense records and cards for visual content.
  Phone tables fold secondary information into the main cell. Use headings
  rather than accordions, and popups to create or configure records.
- Settings use `SettingGroup` and `SettingRow`. Switches apply on/off settings
  immediately and optimistically, rolling back or refetching after failure;
  checkboxes select records or form options. Number fields commit on blur or
  Enter. Free text, passwords and record editing use a dialog with Save.
- Dialogs end with one right-aligned `DialogFooter`: Cancel, then the primary
  action. Consequential actions sit in a final Danger Zone or row menu and use
  `ConfirmDialog`, titled with the action and no question mark.
- Choose controls by selection semantics: a SegmentedControl or radio group
  selects exactly one choice, a Switch changes one setting, and toggle chips
  or MultiSelect combine options. All and Any are choices, not deselection.
- Empty views use `EmptyState`: one short, subdued line and at most the action
  that fills the view. `LoadingState` centres within the content while the
  shell stays mounted. Empty, loading and failure remain distinct states.
- Search clears only its query. Filters preserve it. Toolbars open search from
  an icon. Named controls opening a picker or menu show ▾ (Animate ▾, Copy ▾), small beside an
  action bar's icon; ⋯ already means more, so it never carries one. Icon-only controls use accessible names and tooltips. Menus group related actions, put the usual
  action first and Delete last, and share their sizing and item style. An option whose label
  alone is ambiguous carries a one-line `description` under it. An action's settings sit in its
  menu as segmented choices and checked options above its run, not in a separate dialog.

### Layers, Focus & Phones

- The phone layout covers screens below Mantine's `sm` breakpoint and phones
  held sideways (short touch screens up to 1000 px wide); iPads in landscape
  keep the tablet layout. `ui/usePhone.ts` owns the rule: components use
  `usePhone()` and `useSideways()`, and CSS the root's `data-phone` attribute
  (`sideways` for a phone held sideways), never width media queries,
  `visibleFrom` or `hiddenFrom`. A phone held sideways shows four gallery
  columns and puts the viewer's controls and Dream's card captions beside the
  media.
- Outside click and Escape close only the topmost layer; nothing beneath
  reacts. A closing layer no longer counts while it fades out.
  `ui/popupClicks.ts` owns this: custom handlers defer to `layerAbove(owner)`,
  and dialogs that can have another dialog above use `closeWhenTop`.
- A trigger's Tooltip wraps `Popover.Target` or `Menu.Target` so the trigger
  retains `aria-expanded` and toggles its popup. Nested Select/MultiSelect
  dropdowns stay inside their owning Popover with
  `comboboxProps.withinPortal: false` and preserve focus when selected.
- Shared chip popups (`ChipPopup`) anchor on desktop and open full-screen
  sheets on phones where the content needs the room; compact choices may use a
  fitted popover. On desktop its heading (`PopupHeading`) holds the title, then
  its actions at the end: every popup's Clear and Save, such as Save Stack or
  Save Preset, as compact subtle buttons with Clear first; naming what Save
  keeps (`SaveCurrent`) turns the whole row into its field, any options, Save
  and Cancel. A side column, such as the LoRA stack, has its own heading with
  its actions; desktop shows it beside the content, divided to the top, and
  phones under it. On phones, overlays keep their actions at the bottom and
  always in sight: a sheet's header holds only the title and Close, and its
  footer (other actions, then Clear, Save and Apply where choices apply as
  made) stays pinned above the safe area while the content between scrolls,
  with one scroll owner per form; a full-screen dialog pins its `DialogFooter`
  the same way. On touch screens, tablets included, chip popups and option lists
  open with the keyboard down: a popup's or option list's search (the Profile
  chip's) waits for a tap.
- Preserve drafts and focus through expansion. Actions staging a gallery draft
  use `useOpenComposer`: close the source surface, open the correct page and
  focus the prompt; phones open Generate with the keyboard down.
- Use the shared `TextBox`. Composer fields edit in place on every breakpoint;
  other phone text boxes open the shared full-screen editor. Only the send
  stands beside the text, with one ⋯ menu of its `tools`: the box's own
  (Suggestions, Ask for a Change… or Improve Prompt, Recent Prompts), then Copy
  where the page has no other, then Clear, which turns into Undo until the text
  next changes. The menu is one level deep: a tool's options (suggested changes,
  Improve Prompt's styles) are listed first under its name, never in a submenu.
  A box that opens the phone editor has no ⋯ beside it: the editor shows the
  tools as named buttons in a bar above the keyboard, then Clear as an icon
  beside the sends, as in the composer, and its header holds only the title and
  Done. A box without tools has no ⋯. Suggestions holds Refresh Suggestions
  under its options. The viewer's prompt has Improve Prompt (every style but
  Custom), resets to the item's prompt rather than clearing, and its phone
  editor sends Ask for a Change beside Generate. It rests on one line ending in
  an ellipsis and shows the whole prompt while focused. Its other assistance is
  the viewer bar's AI, after Edit: the image's Suggestions and Refresh
  Suggestions, then Custom… (a change typed over the prompt), then the
  remembered Review First.
- Respect safe areas and the phone keyboard. The viewport uses
  `interactive-widget=resizes-visual`; only the surface being typed into follows
  the visual viewport through `useKeyboard`, centred dialogs and the floating
  composer included. Keep unrelated layout stationary.
- Use semantic buttons and links with accessible names. Phone actions need
  visible names where their icons alone are ambiguous. Preserve focus trapping,
  Escape and return focus in dialogs and viewers.
- Scope shortcuts to the active surface; do not capture typing, composition or
  another overlay. On phones, gallery tiles without Tile Captions hide their
  menu button and open that menu on hold; other gallery tiles hold
  to select. Holds cancel on movement and their release opens nothing.
  Right-click, the Menu key and Shift+F10 open the same menu.

### Generation & Media

- Preserve exact profile IDs and account-owned asset IDs. Display readable
  profile, family and reference-role names rather than backend filenames.
  Profile options carry short facts (model or family · kind · Cloud or Local
  GPU), not prose. Reference order, explicit slot IDs and source-result lineage
  survive edits and reordering; optional End-only inputs and one asset in
  several roles work. Group compatible linked slots by their declared capacity
  rather than a global reference limit.
- Selected LoRAs retain enable, strength and pointer/keyboard ordering controls
  when filters hide them. Saved stacks preserve family keys, order, strengths
  and disabled entries. Trigger words are applied when submitting, without
  altering the typed prompt; reuse restores the typed prompt and Details
  shows what ran.
- Preserve actual model/provider metadata. Studio routes work to a worker
  itself; there is no worker choice. Animate displays its choice before queuing. Its
  menus show one choice, Cloud | Fast | Quality, where the account prefers
  videos to run: an account preference, not a menu setting, so Settings can
  show it too. Cloud shows with the Cloud Models grant, Fast and Quality for
  the local tiers a profile offers, and the choice only when there are two.
  The preferred side falls back to the other, saying so; Extend keeps its
  video's model unless Cloud is preferred.
- Settings › Preferences › Where Work Runs sets Cloud or Local for Images and
  Videos' Cloud | Fast | Quality as Animate's menus do. It sets only defaults: a
  model the person picks wins, and a draft keeps following the default until
  then. A default on the other side says so where its work shows: a
  notification on queuing. Text is the account's text model picker for
  prompt writing, the only one; its aliases route themselves, so it has no
  fallback or notice. Studio's own calls keep their automatic route.
- Replacing a draft with a preset or stack asks first. Assistant proposals
  replace text in place with a label and Undo, leaving a review pause before
  the proposed action runs, unless the viewer's Review First is off. Suggestions never move layout or act on their own.
  Ideas for an empty prompt are one Suggestions ▾ chip in the
  box's chip row, after References (`usePromptIdeas`); nothing floats over the
  text and ideas never show as a row of their own. Custom Animation's
  instruction offers Suggestions of what could happen, written from the image.
- Queue access belongs to the header status action. Under the queue, its popup
  summarises each kind in one quiet, read-only line for everyone: Images and
  Videos as their workers and Idle, N running or Stopped; Text as its local
  models and state, or Cloud only. Report actual endpoint health:
  configuration alone does not prove readiness. A deliberately parked worker
  reads Stopped, not failing; an unexpectedly unavailable one remains a
  failure. Runtime controls belong in Settings › Workers; only media work
  waiting on GPUs a text model holds offers its swap where the work shows.
- Keep recorded provider work and saving visible. Retry uses the shared queue
  command; bulk retry deduplicates IDs, retains unsuccessful items and preserves
  unrelated selection. Stop requests cancellation but accepted work may remain
  active until the provider confirms or results are saved. Clear Failed removes
  queue entries without deleting their records. Pause holds
  unstarted work in place (all accounts for a multi-user administrator); started
  work finishes. Reordering affects only the account's waiting work,
  preserving other accounts and queue tiers. Started background work finishes.
- The viewer is the iteration hub for finished and unfinished work, using the
  same actions as tiles and context menus. `MediaActions.tsx` owns availability
  and `itemActions.ts` the order: Animate, Edit, Upscale | Copy, Download |
  Similar | Star, Delete. Edit leads with Run Again and Run Again, Same Seed,
  which queue from where they are, then Use as Character (starting a card in
  Library › Characters) and Use as Reference, then what changes the item itself
  (Edit Image, or a video's Trim and the like) with Recreate in Composer last;
  menu options expand in place on phones and touch screens. The phone viewer bar fits every action
  on one row at a compact size, without More; elsewhere the viewer bar shows
  every action, wrapping onto another row rather than using More or scrolling. The phone bar drops its prompt field
  while Details is open. Gallery selection uses the shared contextual selection
  bar under the search and filters, which stay in place; its quick selects take
  every match, not only loaded pages, and it confirms deletion. The phone bar shows
  every action while they fit and keeps ⋯ More for the rest. A finished action ends
  the selection, keeping selected only the items it failed for; opening a menu does not.
- Details sections show their content in full rather than scrolling it in a
  box. Only a long caption folds, with Expand at the end of its last line; its
  tags always show. Prompt and Negative Prompt alone have a Copy beside their heading.
- Version grouping has one owner in `gallery/versions.ts`; sharing a session or
  prompt alone does not group results. Keep source and derived relationships
  visible, even when a result stands alone.
- Viewers fill the viewport independently of workspace width. Empty-stage
  clicks close; media, native video controls and actions remain interactive.
  Images open fitted without exceeding their real size. Keep the current image
  visible until the next version loads, then refit before painting. Navigation
  stops at the first and last item. A result from a run of several, like its
  Open All, flips through only that run's results; other results flip through
  the gallery. Closing reveals and focuses the current
  tile.
- On touch screens a tap on the media hides the viewer's chrome (top bar, arrows, strips, prompt,
  actions and Details) with a fade, as Photos does, and another tap shows it; desktop keeps it.
  A picture's tap waits out the double tap, and pinches, drags, long presses and swipes do not
  count; swipes still navigate and keep it hidden until the viewer closes. A tap on a video whose
  controls are hidden also shows them; taps while they show work them. Escape, a viewer key,
  Details, a tap beside the media and focus reaching hidden chrome bring it back. Open menus and
  sheets and loading actions stay in sight; strips hide, even with results still loading. With
  nothing else in sight the media glides to the middle of the screen at its fitted size.
- Viewing and upscale comparison share `MediaZoom`. Mask zoom and pan preserve
  pixels and undo history. Display, thumbnails, sharing and downloads respect
  the saved original/upscale choice through `mediaSource`; video upscales stay
  videos and comparison is an image action.
- Pinned phone tile captions keep to two lines and leave out the time. Reserve
  media dimensions, virtualise large galleries, lazy-load images and avoid
  autoplaying tile videos. Release a closed viewer's player and pause playback
  when the tab hides. Heavy tools load only when opened. Paging keeps loaded
  results and offers retry on failure. Failed images show no broken icon.

### Data & Feedback

- Switching modes preserves unsent prompts, references and settings. Use
  `useRemembered` for settled UI state per account, including every setting in
  an action menu (Animate's Review Prompt, Upscale's quality, size and
  Face Detail), shared by every surface showing that menu; a setting Settings
  also shows, such as where videos run, is an account preference instead. Do
  not persist open popups,
  selection or search queries. Keep credentials and private account records
  out of browser storage. A generated password shows once, in the view that
  issued it; an MCP token shows only to its own account, hidden until Show.
  Neither enters a query cache. Typing must not rerender unchanged media or history;
  shared provider commands retain their identity.
- Account groups own grants. Runtime definition edits retain administrator
  approval and conflict handling; read back saved changes.
- A queued generation whose prompt is written streams its thinking and prompt
  in the Writing Prompt stage without a review pause. Viewer change proposals
  and Animate's Review Prompt are explicit review paths: Run queues the
  edited prompt exactly as shown.
- Failed forms show their mutation error inline. Other failures use the
  `MutationCache` default notification; avoid duplicate error surfaces.
- Routine success appears where it happened: a saved row, a copy check or a
  brief action label (`useFlash`). Notifications serve failures, Undo and
  outcomes with nowhere else to show. Generation submission and completion
  appear in their gallery or strip; the gallery shows unfinished work as the
  account's Unfinished Work preference says (None by default, In Progress or
  Queued). Keep notifications clear of actions.
- Dream results stay in their own pool until liked; Like and Pass teach taste.
  The deck's bar offers only large Pass, Super Like (keep and star) and Like,
  or a comparison's A and B larger than Neither and Both; the viewer's bar
  offers every choice.
  Calibration uses only the account's own Studio generations and leaves the
  gallery unchanged apart from an explicit Star. Dream starts work only while
  Studio is idle and respects its daily caps. Its jobs show in the
  person's queue with a Dream badge, wait below everyone's own work and are not
  reordered; Stop All leaves them to Dream's own pause.
- Face Redo queues one Run Again of a drifted character result in its owner's
  own queue as a version of it, never a redo of a redo; Details says so.

### Motion & Verification

- Use shared motion tokens for short transitions without layout jumps, flashes
  or blocked input. Page, tab and section navigation is immediate; animation
  must not delay content.
- Animate transform and opacity, allowing Mantine indicators to size themselves.
  Avoid decorative hover movement and layout animation in hot paths. Respect
  reduced motion in CSS and Mantine, and retain colour and focus feedback.
- Browser specs cover meaningful desktop, Chromium phone and WebKit phone
  flows through accessible roles and event-driven fixtures. Keep shared mocks
  in `fixtures.ts` and cross-feature journeys in `workflows.spec.ts`. Avoid
  exact animation timing and cosmetic-only assertions; fixtures never become
  production fallbacks. Report measured conditions for performance claims.
