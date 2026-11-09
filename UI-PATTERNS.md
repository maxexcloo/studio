# UI Patterns

Studio has one responsive React interface. Compose recurring layouts and
interactions from shared components across pages and breakpoints. Use Mantine
for standard controls, forms, dialogs, drawers, menus, notifications and focus
management. Media tools such as masking, zoom, comparison and virtualised media
layouts may use custom components. Do not add another primitive or styling
framework. Use [Mantine’s documentation index](https://mantine.dev/llms.txt) as
the primary component reference and verify APIs against the installed version.

## Code Structure

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

## Theme & Layout

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
  an icon; the phone Chats list keeps it open, with New Chat at the row's end.
  Controls opening a picker or menu show ▾, small beside an action bar's icon;
  icon-only controls use accessible names and tooltips. Menus group related actions, put the usual
  action first and Delete last, and share their sizing and item style. An option whose label
  alone is ambiguous carries a one-line `description` under it. An action's settings sit in its
  menu as segmented choices and checked options above its run, not in a separate dialog.

## Layers, Focus & Phones

- The phone layout covers screens below Mantine's `sm` breakpoint and phones
  held sideways (short touch screens up to 1000 px wide); iPads in landscape
  keep the tablet layout. `ui/usePhone.ts` owns the rule: components use
  `usePhone()` and `useSideways()`, and CSS the root's `data-phone` attribute
  (`sideways` for a phone held sideways), never width media queries,
  `visibleFrom` or `hiddenFrom`. A phone held sideways shows four gallery
  columns and puts the viewer's controls beside the media.
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
  fitted popover. Its heading (`PopupHeading`) holds the title, then its
  actions at the end (beside Close on phones, wrapping under the title when they
  don't fit): every popup's or sheet's Clear
  and Save, such as Save Stack or Save Preset, sit there, not in its footer, as
  compact subtle buttons with Clear first. A side column, such as the LoRA
  stack, has its own heading with its actions; desktop shows it beside the
  content, divided to the top, and phones under it. The phone sheet's footer
  (other actions, then Apply where choices apply as made) stays pinned
  above the safe area while the content between scrolls, with one scroll owner
  per form. On touch screens, tablets included, chip popups and option lists open
  with the keyboard down: a popup's search waits for a tap, and chip option lists
  have none.
- Preserve drafts and focus through expansion. Actions staging a gallery draft
  use `useOpenComposer`: close the source surface, open the correct page and
  focus the prompt; phones open Generate with the keyboard down.
- Use the shared `TextBox`. Composer fields edit in place on every breakpoint;
  other phone text boxes open the shared full-screen editor. Only the send
  stands beside the text, with one ⋯ menu of its `tools`: the box's own
  (Suggestions, Ask for a Change or Improve Prompt, Recent Prompts, Continue in
  Chat), then Copy where the page has no other, then Clear, which turns into
  Undo until the text next changes. The phone editor shows them as buttons, not
  a menu, and a box without tools has no ⋯.
- Respect safe areas and the phone keyboard. The viewport uses
  `interactive-widget=resizes-visual`; only the surface being typed into follows
  the visual viewport through `useKeyboard`, centred dialogs and the floating
  composer included. Keep unrelated layout stationary.
- Use semantic buttons and links with accessible names. Phone actions need
  visible names where their icons alone are ambiguous. Preserve focus trapping,
  Escape and return focus in dialogs and viewers.
- Scope shortcuts to the active surface; do not capture typing, composition or
  another overlay. On phones, Chats rows and gallery tiles without Tile Captions
  hide their menu button and open that menu on hold; other gallery tiles hold
  to select. Holds cancel on movement and their release opens nothing.
  Right-click, the Menu key and Shift+F10 open the same menu.

## Generation & Media

- Gallery and Chat cards share generation controls, while each card's draft
  remains independent. Editing an old Chat card sends its source job and full
  normalised input through the assistant and creates a new iteration without
  changing the original; do not bypass it with a direct queue request.
- The collapsed Chat composer holds only its message and Send. Focusing the
  message expands it in place, built as the gallery composer: the text with its
  tools, then a `ChipRail` (the text model where there is a choice, and
  References) beside Send. Pressing outside, Escape or tabbing away collapses it.
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
- Replacing a draft with a preset or stack asks first. Assistant proposals
  replace text in place with a label and Undo, leaving a review pause before
  the proposed action runs. Suggestions never move layout or act on their own.
  Ideas for an empty prompt or Chat message are one Suggestions ▾ chip in the
  box's chip row, after References (`usePromptIdeas`); nothing floats over the
  text and ideas never show as a row of their own.
- Queue access belongs to the header status action. Report actual endpoint
  health: configuration alone does not prove readiness. A deliberately parked
  worker reads Stopped, not failing; an unexpectedly unavailable one remains
  a failure. Runtime controls belong in Settings › Workers.
- Keep recorded provider work and saving visible. Retry uses the shared queue
  command; bulk retry deduplicates IDs, retains unsuccessful items and preserves
  unrelated selection. Stop requests cancellation but accepted work may remain
  active until the provider confirms or results are saved. Clear Failed removes
  queue entries without deleting their records or Chat cards. Pause holds
  unstarted work in place (all accounts for a multi-user administrator); started
  work finishes. Reordering affects only the account's waiting work,
  preserving other accounts and queue tiers. Started background work finishes.
- The viewer is the iteration hub for finished and unfinished work, using the
  same actions as tiles and context menus. `MediaActions.tsx` owns availability
  and `itemActions.ts` the order: Animate, Edit, Upscale | Copy, Download | Star,
  Delete. Edit changes the item itself (Edit Image, or a video's Trim and the
  like), then reuses its prompt: Edit Prompt and Use as Reference stage the
  composer, Run Again and Repeat Exactly queue from where they are; menu options
  expand in place on phones and touch screens. The viewer bar shows every
  action, wrapping onto another row rather than using More or scrolling; the
  phone bar drops its prompt field while Details is open. Gallery selection uses
  the shared contextual selection bar and confirms deletion.
- Details sections show their content in full rather than scrolling it in a
  box. Only a long caption folds under Expand; its tags always show. Prompt and
  Negative Prompt alone have a Copy beside their heading.
- Version grouping has one owner in `gallery/versions.ts`; sharing a Chat or
  prompt alone does not group results. Keep source and derived relationships
  visible, even when a result stands alone.
- Viewers fill the viewport independently of workspace width. Empty-stage
  clicks close; media, native video controls and actions remain interactive.
  Images open fitted without exceeding their real size. Keep the current image
  visible until the next version loads, then refit before painting. Navigation
  stops at the first and last item. A result from a Chat iteration or run of
  several, like their Open All, flips through only those results; other results
  flip through their Chat or gallery. Closing reveals and focuses the current
  tile.
- Viewing and upscale comparison share `MediaZoom`. Mask zoom and pan preserve
  pixels and undo history. Display, thumbnails, sharing and downloads respect
  the saved original/upscale choice through `mediaSource`; video upscales stay
  videos and comparison is an image action.
- Pinned phone tile captions keep to two lines and leave out the time. Reserve
  media dimensions, virtualise large galleries, lazy-load images and avoid
  autoplaying tile videos. Release a closed viewer's player and pause playback
  when the tab hides. Heavy tools load only when opened. Paging keeps loaded
  results and offers retry on failure. Failed images show no broken icon.

## Data & Feedback

- Switching modes preserves unsent prompts, references and settings. Use
  `useRemembered` for settled UI state per account, including every setting in
  an action menu (Animate's Review Prompt First, Upscale's quality, size and
  Face Detail), shared by every surface showing that menu; a setting Settings
  also shows, such as where videos run, is an account preference instead. Do
  not persist open popups,
  selection or search queries. Keep credentials and private account records
  out of browser storage. An issued MCP token or generated password shows once,
  in the view that issued it, and never enters a query cache. Typing must not rerender unchanged media or history;
  shared provider commands retain their identity.
- Account groups own grants. Runtime definition edits retain administrator
  approval and conflict handling; read back saved changes.
- A queued generation whose prompt is written streams its thinking and prompt
  in the Writing Prompt stage without a review pause. Viewer change proposals
  and Animate's Review Prompt First are explicit review paths: Run queues the
  edited prompt exactly as shown.
- Failed forms show their mutation error inline. Other failures use the
  `MutationCache` default notification; avoid duplicate error surfaces.
- Routine success appears where it happened: a saved row, a copy check or a
  brief action label (`useFlash`). Notifications serve failures, Undo and
  outcomes with nowhere else to show. Generation submission and completion
  appear in their gallery, strip or card. Keep notifications clear of actions.
- Render assistant Markdown with the shared safe renderer and Mantine
  typography. Defer parsing streamed changes; keep scroll anchored only while
  the user remains at the bottom. Preserve partial replies, thinking and tool
  history without mixing connection status into the conversation.
- Dream results stay in their own pool until liked; Like and Pass teach taste.
  The deck's bar offers only large Pass and Like, or a comparison's A and B
  larger than Neither and Both; the viewer's bar offers every choice.
  Calibration uses only the account's own Studio generations and leaves the
  gallery unchanged apart from an explicit Star. Dream starts work only while
  Studio is idle and respects its buffer and caps. Its jobs show in the
  person's queue with a Dream badge, wait below everyone's own work and are not
  reordered; Stop All leaves them to Dream's own pause.

## Motion & Verification

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
