# UI Patterns

Studio has one responsive React interface. Use Mantine for standard controls,
forms, dialogs, drawers, menus, notifications and focus management. Domain tools
such as masking, media comparison and virtualised media layouts may use custom
components. Do not introduce another primitive or styling framework.

## Theme & Layout

- `src/theme.ts` owns the MantineHub Shadcn-inspired theme: neutral surfaces,
  shared radii and an amber accent. Follow the system colour scheme by default.
  Header and Settings share the same persisted colour, radius and width controls.
- Use Mantine spacing, typography, colours and breakpoints. Custom media CSS
  uses the same tokens. No hover movement or decorative animation. Honour
  reduced motion; essential behaviour must not depend on animation completion.
- Images and Videos are immersive gallery modes with little chrome. Their bottom
  compact generation box expands upward on interaction on desktop, with a
  full-height Mantine Drawer on phones. Clicking outside collapses controls;
  nested Mantine pickers and dialogs remain part of the active composer.
- Chat is the iterative media workflow: prompts and results form a continuous
  visual conversation, with sessions beside it on desktop and in a Drawer on
  phones. Refine and Animate change the shared composer in place and retain
  the session, source result and all generation inputs. Text replies stream into
  persisted history. Discussion stays text-only; explicit media requests queue
  work using the selected model and inputs, without a confirmation step or model
  fallback. Each generation has its own recorded input card followed by results.
  Editing and rerunning creates a new branch and leaves the original intact.
- Library and Settings are route-backed Mantine modals with blurred overlays;
  the media viewer fills the viewport. The generation form and its
  state are shared across all modes, using Mantine forms. Keep expert controls
  available, retain drafts across view changes and honour the phone keyboard.
- The model summary expands with Mantine Accordion to select Family, Model & Finetune, then Fast, Quality &
  Workflow Preset. Group only by explicit metadata and preserve the profile ID.
  LoRAs are grouped by the current family and their catalogue type (slider,
  style, character or concept); unknown types stay unclassified.

## Data & Interaction

- TanStack Query owns server data, polling and invalidation; generation drafts
  stay inside the generation feature. Keep account data out of browser storage.
- Account access groups own each user’s model grants and Cloud Models/NSFW
  permissions. Read back saved group and account changes; generation definitions
  remain read-only and owned by ai. Runtime presets support updates and copies.
- Sessions retain inputs, job relationships and outputs. Gallery contains every
  saved result. Refine and Animate preserve the source job relationship.
- References share a Gallery & Upload picker. Gallery drag-and-drop passes an
  owned item identifier to the server; the client does not adopt arbitrary media
  URLs or worker history as references.
- Preserve profile identifiers and actual model information. Wait for the
  selected backend unless the user explicitly permits fallback.
- Show queued, waiting, starting, running, saving and terminal states with the
  server's reason. Cancellation and retry operate on the recorded job.
- Use Mantine notifications for action outcomes and inline alerts for failed
  data views or forms. Do not duplicate errors across several surfaces.
- Keep action names consistent: Download, Recreate, Refine, Animate, Extend,
  Star, Upscale and Delete. Use Title Case for headings, labels and actions;
  sentence case and Australian English for explanatory text.

## Media & Accessibility

- Reserve media dimensions, lazy-load images, virtualise long galleries and
  avoid playing gallery videos automatically. Closing a viewer unmounts its
  player, and hiding the tab pauses it. Heavy domain tools load only when opened.
- Use semantic buttons and links, labels for every input and accessible names
  for icon actions. Keep Mantine's keyboard focus and Escape behaviour.
- Composer controls preserve the working draft and return focus on collapse.
  Use Mantine Collapse for desktop expansion and Drawer on phones; reduced
  motion also disables JavaScript-driven transitions. Focus must work without
  waiting for an animation to finish. Touch feedback must not leave hover
  overlays covering media.
- Handle failed image loads without exposing a broken-image icon. Keep empty,
  loading and failed data states distinct. Never display fixture data as a
  production fallback.
- Browser interaction tests exercise desktop and phone workflows using visible
  roles and labels. Fixtures wait for meaningful events instead of exact
  animation timing.
