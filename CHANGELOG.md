# Changelog

Every release of Studio, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) as described in
[docs/guides/CONTRIBUTING.md](docs/guides/CONTRIBUTING.md#versions-and-releases).

Add notes under **Unreleased** as changes land; `npm run release` turns that
section into the next version and uses it as the GitHub release notes. Each
version opens with a `> ` summary line.

## [Unreleased]

### Added
- **Prompt assistant engine:** one LiteLLM engine on the prompt writer's gateway credentials rewrites prompts (streamed, with the Enhance, Spicy, Photographic, Cinematic, Concise and Candid presets), writes negatives, suggests LoRAs, describes images (vision, with a text fallback) and drafts guides and profiles. Each call has a timeout and a fallback, and reasoning is stripped. MCP Generate's prompt writer runs on it unchanged. The account-scoped `/api/assistant` routes serve the composer and MCP.
- **Settings › Models › Integrations:** Assistant Model (by default the prompt writer's model) and Assistant Spicy Model rows list the gateway's models and say whether each reads reference images. Spicy stays off until a Spicy model is chosen.
- **Prompt Assistant:** a new access-profile feature, on for the built-in Administrator and User profiles and for every existing access profile. Spicy also needs the account's NSFW Models access, whatever model is selected.
- **One catalogue:** `library/catalogue.json` holds every known model file (LoRAs, checkpoints, diffusion models, encoders, VAEs, CLIP vision) with its hash, links, licence and provenance. It merges the synced and hand-installed `lora-catalogue.json` files, provider download records, cached hashes and the restore manifest, which stay where they are as backups. LoRA details read the same as before.
- **Versioned profiles and guides:** every profile save becomes a version under `history/profiles/`, prompting guides move into `guides/prompting.json` with versions under `history/guides/`, and AI drafts carry an AI-Drafted marker until an administrator edits or approves them. `MCP_PROMPTING_PATH` becomes seed input, and `.studio-edits.json` is still written.
- **Assistant evals:** recorded rewrite, LoRA and negative cases are scored in CI; `mise run eval:assistant` replays them against the live gateway on demand.
- **Prompt assistant in the composer:** a magic button in the prompt's action row rewrites the prompt with the last preset, streaming it in place; a caret (a pop-up list on the phone) picks Enhance, Spicy, Photographic, Cinematic, Concise or Candid, and the last one is remembered. Undo is in the status pill and the replaced text goes to History. A vision model reads attached references; otherwise the rewrite is text only and says so. Failures, offline and timeouts say so in the pill with Try Again.
- **Negative writer:** a magic button beside Negative writes one with Undo, and a rewrite refreshes the negative, on models that use one only.
- **Suggested LoRAs:** chips under the prompt after a rewrite or Suggest LoRAs, with strength and trigger words, plus Add All, and a Suggested section at the top of the LoRAs picker. Adding one puts its trigger words at the start of the prompt unless they are there; taking it off offers Remove Trigger Words. Suggestions learn from the account's starred results.
- **Assistant on results:** generations record the preset, model and chosen suggestions; Details shows "Written By: Assistant · Enhance" (or "Assistant in Chat") and the inputs Copy includes it.
- **MCP:** RewritePrompt, SuggestNegative and SuggestLoras run on the same engine for accounts with Prompt Assistant (Spicy needs NSFW access), and a Generate with a prompt RewritePrompt wrote records it on the results.

## [0.41.0] - 2026-10-21

> Studio becomes a hard fork of HEISS UI: Studio names everywhere, with the old settings, headers, cookie and browser storage still read, and dead upstream code removed

### Changed
- **Hard fork:** Studio no longer follows HEISS UI and owns all of its code. The HEISS UI and J-AI Studio credits and MIT notices stay in Settings › About, `LICENSE` and the README; the upstream-sync instructions and community links are gone.
- **Settings:** every `HEISS_*` setting is now `STUDIO_*` (`STUDIO_DATA_DIR`, `STUDIO_ALLOWED_HOSTS` and the rest). The old names still work from the environment or Studio's settings file, read when the new name is unset, and the log names any still in use in one line. Saving a setting writes only the new name. See Configuration › Renamed Settings.
- **Browser names:** pages send `X-Studio` and read `X-Studio-Sign-In`; the old `X-HEISS` header is still accepted. A device signed in with the old `heiss_device` cookie stays signed in and moves to `studio_device`. Preferences, drafts, LoRA favourites and other browser storage move from their `heiss-ui` names to Studio names on the first visit.
- **On-disk names:** the `heiss-ui` output and media folders, `.heiss-trash` and the `heissUi` profile block stay as they are; Studio also recognises the Studio folder names, and Configuration › On-Disk Names describes the later explicit migration. New ComfyUI run records and upscale markers use Studio names, and those written before are still read. Logs are `studio-YYYY-MM-DD.log`.
- **`/api/ping`** answers `app: "studio"`.
- **Removed:** routes and screens no UI reached (the old network, LAN, ComfyUI address and output-folder settings, opening the output folder, Clear Cache, the upscale download preview and the crash kit with its log route), confirmations that never asked, unused packages, styles and images. Only Reset All Settings asks first, as before.
- **Popovers:** Prompt History and the Size menu open above their buttons and stay on screen like every other popover; the account menu sits 8 px from the dock.
- **Speed:** a finished run's PNGs get their Civitai parameters in parallel without holding up the server, and requests for a worker's node list share one fetch.
- **Code:** App state in `main.tsx` is split into focused hooks; the data folder, version, JSON files and duplicate formatters each have one home.

## [0.40.1] - 2026-10-21

> Publishes the 0.40.0 changes, whose release check timed out; see 0.40.0 below for what changed

### Fixed
- The long administrator accounts browser test has room to finish on CI, so the 0.40 changes publish.

## [0.40.0] - 2026-10-21

> Access profiles with a default and approval, any number of workers, and a calmer, consistent UI: one dropdown, amber selection, no press movement, anchored popovers and LoRA stacks

### Changed
- **References:** a model that takes no reference shows no References control; Reference With is gone.
- **Pickers:** References, LoRAs and Models share one heading row (the views, Stacks, Clear, search and Close); desktop search grows inside it and the hint text is gone. On the phone the views are a dropdown in the title ("LoRAs · This Model"), so the list starts higher.
- **Picks:** every chooser marks a pick with the same amber tick as the model list; order numbers show only under Selected. LoRA source links are small "com" and "red" pills beside Star.
- **LoRA information:** shown once, on the row's edge, without File, Family, an empty description or notes that repeat the trigger or strength, in the picker and in Details.
- **LoRA stacks:** a Stacks menu at the top of the LoRAs picker applies, saves, updates, renames and deletes stacks, with Undo; Settings › Studio › LoRA Stacks edits their LoRAs and strengths. Enable All and Disable All are gone. LoRAs reorder by their grip (mouse, pen, finger or arrow keys) without a sliding animation.
- **Popovers:** every popover opens directly above the button that opened it, aligned to it and kept on screen; near the top of the screen it opens below.
- **Advanced Settings:** one compact column above the Advanced button, with the shared dropdowns and steppers.
- **Dropdowns:** one dropdown on the desktop and the phone (no more native phone pickers), with an amber tick for the choice, keyboard and type-ahead; segmented toggles and steppers share one size in rows.
- **Gallery tiles:** the hover caption reads the prompt, then the time and profile (and a video's length).
- **Tile actions:** a desktop tile's top row follows the viewer bar (Download, Recreate or Retry, Upscale, Star, Delete); Upscale is one of the row's circles, amber while the upscale shows, instead of a corner button. Narrow tiles put the rest behind More, which opens the right-click menu.
- **Phone tiles:** nothing covers the picture but progress, failures and selection checks; Settings › Studio › Gallery › Tile Captions brings the caption back.
- **Phone viewer:** a clean top with the title (profile, position such as 2 / 40, time and size) in the row beside Star · Info · Close; Details opens right under it, the same as on the desktop. Details drops the output Type, Weights that repeat the profile name and empty LoRA descriptions.
- **Prompt box:** growing past two lines no longer jumps; the composer resizes in the same frame as the text.
- **Details:** groups are Prompt, Model, Settings, Output (size, reference, upscale and file together) and Timing, with rows sorted alphabetically. The Image Text button is gone: the summary follows Details. Copy includes only what was set.
- **Timing:** an Upscale row shows the run's upscale time, which sits outside Active.
- **Speed:** finished outputs come across from the worker in parallel, and a finished run is picked up within a moment instead of waiting for the next poll.
- **Gallery:** a Status filter (Hide Queued, Hide Failed) replaces the Failed toggle.
- **Confirmations:** reversible actions (delete with Undo, stop, disable, restart, revoke) act at once; only Reset All Settings asks. The Confirm Before Removing Things setting is gone.
- **Settings › Account:** no Session group or Access line; Sign Out is in the Menu.
- **Access profiles:** Cloud Models and NSFW Models are access-profile features; Presets & Civitai Imports stays with administrators and is not offered there. Cloud models no longer appear in the Models list: Cloud Models grants them, and the server enforces it for generation, the model list and MCP. Profiles that granted a cloud model start with Cloud Models on; the old global LoRAs and Cloud Models switches become each profile's starting value once, so nobody gains or loses access. A deployment that switches a feature off shows it locked.
- **Access profiles:** All in Features picks every feature in one press; All in Models also grants local models added later. Picked rows take the amber tick, Models has no search box and the Profile ID row is gone (new IDs come from the name).
- **Default access profile:** administrators choose one default for new accounts, used for accounts added in Settings, first single sign-on and chat gateway accounts. Built-in Administrator (everything) and User (no NSFW models, cloud models, LoRAs or presets) profiles are added when absent. A Require Approval switch beside it (on by default) keeps new single sign-on and chat gateway accounts waiting in Users until approved onto the default; turned off, they start on it at once. Without a default, sign-ons still wait for approval.
- **NSFW marker:** a model profile can set `"nsfw": true` in its `heissUi` block; access profiles without NSFW Models never offer it.
- **Settings:** Profiles (the model profile JSON editor) is its own page for administrators; New Account sits on the Accounts heading; Upscale Status moved to Workers, which everyone can open to read it (the worker list stays with administrators); the LoRAs, Cloud Models and Presets & Civitai Imports switches left Models. Pages, groups and rows read alphabetically (Account first), and rows that only open a website show a plain link.
- **Workers:** Studio runs on zero, one or many ComfyUI workers, each with a name, an address and capabilities (image, video, upscale, model downloads). Administrators add, edit, test and remove them in Settings › Workers with Save & Discard; Studio keeps its own list in the data folder. Deployments define locked workers with `STUDIO_WORKERS` (a JSON list); `COMFY_URL` and `COMFY_VIDEO_URL` keep working as the image and video workers with their old ids, so earlier jobs keep their worker.
- **Routing:** each job goes to a worker with the capability it needs, preferring one that answers and already has the model, then list order; upscales go to an upscale worker. Nothing falls back to another kind of worker or the cloud, and with no worker Studio says so plainly and refuses the job.
- **Settings › Workers:** every worker uses one standard group (Address, Capabilities, Status with Test, Open, Restart) with the same words; an action that doesn't apply shows off with its reason.
- **AI Control:** the panel in Settings › Workers and Studio's `/api/ai-control` routes are gone; GPU allocation stays in AI Control's own UI and Mise. The AI Control MCP tools are unchanged.
- **Presses:** nothing moves when you click or tap any more; buttons, rows and tiles darken in place instead of shrinking or sliding.
- **Motion:** one set of timings everywhere, with no overshoot, hover lifts, staggered entrances, sliding highlights or endless glows; popovers fade and scale in at their trigger, and the composer opens and closes on a smooth curve.
- **Selection:** selected chips, tabs, segments, toggles and Settings sections share one amber highlight; list rows show an amber check instead of a grey fill; switches, checkboxes and the picker order mark are amber; keyboard focus shows one neutral ring.
- **Geometry:** shared spacing, control, row, radius, line and icon sizes; menus and their rows have rounded corners, segmented toggles come in two sizes and small icon buttons in lists are round 32 px targets.
- **Tooltips:** labels open away from their bar's edge (below the gallery toolbar, above the composer and docks), and the gallery toolbar's buttons use them instead of the browser's own hints.
- **Size:** the Size button never cuts its label short after picking Default, 2K or 4K; Megapixels' Reset is a small round icon at the end of its row that appears without moving the field.
- **Phone bars:** the top bar reads the status and "Studio" on the left and Select, Search, Filter and Menu on the right; Images | Videos moved to the left end of the bottom prompt bar, whose prompt now reads faded.
- **Phone Create:** the prompt's Select All, History and Clear sit in one row at its top right, alike in colour and size; a focused prompt fills the screen with just its text. The footer's Clear All is a round eraser button on the row's centre line, matching the filter row's Clear.

## [0.39.0] - 2026-10-21

> Compact pickers, clearer generation Details and a Custom size option

### Changed
- **Generation Details:** clearer section headings and a Copy · Recreate footer. Copy preserves saved generation inputs and references while excluding output files, timestamps and timing. Edit and Copy Settings are removed.
- **Image Text:** an optional concise summary appears only while Details is open.
- **LoRAs:** enabled adapters show their filename and information automatically in a shared panel. Civitai sources have separate .com and .red icons beside the row; links are removed from the information panel.
- Variant comparison controls are hidden while existing records and APIs remain intact.
- **Notifications:** every notification closes after three seconds with a countdown ring around Dismiss; hover, focus and a background tab pause it. Questions still wait for an answer.
- **Names:** Smart Upscale is now Upscale and Rerun is now Recreate; saved preferences keep working.
- **Timing:** Details explains Active and Total and keeps estimates marked.
- **Pickers:** References, LoRAs and Models share one compact toolbar with Clear Selection on the right and search behind an icon (or start typing).
- **Size:** Custom is the last size option and is the only one that unlocks Width and Height; the megapixel and ratio caption under them is gone.
- **Model changes:** switching to another model family clears the LoRA stack; models in the same family keep it.

## [0.38.0] - 2026-10-21

> Active worker model storage and clean container shutdown

### Added
- **Worker model storage:** `STUDIO_MODEL_STORAGE=worker` lists and downloads models in the active ComfyUI library. Studio retains provider credentials and streams weights directly to authenticated worker endpoints, with source-bound resume, published checksum verification and no destination overwrites.

### Changed
- Worker model storage respects ComfyUI folder aliases and extra roots. Saved-image checks use the active worker; manifest import, verification and restore are explicitly unavailable in this mode. Local model storage remains the default.

### Fixed
- Containers stop promptly on termination after saving pending gallery changes, including when Node runs as PID 1.

## [0.37.0] - 2026-10-21

> Controlled comparisons, clearer Details actions and steadier gallery layouts

### Added
- **Compare Variants:** make 2–4 images with a shared seed, edit each prompt and settings, vote on finished results and return to account-owned comparison history.
- **LoRA information in Details:** compatibility, suggested strengths, notes and triggers, with both civitai.com and civitai.red links for Civitai sources.
- **MCP Handover:** copy a conversation summary with current result references when requested or when a chat host reports its context is nearly full. Studio never guesses the host's context usage.

### Changed
- **Details copying:** Copy includes both prompts and all settings; Copy Settings includes only settings. Each prompt keeps its own Copy action.
- **Phone selection:** Select is directly available at the top right; Menu moves beside the status light.

### Fixed
- Resizing gallery columns no longer lets moving tiles pan the gallery and shift the desktop toolbar.
- Ordinary visual-viewport scroll events no longer restore an old gallery scroll position; keyboard close still restores its resting position.
- Deleting an image already removed elsewhere keeps it removed without a not-found error.
- Phone viewer confirmations reserve space for their answers so Star and Info cannot cover Delete.
- Phone header controls stay separate at narrow widths; running jobs reuse the status slot instead of pushing into Menu or the gallery modes.

## [0.36.0] - 2026-10-21

> Visual image review on request through MCP and a generation timing breakdown

### Added
- **Generation timing:** new runs save queue and active time plus estimated setup, sampling and finishing stages in Details and requested MCP reviews. Older results retain their recorded elapsed time.
- **MCP Review:** a read-only tool supplies image pixels, the recorded prompt and generation settings for a chat model to assess when asked, with an optional second result for comparison. It preserves account ownership and hidden/deleted-result restrictions and never queues revisions.
- **Controlled revisions:** Reuse accepts `preserve_seed` for same-profile follow-ups; ordinary reruns still use a new seed.

## [0.35.0] - 2026-10-21

> Batch 5: a reworked phone Create, inline confirmations in the status pill, Settings as flat lists, a manual AI Control switch, and MCP that owns its chat rules

### Added
- **AI Control in Settings › Workers:** administrators choose what each GPU runs, with a preview of what stops, starts and keeps, a confirmation only when something stops, and progress in the status pill; a change to both GPUs runs as one job through AI Control's board routes. Everyone else reads the status. Manual only.
- **Self-service account:** name, email and password in Settings › Account. Administrators edit model profiles as JSON (Settings › Users › Profiles), pick access profiles with multi-selects and Save & Discard.
- **Gallery view controls on both devices:** Auto-Grouping, Grid Autoplay and Failed in the desktop toolbar and at the end of the phone's filter row. Stop All shows its count.
- **Confirmations in the status pill:** questions ask inline with Cancel and the answer, never in a dialog; deleting several items lists their thumbnails and names under the question, then offers Undo in the same pill.
- **Phone focused editing:** with the keyboard up, Prompt, Negative and the profile JSON editor fill the visible height on their own, with Done.
- **LoRA prompt styles in MCP:** Studio adds a stacked LoRA's triggers (first when its note says so) and, for tag-style LoRAs, a short line of relevant tags to prompts it writes; a profile guide's recommended negative fills in when the caller gives none.
- The LoRA picker notes a model's own limit (Radiance video: "Up to rank 64 in total").

### Changed
- **Phone Create:** Model, References, LoRAs, Size and Advanced open as pop-up lists over Create; the prompt's actions sit at its right edge; a two-line footer holds Steps and the count, then Image/Video · Clear · Generate. The collapsed prompt bar is back at the bottom of the gallery.
- **Phone top bar:** the status light and "Studio" on the left, Images and Videos as centred icons, Search, Filter and a menu (Select, Library, Settings, Account, Sign Out). Selecting swaps the bar's contents; its actions sit in a bottom bar.
- **Phone viewer:** the desktop's title top left, Star · Info · Close top right, and a centred action bar. Phone tiles no longer show generation times.
- **Edit and Rerun** replace Reuse and Recreate everywhere; Details has one footer (Copy Prompts · Copy Settings above Edit · Rerun) and friendly profile, weight and LoRA names. Bulk Animate is gone.
- **Messages:** one pill at a time, repeats fold into the one on screen, and upscale failures and "Image Ready" say so in the pill on both devices.
- **Settings** are flat lists with one group per worker; Upscale and Face Detail are chosen per generation in Advanced Settings. About has its full page again.
- **Civitai-ready PNGs** are always written; the switch is gone.
- **MCP:** Studio's server instructions carry the chat rules, so clients need no prompt prefix. MCP never picks Grok or another cloud profile unless asked, and no longer falls back to the cloud when the local video worker is down. Distilled profiles take no CFG, in Studio or MCP.
- Size always shows Width and Height; every composer control stays in the desktop bar; favourite workflows use the star.

### Removed
- Zen mode and Follow the Latest Output, Simple Phone Studio, the desktop More Settings drawer, and the local-install Settings (model folders, Hugging Face token, Tessera, model types, manifest, rescan, other devices).

## [0.34.3] - 2026-10-20

> Phone scrolling works again

### Fixed
- **Phone scrolling:** the phone gallery scrolls again by touch, wheel and trackpad (also in a desktop browser's device mode). The narrow-screen `body { overflow: hidden }` passed to the page while the phone shell scrolls the document; the phone shell now keeps its body visible and locks the page only on `html` while a sheet or the viewer is open (`phone-touch-scroll.spec.ts`).

## [0.34.2] - 2026-10-20

> LoRAs for Radiance workflows

### Added
- **Radiance LoRAs:** a workflow's `loraStack` can use the `radiance-tags-v1` adapter (up to 4 LoRAs by default, at most 8). Studio sets the Radiance node's `loras` input to the enabled LoRAs as JSON (`[{"name","strength"}]`, in stack order) and leaves the prompt text alone; Radiance adds the tags itself.

## [0.34.1] - 2026-10-20

> MCP face detail only beside a requested upscale, and exact prompts that refuse only clear instructions

### Changed
- **MCP face detail:** Generate turns face detail on by itself for a full-body or wide-shot person only when the request already chooses `upscale_quality`; it no longer adds a fast upscale. Without an upscale nothing changes, and an explicit `face_detail: true` works as before.
- **MCP exact prompts:** `exact_prompt` refuses only clear instructions ("variations", "of this scene", "generate 4 photos", "five variations"), so finished prompts such as "Create two cats on a sofa" run as written.

## [0.34.0] - 2026-10-20

> A flat phone Create sheet with a sticky Generate, one phone top bar with a floating Create, flat lists for every step and for Settings, one chooser for References, LoRAs and Models with drag to reorder, a Sign Out that works, and the gallery staying put when the viewer closes

### Added
- **Sign Out in plain sight:** an Account menu in the desktop dock and an Account group at the top of the phone's More, each with Sign Out; it asks first only while something is generating.
- **Drag to reorder:** picked references and LoRAs reorder by dragging their grip in the Selected tab, with a mouse, pen or finger, or with the arrow keys.
- **Date headers as a setting:** Settings › Studio › Gallery › Date Headers, off by default.
- **MCP:** Generate turns face detail on by itself when the prompt shows a person full-body or in a wide shot (an explicit `face_detail: false` wins) and says so in its reply; an `exact_prompt` request that holds generation instructions ("Generate five variations of this scene: …") is refused with a message to pass `count` and the plain prompt.

### Changed
- **Phone Create sheet:** one flat column. The prompt fills the room that's left, with History and Clear in a small toolbar along its edge; Model, References, LoRAs, Size and Advanced are full-width rows; a sticky footer keeps the count, Reset and Generate in view. Image/Video sits beside Close. Nothing overflows at 320–430 px.
- **Phone top bar:** the status light and Images | Videos are one element on the left; Search, Filter and More sit on the right; search and filters open under the bar. The bottom dock is gone and Create is a floating button, with a dot while a prompt waits.
- **Flat lists:** Advanced Settings, Size, Model, More and Settings use one flat list of one-line rows with hairlines. Advanced Settings show steppers, friendly model-part names (the file name stays in the picker) and Seed as a field with a Random toggle, in two dense columns on the desktop. Size marks the shape in use with a check and makes Custom Size a normal row.
- **One chooser:** References, LoRAs and Models share a title bar, the tab pills with Clear Selection, and search. LoRAs show their order like references, with View Source as a link icon beside Info. Models no longer offer Browse Models: the chooser is the one way to pick.
- **Settings cleanup:** the Discord and feedback-board links, Report Bug buttons, About's stats and credits, and rows for a local install (output folders, finding ComfyUI on its own, the studio password for other devices, the second Restart) are gone or hidden in account mode. About shows the version, the repository and the changelog. Toggle labels are Title Case.

### Fixed
- **Sign Out:** a plain same-origin POST to `/api/accounts/sign-out` (a console fetch, a form) is no longer refused for missing the studio header, and signing out also ends a leftover device session.
- **Gallery jump after the viewer:** opening a tile that was partly under the top bar no longer scrolls the gallery behind the viewer, so closing it lands exactly where you were.
- **Reference chooser on phones:** its tabs, Clear Selection, Upload and Close no longer run off the right edge.

## [0.33.1] - 2026-10-20

> Lighter icon-button hovers with tooltips that stay clear of the zoom, an outline Upscale arrow, plain centred empty states, picks that keep their place, and a steady CI

### Changed
- **Icon-button states:** the viewer bar's and docks' hover and press fill is a 32 px circle inset evenly in the bar, with a keyboard ring that traces it; tile corner buttons share one hover, press and focus treatment; the phone viewer bar's press fill sits inside its cell.
- **Viewer zoom in the corner:** the zoom pill sits at the bottom right, level with the action bar, so the bar's tooltips never cover it.
- **Upscale arrow:** an outline like the other action icons.
- **Empty states:** every picker, tab and list with nothing to show uses plain muted words centred in the space, without a box or icon; the LoRA picker says "This Model Doesn’t Support LoRAs".
- **Picks keep their place:** in the References and LoRA choosers a picked item stays where it is and shows its number; the Selected tab lists picks in order. Clear All is now **Clear Selection**.

### Fixed
- **CI:** the completion-notice test measures the island once its height settles instead of mid-animation.

## [0.33.0] - 2026-10-20

> Messages move into the Studio pill, every reference stack gets one References button, Advanced Settings become a popover, Settings regroup, chat queues ten images per call, and motion and start-up get quicker

### Added
- **Clear All in the pickers:** the reference chooser and the LoRA library show Clear All beside their tabs while something is picked; Undo comes back in the status pill.
- **Cloud generations survive a restart:** a Grok job's ComfyUI prompt is kept in `cloud-jobs.json`, so after a Studio restart the tile keeps running and delivers instead of reading "Generation missing"; a lost or failed provider job fails the tile with a clear message.

### Changed
- **Messages in the Studio pill:** toasts are gone. A message (with its Undo, View or Try Again) takes over the phone bar's Studio pill or sits in the desktop gallery's top bar; a sheet, dialog, picker sheet or the viewer that covers them shows it at its own top edge, never over controls.
- **One References button for every reference stack:** a profile that lists its references as separate "Reference Image" slots (the synced FLUX.3 [klein] profiles' ten, Boogu Edit Turbo's and Qwen-Image 2.1's three) shows one References button and chooser; start and end frames stay separate.
- **Advanced Settings in a popover:** above the composer like LoRAs and References, with the same glass, motion and dismissal; the phone keeps its sheet in the Create flow.
- **Settings sections:** Account, Users (administration, split out of Accounts & MCP), Studio (General, Generation, Features and the gallery), Models (with Integrations and output folders), Workers (Connection), Maintenance (clean up, export, reset and diagnostics) and About.
- **Labels:** Title Case with "&" for every label, tooltip and accessible name; select-mode actions read "Animate Selected", "Download Selected as a Zip", "Delete Selected"; Select Failed has its own tooltip and icon; tooltips start with the action ("Recreate With the Same Seed").
- **Smoother motion:** popovers and sheets skip their backdrop blur while they move, a dialog's scrim adds its blur after its fade, and the viewer's backdrop is near-solid.
- **Faster start:** the first screen's status, model and ComfyUI requests start while the code downloads, the gate's two checks run together, the models load once, and the next gallery page starts two and a half screens early.
- **LoRAs for another model stay off the stack:** the picker lists them under All Models with the reason but never adds them, and Recreate or Use LoRAs drops them with "Removed 1 incompatible LoRA".
- **Ten images per chat call:** MCP Generate and Reuse queue 1–10 jobs per call (`prompts` × `count`, each a separate job), stated in the tool and parameter descriptions. An excess is refused by Studio itself, naming the field, its range and how to split the request, instead of a chat client's generic schema error. The account's outstanding-job limit still applies to each job.
- **Turbo finds the fast profiles:** MCP Models with tier `turbo` or `fast` lists both speed tiers, the named one first, and Generate's `turbo` falls back to Fast when no Super Fast profile is ready. Profile names match model words fuzzily ("flux 3", "flux3", "FLUX.3", "turbo flux 3"); words naming several models ("klein") list them.
- **The named model is the one used:** in an MCP `profile_id`, the model words pick the family and speed words only choose within it ("moss turbo" is MOSS Image Base · Fast, not Boogu Turbo; "turbo radiance flux 3" is the Radiance FLUX.3 [klein] Distilled profile). A `tier` the family lacks falls back to its nearest tier with a note, never to another family; a miss lists that family's profiles or says the model isn't available, and the chat is told not to substitute another. When the chat leaves `profile_id` out, a model the request names ("six baby ducks, fast moss") is used, and Queued and Done replies name the profile that ran.
- **Clearer MCP replies:** Generate's description asks for one call with `count` or `prompts` for several different images ("six photos" is count 6) instead of repeated calls, and for a named model in `profile_id`; finished replies say not to call Studio again for this request, and queued replies say to share links, not images.

### Fixed
- **Phone Upscale label:** it lines up with the other viewer bar labels.
- **LoRAs for another model are refused:** generation refuses an optional LoRA trained for another family (a Z-Image LoRA on Tesserafine), from the studio and from MCP, instead of applying it; Studio reads a worker LoRA's family before checking. MCP Reuse leaves such a LoRA out of a rerun and says so. `compatibleLoras` in `server/lora-policy.js` filters a reused stack and counts what it dropped.

### Removed
- **Leftover Hidden styles and copy:** the vault's last CSS and text are gone; the device sign-in screen keeps its own styles.

## [0.32.0] - 2026-10-20

> One References chooser for many-reference models, Hidden folded back into the gallery, multi-select gallery filters, Animate from the select bars and a tidier viewer, menu and phone sheets

### Added
- **One References button:** a model that reads several references (FLUX.3 [klein] takes ten) shows a single References button with the picked thumbnails and n/max, instead of a control per slot. Its chooser picks several at once, numbers them in order and has a Selected n/max tab to review, reorder and remove them; the inpaint brush and Edit | Reference sit beside it.
- **Selected n/max for LoRAs:** the LoRA library adds a Selected view beside This Model and All Models, and drops its row animations.
- **Several values per gallery filter:** Models, LoRAs, Size and Aspect Ratio each take several values (any of them matches; every filter together), with a tick per value, a count on the trigger and its own Clear. The gallery API takes repeated `model`, `lora`, `size` and `aspect` parameters.
- **Animate from the select bars:** selected photos animate from the desktop and phone select bars as well as the right-click menu.

### Removed
- **Hidden:** the private vault, its password, passkeys, lock screen, settings, routes and Move to Hidden are gone. On the first start, Studio backs up its data to `backups/hidden-removal-<time>/` in the data folder, moves any vault there untouched (it needs the owner's old password to open), returns hidden-flagged records to their owner's gallery and clears the markers that kept them out of it. Nothing is deleted; see [Configuration](docs/guides/CONFIGURATION.md).

### Changed
- **Desktop viewer:** Info sits alone in the top right and the open Details panel has its own Close; the bar reads Copy · Download | Animate · Recreate · Reference · Upscale | Star · Delete, then Close.
- **Desktop gallery switch** reads Images | Videos in words.
- **Right-click menu:** full-width rows with muted icons, hairlines between the intent groups, an "n Selected" heading for several items and an inset focus ring.
- **Phone Create sheet:** Prompt and Negative, then Image/Video with Model, References with LoRAs, and Size, count, Advanced and Generate.
- **Phone More sheet:** Select, Library, Settings, Account; the status light top left is a small Studio pill.
- **Steppers:** every number stepper has 44 px parts on touch screens; the phone's count shows an icon so its row fits.
- **Title Case:** labels, headings, tooltips and accessible names read in Title Case with &.

## [0.31.0] - 2026-10-20

> A thumb-first phone dock, one layer at a time, viewer actions by intent with Recreate and Reuse, Retry for failed items, and chat prompts written by Studio

### Added
- **Retry failed items:** a failed image or video offers Retry on its tile, in the viewer and in the right-click menu, and Select Failed picks every failed item for one Retry or Delete. Each retry is a new job with the run's own model, prompts, settings and references.
- **Selections download as one zip:** Download on several selected items fetches one archive of just those items (`/api/gallery/export?ids=`), instead of a burst of separate downloads.
- **LoRA catalogue:** Studio also reads `lora-catalogue.json` from its data folder's `config/`, synced like `prompting.json`; that copy wins over one installed by hand. Entries take `triggers` and `guidance` (shown in a LoRA's info), Qwen-Image 2.1 LoRAs that read as Qwen-Image from their weights land on Qwen-Image 2.1 models, and a literal `[]` trigger is ignored.
- **Prompt writing for chat:** with `STUDIO_PROMPT_WRITER_URL`, `_KEY` and `_MODEL` set, MCP Generate takes the user's `request` and Studio writes the final prompts itself, one per image, from the target profile's full prompting guide in one fresh call to a fast chat model, falling back to the request when that fails. `exact_prompt` or explicit `prompts` skip it. Replies show each prompt used (up to 200 characters) and result pages the full prompt. Reuse tweaks ("warmer") and model changes rewrite the original request plus the changes for the target model, so no guides pile up in the chat.
- **Any MCP client:** Studio's server instructions and tool descriptions now carry every workflow rule, so LibreChat, Claude Desktop, Grok and others behave the same; the README explains connecting through LiteLLM or with a personal token.
- **Reference With:** when the selected model takes no reference image, the composer shows Reference With in the Reference button's place. It lists the ready models of that kind that take one, grouped and labelled like the model picker; picking one switches to it and opens its reference picker. On the desktop and in the phone's Create sheet.

### Fixed
- **Info closes Details on phones:** tapping Info while Details is open now closes it instead of reopening it.
- **Videos stop when closed:** closing the video viewer or stepping away stops playback and releases the file, so no audio carries on in the background. On a phone, Details or a sheet over a playing video or the gallery pauses it; the viewer resumes when it's uncovered if it was playing.
- **Cloud video quota:** when the cloud video provider refuses for authorisation or quota (such as CLIProxyAPI's HTTP 401), chat results and result pages say "Cloud video unavailable (quota)", and MCP queues no cloud video for 10 minutes instead of failing job after job.
- **Tap the status bar to go to the top:** on a phone the gallery scrolls the page itself rather than a box inside it, so iOS's tap on the status bar scrolls it back to the top. The top bar, search, create pill and select bar stay fixed over it; sheets and the viewer lock the page behind them, and the gallery keeps its place, its separate Images and Videos positions and its infinite scroll.
- **Phone keyboard:** the Create sheet, the reference, LoRA and Reference With sheets, and phone dialogs size and place themselves in the visible part of the page while the on-screen keyboard is up, so iOS panning to the prompt no longer pushes a sheet's top off screen; they return when it closes. The page uses `100dvh` rather than `100vh`, so it has nothing to scroll.
- **Reuse in chat:** Reuse's `job_id` says to pass the result's ref exactly as the reply header shows it ("result 1") or its job id, and never "all", which only Result takes; link ids still work. A chat model's first Reuse had passed a link id or "all".
- **Selection and search:** "N Selected" in the gallery toolbar reads as plain text rather than a highlighted pill (the phone header says "N Selected" too), and the search's clear X is a round plain icon button. A focus ring shows only for keyboard focus.
- **Copy Prompt on phones:** copying asks the clipboard within the tap, as iOS Safari requires, falls back to a selected text box where there is no clipboard API, and says "Prompt copied".
- **Stars:** a star the server refuses now says why, with the HTTP status, and starring sends the picture's address as well as its id so a record is found either way.
- **Viewer loading:** an image opens at its final size straight away, from the size its record gives, with its gallery thumbnail filling that rectangle until the sharp picture fades in over it. Nothing resizes as it loads, and reduced motion swaps without the fade.

### Changed
- **Viewer actions by intent, one word each:** the desktop bar reads Copy · Download | Animate · Recreate · Reference · Upscale | Star · Delete | Info. A phone shows Copy · Share | Animate · Recreate · Reference · Upscale | Delete along the bottom, Star top left and Info top right; videos offer Extend instead of Animate. Zoom is a small `− 100% +` pill above the bar, faded until used; its percentage cycles Fit, 1:1 and Full Size. The right-click menu uses the same names and grouping.
- **Recreate and Reuse:** Recreate (formerly Use Settings) is an exact rerun: model, prompts, size, LoRAs, references, settings and the same seed go into the prompt box. Reuse loads both prompts. In Details, each prompt has its own Copy and Use, Settings sit unboxed below, and the footer offers Reuse and Recreate; phones add Copy and Settings shortcuts at the top.
- **Long press selects:** on a phone a long press on a tile starts selecting with it; the action sheet is gone. The select bar offers Select All, Select Failed, Share (Download where sharing isn't possible), Retry, Star and Delete; Animate and Move to Hidden left the select bars.
- **No haptics:** the phone no longer vibrates or ticks.
- **Size stays open:** choosing a resolution or a shape keeps the size panel open, and the resolution is always a segmented toggle of the model's native options.
- **Advanced inline:** the desktop's Advanced settings expand below the composer's controls instead of opening a dialog, and stay open or folded per account.
- **One accent:** active filters, the phone's Search and Filter badges and other highlights use one warm amber accent.
- **Phone dock:** the phone's controls moved within thumb reach. A dock above the home indicator holds the prompt and Generate, the Images/Videos icons, Search, Filter and More; the top keeps a thin status strip. Search and Filter share one row that opens above the prompt, full width; the other stays an icon, tinted with a count while something is applied, and closing the row clears the query and every filter. Filters keep the desktop's order (Starred, Models, LoRAs, Size, Aspect Ratio) on one line that scrolls sideways.
- **One layer at a time on phones:** a picker or settings sheet opened from Create replaces it with a Back step instead of stacking on top, under one dimmed backdrop. Toasts sit under the status strip, on a full sheet's title row or under the viewer's top buttons, never over controls.
- **Image/Video icons:** the gallery's Images/Videos switch and the prompt box's Image/Video mode are the same pair of icons, with names and tooltips, on the desktop and phones.
- **One glass:** every translucent surface uses one set of tokens at two levels: bars (toolbars, the dock, the Images/Videos switch, search, the viewer bar, the phone top bar, create pill and select bar, toasts and tile chips) and panels (popovers, menus, sheets and side panels). The phone's top bar, sheets and viewer bar are frosted glass instead of solid fills and fades.
- **Details panel:** its actions read Animate (Extend Video for a video), Copy Prompt, Use Prompt and Use Settings, in that order, with Copy Prompt above Use Settings. Generation Settings sit unboxed under a label like Prompt's, and Copy as Text is gone.
- **Use Prompt and Use Settings:** from the viewer, its Details, a tile or a menu, they now apply, close the viewer and open the prompt box with the reused text ready to edit: the desktop composer expanded and focused, or the phone's Create sheet.
- **Viewer dock:** the desktop dock reads Zoom Out, a zoom percentage that steps through Fit, 1:1 and Full Size when clicked, and Zoom In, then Copy, Download, Star, Upscale and Delete, then Details. Use as Reference, Animate and Move to Hidden stay in the menus and on the phone.
- **Share and Download:** the desktop viewer, tiles, context menu and selection bar download and no longer offer Share. On a phone the viewer bar, long-press sheet and selection bar offer Share instead of Download (iOS's share sheet has Save Image), and keep Download only where the browser can't share files.
- **Faster viewer:** the viewer and its neighbour prefetch load a display-sized WebP (up to 2560 px, cached and warmed like thumbnails) instead of the full PNG, often a sixth of the bytes. The original loads only when zooming past the display copy's size; downloads still give the original.

## [0.30.2] - 2026-10-20

> Result links work as references

### Fixed
- **Result links as references:** Status, Result, Cancel and Reuse accept a result link or its short id from an earlier reply, for the same account; a chat model had passed the link id instead of "result 1".

## [0.30.1] - 2026-10-20

> Chat asks for 2K only when the user does, and imported FLUX.3 workflows can draw it

### Fixed
- **2K for imported workflows:** imported workflows take their model family's native 2K and 4K support, as they already took its size step, so `size: "2k"` works for the Bento FLUX.3 profiles.
- **Size only on request:** MCP's instructions say to pass `size` only when the user asks for 2K or 4K; a chat model had added it to an ordinary request.

## [0.30.0] - 2026-10-20

> Fast profiles by default in chat, several images in one call, prompting guides once per conversation and Result links with an All Results page

### Added
- **Aspect and size in chat:** Generate takes `aspect` (`landscape`, `portrait`, `square` or a ratio such as `16:9`) and `size` (`2k` or `4k`) and uses the profile's own native preset sizes instead of invented pixel sizes.
- **All Results:** replies with several results, or any still running, add one All Results link to a page that lists every result of the conversation and fills in as they finish. Result with `job_id: "all"` answers "show them" with every recent finished result in one reply.

### Changed
- **Result links:** chat replies label each link Result N instead of Watch result N.
- **Fast by default in chat:** without a tier, Generate and Reuse animation pick the fastest tier available (Fast, then Super Fast, Standard and Quality). A `profile_id` such as "flux 3" or "FLUX.3" matches its family and picks that family's fastest profile, and near misses list the fastest first. An exact ID or an explicit tier still wins.
- **Batches in one call:** Generate's description and errors say that N different images are N prompts in one call. `count` is variations per prompt, and a `count` equal to the number of prompts is read as one each. The call waits for all its jobs against one shared deadline, and a refusal such as the outstanding-job limit names its reason.
- **Prompting guides once per conversation:** every pick (exact, by family name or by tier) carries a compact prompting guide of at most 1,200 characters the first time a conversation uses a profile. Studio marks the guide as sent before it waits, so concurrent calls never repeat it.

## [0.29.0] - 2026-10-20

> One image per chat request, AI Control restarts from chat, and a gallery that follows the viewer

### Added
- **AI Control from chat:** the control tools add Restart, which restarts a running workload in place (same model, profile and GPUs) when the user asks, and Mode, which previews a preset board (image and text, image and video, or video on both GPUs) for an approved Apply. GPU changes still happen only on explicit request.
- **The library follows the viewer:** stepping or swiping to another item in the viewer scrolls its tile (or the stack holding it) into view behind the viewer, on a computer and on a phone, so closing the viewer lands where you are. The gallery only moves when the item changes and its tile is out of sight.

### Changed
- **One image per chat request:** Generate makes one image or video unless the user asks for more, and Models reports a `count` default of 1. The studio composer still defaults to two.
- **Plain tool titles:** MCP tools carry short titles such as Generate, Find Models, Check Status and Preview Allocation for chat hosts that show them.
- **Matching phone switches:** the phone's More sheet names its switches as Settings does (Smart upscale, Show failed items, Confirm before removing things) and uses the same switch control.
- **Studio settings fail loudly:** a partial `STUDIO_OIDC_*` set, an invalid `STUDIO_ACCOUNT_MAX_OUTSTANDING_JOBS` or `STUDIO_OUTPUT_STORAGE`, or a `STUDIO_SETUP_TOKEN` under 32 characters now stops Studio at startup with the setting's name instead of quietly falling back. The sign-in button reads Single Sign-On unless `STUDIO_OIDC_LABEL` names it.

### Fixed
- **Reduced motion everywhere:** animated panels, sheets and the viewer follow the system's reduce-motion setting, as the CSS animations already did.
- **Named sheets and number fields:** phone sheets take their name from their heading, including "Create in Hidden", and number fields are labelled; their buttons read "Images: 2" without a "click to edit" hint.
- **Video wording:** deleting a video asks "Delete This Video?" and confirms "Video deleted", grouped deletes read "3 items deleted", the phone shows "Generating 1 video" for a video, and delete dialog titles use Title Case.
- **Use Settings and Use Prompt:** reusing a result's whole recipe reads **Use Settings** everywhere (viewer, item menus, failed runs, presets), and taking only its prompt reads **Use Prompt** (Details, item menus, presets).
- **Current wording and links:** About and the phone no longer mention in-app updates, the Hugging Face hint points at Settings › Integrations, `.env.example` names the `studio` storage default, and broken guide links point at existing sections.
- **Studio names in downloads:** gallery and Hidden exports download as `studio-gallery-…`, `studio-hidden-…`, unnamed shared files fall back to `studio`, and accounts asking for Hidden see "Hidden is not available to accounts."

## [0.28.0] - 2026-10-20

> Chats hand back slow jobs at once

### Changed
- **Slow jobs hand back at once:** when an image outlasts Generate's 60-second wait, or for any video, Generate and Reuse reply with the watch links and tell the chat to end its turn instead of waiting on a Result call. Result runs only when the user asks to see a result, such as "show result 3", with a short wait. Finished images still return inline.
- **Lighter releases:** `npm run release` checks the tree, version, tags and changelog summary, then bumps, commits, tags and pushes without running the test suites locally. The Release workflow runs the full checks before it publishes.

## [0.27.0] - 2026-10-20

> Dismiss waiting chat users, and a faster studio while the video worker is off

### Added
- **Dismiss waiting chat users:** each waiting ID under Settings › Accounts & MCP › Chat Gateway Users has Dismiss next to Link, which removes it from the list after a confirmation. An ID the gateway sends again returns to the list.

### Changed
- **Leaner Studio chats:** Models lists profiles as short `id — label` lines and indexes every compatible LoRA in one line each, so a profile with 90 LoRAs fits in about 1,300 tokens instead of 6,500 and no LoRA is cut off. `lora_query` or the new `lora_names` returns full details for up to five LoRAs. Generate takes LoRA names alone, fills the recommended strength, and picks a profile that can use them; a guessed profile ID or label is matched, and a miss names the closest profiles.
- **Short result links:** chat results use short links such as `/mcp/results/Ab3dE5fG7h` instead of 300-character sealed ones, and each image is a preview that opens the original, with no separate View Original link. Deleting or hiding the output still ends its links, and earlier links keep working.
- **Images return inline more often:** Generate waits up to 60 seconds for images, enough for a cold model load, so the chat skips the Result call and its extra turn. A queued job is collected with one Result call that waits for it, without background polling. Generate sets `count` from the user's wording, so "a photo" makes one image. Generate, Reuse and Result replies carry only their instruction and markdown, and refused arguments come back as one line naming each field.

### Fixed
- **Faster while the video worker is off:** when the video worker does not answer, Studio remembers that for 30 seconds instead of asking again on every model list and run, which took about 1.5 seconds each time a lookup or connection failed slowly. A connection check that reaches the worker, or a new video address, clears it at once. Model detection is also reused until ComfyUI is asked again.
- **Faster gallery media:** Studio builds the thumbnails, video stills and grid previews of its stored media in the background after it starts and whenever the gallery changes, newest first and only while nothing else is being built, so a large imported gallery no longer waits on hundreds of first-view builds. A finished run's thumbnails are built as it is delivered. Browsers keep stored originals for good, and their thumbnails, stills and previews for a week before checking them again.
- **Video thumbnails in small views:** a video's thumbnail address now gives its still, so the activity panel, the reference picker and the Animate review show a picture instead of a placeholder.
- **Quieter chat gateway checks:** the gateway's own health checks and handshakes, which name no chat user, now connect and list the tools instead of being refused, so LiteLLM stops logging a failed MCP session for each. Tool calls without a user are still refused.

## [0.26.0] - 2026-10-19

> Email sign-in, Animate and Extend Video in the viewer, and a steadier phone prompt

### Added
- **Animate from the image viewer:** a finished image has Animate in the viewer's dock on desktop and its action bar on a phone. It opens the same Animate review as a gallery selection, with that image as the first frame of a MiniMax H3 video.
- **Extend Video:** a finished video has Extend Video in the viewer. Its last frame starts a new MiniMax H3 video with the video's prompt, which can be edited first. The frame is cut from the original when the run is staged and never stored, so only the owner's own videos can be extended and a Hidden video's extension stays in Hidden.

### Changed
- **Clearer sign-in:** the account sign-in and first-administrator screens are a card like Studio's dialogs, with an Email field that phone keyboards no longer capitalise or autocorrect, inline errors and a separate Pocket ID button. Accounts are identified by email everywhere: new accounts and the first administrator need an email address, while existing non-email usernames keep working.
- **Account actions on phones:** the phone studio's More sheet has an Account section with Accounts & MCP, Settings and Sign Out.
- **Smaller MCP context:** the seven media tools' descriptions and parameter notes and the server instructions are cut to their essentials (about 2,900 to 1,650 estimated tokens per model step), since chat hosts resend them on every step. Media sessions no longer receive the GPU allocation rule, and AI Control sessions receive only it.

### Fixed
- **Phone prompt with the keyboard up:** tapping the prompt in the phone's Create sheet no longer squeezes it to a sliver above the controls until the page is scrolled; the prompt keeps its height and the sheet scrolls instead.
- **Phone viewer opens fitted:** on a phone, an image opens fitted to the screen instead of at 1:1, which showed a corner of it. A double tap zooms in from the fitted size and back; 1:1 and the zoom buttons stay available. Desktop still opens images at 1:1.

## [0.25.0] - 2026-10-19

> LibreChat users reach Studio without a manual link

### Added
- **Chat gateway links by email:** a trusted gateway can forward the user's email in `x-ai-user-email` (in LibreChat, `{{LIBRECHAT_USER_EMAIL}}`, passed on by LiteLLM's `extra_headers`). An unlinked chat user whose email is an enabled, approved account's username, ignoring case, is linked to that account on its first request, recorded like an administrator's link. Unknown emails stay pending, disabled accounts are not linked and no accounts are created.

### Changed
- **Unlinked chat users see a clear message:** instead of a refused connection, which LibreChat reports as no available MCP tools, an unlinked gateway user gets Studio's tools, and every call returns a short message asking an administrator to link it in Settings › Accounts & MCP. It still cannot generate or read anything.
- **Local passwords have no minimum length:** any non-empty password is accepted when creating or resetting an account, and Settings no longer asks for 12 characters.

## [0.24.0] - 2026-10-19

### Added
- **Cloud video while the local worker is off:** when the separate local video worker is unavailable, as in a text and image GPU mode, MCP Generate with `kind: video` and Reuse animation without a `profile_id` now use a ready provider-backed cloud video profile, such as Grok, instead of failing. The profile matching the requested tier wins, otherwise Standard; animation needs one that takes a starting image. The reply marks the profile `remote` and names it, so users know the video went to the cloud. `/api/models` reports the video worker's availability with the catalogue it already loads, so no request adds a check. Explicit profiles, accounts without cloud access and a running local worker behave as before.

## [0.23.1] - 2026-10-19

> Named MCP results, with no gap above the image

### Fixed
- **Named MCP results:** each finished result in Generate, Reuse and Result notification replies now opens with a visible header line naming its reference, model and View Original link, such as `**Result 3** · Krea 2 Turbo · [View Original](…)`, directly above its image with no gap in LibreChat. Users can see which result to refer to; videos get the same header with View Video.

## [0.23.0] - 2026-10-19

### Added
- **MCP follow-ups:** Reuse with a result reference and `kind` handles "again", "more like that" and "animate it" without a Models call. The result's own kind runs it again with the same profile and settings and a new seed, optionally with a revised `prompt`. `kind: video` animates an image as the first frame of the account's default first-frame video profile (Fast unless a `tier` is given), sized to the image's proportions. Follow-ups reply and wait as Generate does; Reuse without `kind` still returns a reference asset.

### Fixed
- **Phone search dismissal:** closing the phone search overlay with an outside tap, including opening Select from More, or Escape now also clears its query instead of leaving it applied. Its own header button still closes it and keeps the query.

## [0.22.0] - 2026-10-19

### Added
- **MCP tiers:** Generate accepts `kind` and `tier` (`quality`, `standard`, `fast` or `turbo`) instead of a `profile_id` and picks the account's default ready profile for that tier, so ordinary chat requests need no Models call. Models filters by tier. Turbo means Super Fast; standard means Standard or untiered profiles, otherwise Quality.
- **Inline MCP results:** Generate waits up to `wait_seconds` (30 seconds for images and none for videos by default, at most 60) and, when every job finishes in time, returns `status: done` with the signed image markdown and View Original link that a Result notification returns. Quick images then need no background Result and no extra agent turn; slower jobs return `status: queued` as before. A client Stop or disconnect ends the wait, never the generation.

### Changed
- **Leaner MCP output:** the Models list returns only ID, label, kind, tier and a one-line summary (prompting guides stay in the profile detail), Generate returns the chosen profile and each job's ID, reference and watch link, and a background Result notification returns only its markdown unless `detail: true` is passed. For the Bento catalogue, a tier-filtered image list drops from 9.5 KB to 0.2 KB and a notification from 2.5 KB to 0.8 KB.

### Fixed
- **Demo progress:** Demo Mode jobs report their steps in the studio's progress shape, so running tiles show "Step 1/4" instead of Queued.
- **Running tile model label:** a running or queued tile names its profile as the model picker does, in a chip styled like Stop in the opposite corner, and it no longer shifts when the pointer is over the tile.

## [0.21.0] - 2026-10-19

### Removed
- **Upstream links on About:** Settings › About no longer shows the feedback panel or links to upstream's feedback board, Discord and website. Source, licence, changelog and credits stay.

## [0.20.0] - 2026-10-19

### Changed
- **Renamed to Studio:** this fork is now Studio, at `maxexcloo/studio` and `ghcr.io/maxexcloo/studio`. The app title, wordmark, MCP server and messages say Studio; HEISS UI stays credited as upstream. Upstream's `HEISS_*` settings keep their names. The fork's own settings move to `STUDIO_*`, with no fallback: `STUDIO_MULTI_USER`, `STUDIO_SETUP_TOKEN`, `STUDIO_OIDC_*`, `STUDIO_MCP_API_KEY`, `STUDIO_OUTPUT_STORAGE` (its `heiss` value is now `studio`), `STUDIO_MEDIA_DIR`, `STUDIO_WORKER_TOKEN`, `STUDIO_MODEL_MANIFEST`, `STUDIO_MODEL_MANIFEST_PREFIX`, `STUDIO_DEFAULT_IMAGE_PROFILE`, `STUDIO_DEFAULT_VIDEO_PROFILE`, `STUDIO_ENABLE_BUILTIN_PROFILES`, `STUDIO_ENABLE_GROK`, `STUDIO_ENABLE_TESSERA`, `STUDIO_ENABLE_LORAS`, `STUDIO_ENABLE_PRESETS` and `STUDIO_ACCOUNT_MAX_OUTSTANDING_JOBS`.
- **Worker node:** the ComfyUI node is now `comfyui/studio_worker`, answering on `/studio/worker` with the `X-Studio-Worker-Token` header. Update it together with Studio.
- **Sessions and MCP:** accounts sign in again once (the cookie is now `studio_account`), and MCP clients send `x-studio-conversation-id` for per-conversation references.

## [0.19.0] - 2026-10-19

> Reliable selections and container-only releases

### Added
- **Model manifest:** `HEISS_MODEL_MANIFEST` (or an imported copy) lists every model the deployment expects, with checksums. Settings shows what is verified, missing or wrong, verifies checksums in the background, restores missing Civitai and Hugging Face files through the checksum-verifying downloader, and exports the manifest.
- **Gallery size & aspect filters:** filter Images, Videos and Hidden by long-edge size (Up to 1K, 1K–1.5K, 1.5K–2K, Over 2K) and common aspect ratios or Other. Pending jobs stay visible, and items without known dimensions only drop out while one of these filters is on.
- **Optional multi-user mode (`HEISS_MULTI_USER=1`):** local accounts with a recovery administrator, access profiles that grant generation profiles and features, private per-account galleries, prompt history, LoRA stacks, references and jobs, personal MCP tokens, a per-account outstanding-job limit, Pocket ID/OpenID Connect sign-in with administrator approval, trusted chat-gateway user links, readiness probes and an **Accounts & MCP** settings section. Single-user mode is unchanged.
- **LoRA details & ordering:** existing descriptions, trigger words and safe source links are available in the picker; selected effects support drag, keyboard and button reordering.
- **Reference search:** find images by prompt, model or filename across the full library.
- **MCP result references and watch links:** Generate returns a short reference per job (`result 3`, numbered per conversation or account) and a signed watch page that shows progress and then the outputs without the chat. Status, Result, Cancel and Reuse accept the reference in place of a job ID.
- **MCP LoRA discovery:** Models details list a profile's compatible LoRAs with their descriptions, trigger words, recommended strength and source links, using the LoRA picker's metadata and the account's LoRA access.

### Changed
- **Simpler configuration:** the trusted gateway forwards its user ID as `X-AI-User-Id` (was `X-Bento-User-Id`). `HEISS_DEVICE_COOKIE_NAME`, `HEISS_ACCOUNT_COOKIE_NAME`, `HEISS_ACCOUNT_COOKIE_SECURE`, `HEISS_MCP_FOREGROUND_WAIT_SECONDS` and the AI Control download route (`HEISS_MODEL_DOWNLOAD_URL`/`_TOKEN`) are gone: HEISS downloads into its model folders itself, and foreground MCP waits are capped at 20 seconds. Manifest paths are now relative to ComfyUI's model folder unless `HEISS_MODEL_MANIFEST_PREFIX` is set.
- **Smoother LoRA and reference pickers:** a picked LoRA stays where it was clicked, with its strength brought into view. Rows are one line with Info beside the star, and the keyboard highlight is visible, with Home and End. Both pickers share one placement and a quicker motion (about 220 ms instead of 430 ms), stay on screen above long drafts, and the reference picker opens with its search focused and says when every slot is full. The composer's model menu stays within the composer, and the closed composer names the active LoRAs ("Film Grain +1") instead of only counting them.
- **Deployment-aware Settings:** Connections show image and video backends in one layout with status, routing, address and source, and the video connection can now be set from Settings. Models adds default profiles and catalogue switches, and a new Integrations section gathers Civitai, Hugging Face, model downloads and output storage. Every value shows whether it comes from the deployment, this studio or the default; deployment values are locked, so saved changes no longer silently revert at restart.
- **ComfyUI as a worker:** with HEISS media storage (default in multi-user mode, or `HEISS_OUTPUT_STORAGE=heiss`), finished outputs move into HEISS's own per-account folders, and the new HEISS worker ComfyUI node removes ComfyUI's copies, so HEISS no longer needs ComfyUI's output folder.
- **Self-sufficient MCP notifications:** a background Result notification now includes the signed image markdown and View Original link, so the agent shows the result in one step without another Result call. Background Result waits are capped at 1500 seconds (below LibreChat's 1800-second background deadline) and end promptly when the chat is stopped or disconnected; the generation keeps running.
- **Clearer MCP controls:** Models lists only the controls a profile lets MCP adjust, and Generate names a refused control and the adjustable alternatives. Negative prompts are refused with an explanation on profiles where they have no effect (no negative input, or CFG 1) instead of being silently ignored, and the server instructions discourage polling more firmly.
- **Signed MCP result links no longer expire:** they keep working until the output is hidden or deleted. New links are sealed, so they reveal no account or job ID; links issued earlier still open.
- **Studio import:** `scripts/import-studio.mjs` copies an existing single-user studio into one account. It runs as a dry run by default, backs up changed files, and can be undone; the source studio is never changed.
- **Multi-user migration:** existing single-user galleries, history and MCP ownership have no account owner and stay hidden in multi-user mode until migrated explicitly. In multi-user mode, a trusted gateway's shared MCP key works only for forwarded user IDs that an administrator has linked to an account, and the AI Control MCP key keeps only its control tools.
- **Reference selection:** click to select or deselect without closing the picker; selected images remain first across searches and tabs, including at capacity.
- **Workflows list:** shorter, wider tiles in a wider desktop popup, with the detail panel preserved.
- **Reference browsing:** scrolling near the end loads another page automatically; the fixed search row blends into the picker with a softer scrolling edge.
- **Compact negative prompts:** one line expands for editing; profiles that ignore it grey the field without an extra note, preserving the saved text.
- **Faster studio loading:** settings, workflows and the image editor load when needed.
- **Larger reference libraries stay responsive:** only visible thumbnail rows are rendered, with arrow-key navigation preserved.

### Removed
- **Container-only delivery:** this fork ships only the verified container image on GHCR. The desktop downloads and launchers, the in-app updater and its Settings › About controls and update pill, restarting HEISS UI from Settings, release signing and the legacy `JAI_*` environment variables are gone; set the `HEISS_*` names instead. A `v*` tag publishes the image under its version and a GitHub release with these notes and the image digest. LAN and HTTPS changes apply on the next start.
- **Project website:** the upstream website and feedback board in `docs/` and its Pages workflow are not carried by this fork; the guides and screenshots stay.

### Fixed
- **Mangled images from imported workflows:** an imported workflow now uses its model family's size step (for example 32 for Qwen Image 2.1) when its latent node allows a finer one. Off-step sizes such as 1536×2728 were silently cut by ComfyUI and could come out mangled.
- **Container security updates:** Debian mirrors use verified HTTPS, and a package-index download failure now stops the build instead of silently leaving vulnerable packages installed.
- **Video frame references:** deselecting a start frame preserves the end frame in its own slot, including when both use the same image.
- **LoRA trigger:** opening the picker preserves the composer and reliably tracks its opener on touch devices.
- **Saved variant counts:** preference migration preserves explicit image counts of 1 and 4.
- **Updater archive selection:** mismatched, platform, draft and prerelease archives cannot substitute for the version’s generic updater archive; default-feed pages, assets and staged packages must belong to the fork.
- **Reliable AMD upscales:** use wavelet colour correction for manual and automatic SeedVR2 upscales, avoiding the red bands and black regions produced by LAB on Radeon GPUs.
- **Lighter generation previews:** software GPUs and unavailable WebGL use the existing 2D effect, and the GPU check waits until a preview is needed.
- **Reference library recovery:** failed pages keep the loaded images and show an inline retry; keyboard navigation uses one thumbnail Tab stop, Home/End and focus restoration.
- **Separate image and video connections:** queue estimates and connection indicators now follow the backend used by the selected profile.
- **Quick gallery scrolling:** user scrolling takes precedence over a pending restored position.
- **Generation reveal:** starting a run goes straight to the top, without an animated scroll being interrupted by the new tiles.
- **Phone negative prompts:** the saved field has a stable accessible label, including when the current profile does not use it.
- **Settings › Features › Inpainting says where its two dials are:** in the
  sidebar's Basics, under the image, not under Advanced.

## [0.18.0] - 2026-10-17

> Native 2K, a new size menu, FLUX.3 Klein and MOSS-Image

### Added
- **2K.** Pick 2K in the size menu and the model draws your picture at full
  size in one go. The menu tells you if a model isn't made for it.
- **A new size menu.** See the exact size before you make it, set your own
  width and height, save sizes you use often, or pick a size in megapixels
  (Settings › Generation).
- **FLUX.3 Klein.** Black Forest Labs' newest model: fast, sharp, made for 2K,
  and it can edit from up to three pictures. Its prompt helper turns a short
  idea into a detailed one; it's recommended, not required.
- **MOSS-Image.** Great at clear text in pictures. **Guided setup** shows what
  it still needs.
- **Edit or Reference.** On Flux.2 and Qwen-Image 2.1, choose whether your
  first picture gets changed or only guides a new one.
- **Docker.** Run HEISS with `docker compose up --build`
  ([how](./docs/guides/DOCKER.md)).
- **HEISS tells you why it stopped**, if it ever stops on its own.

### Changed
- **Upscaling moved to the picture.** New pictures aren't upscaled
  automatically anymore. Use 2K, or the upscale arrow on any picture.
- **Setup notices changes by itself.** Update ComfyUI or add nodes, and it
  picks that up without a reload.
- **Restart shows how it went.**
- **Several references sit in one chip** and fan out on hover.
- **Better time estimates** for big pictures.
- **Generation details** can be copied as text and show your LoRAs.
- **Find ComfyUI on its own** can be turned off in Settings › Connection.

### Removed
- Automatic upscaling of every new picture (see above).
- The viewer's "Vary with a new seed" button.

### Fixed
- A busy ComfyUI no longer shows as offline.
- Translators and browser extensions no longer crash the studio.
- Flux.2 Klein 9B picks a text encoder that works.
- The size menu stays still while you use it, and shows no 2K note without a
  model.
- 4K upscales and restarts on Windows work again.
- Smaller fixes to references and saved sizes.

## [0.17.0] - 2026-10-09

> Inpainting, auto-grouping and smart upscale built in

### Added
- **Inpainting.** Hover a reference image, hit the brush, paint over the part
  you want changed and say what it becomes. Only the painted part gets redrawn,
  the rest keeps its pixels. Works with the edit models (Flux.2, Klein,
  Qwen-Image 2.1) and any model that can start from an image, and there are no
  extra nodes to install. The model menu marks which ones can. It's in beta and
  on by default; Settings › Features turns it off if you don't want it.

<img width="600" height="488" alt="image" src="https://github.com/user-attachments/assets/1be54903-e7ad-470d-8c6c-8270e09853af" />

- **Auto-grouping.** Pictures from similar prompts, even ones you tweak as you
  go, now stack themselves once you stop working on them, as a photo stack or a
  cover flow with the count in the corner. Slide along the bottom of a tile to
  skim it, open it to spread the images out, or hit Unstack to keep them apart.
  Your files aren't touched, and the button by search turns it off.
- **Smart upscale is built in.** Pick None, 2K or 4K next to the size menu (or
  in the phone's create sheet) and every new picture gets upscaled with SeedVR2
  as part of its own run, so you can close the page. The next run waits for it,
  and if you stop it or it fails you still keep the picture at its generated
  size. If a tier needs models or nodes you don't have, picking it offers to set
  them up.
- **Upscales show the time left.** Times are learned per model and size, queue
  estimates count them, and the ring and buttons show the seconds remaining.
- **LoRA mismatch note.** A small note above the prompt bar when an active LoRA
  was made for a different model family.
- **A crash log** in `data/logs/`, kept for a week. The crash screen also names
  browser extensions or translators that might have gotten in the way.

### Changed
- **The phone viewer zooms with your fingers now.** The pinch follows them and
  gives a little past its limits before springing back, and a swipe or flick
  slides in the next picture while its neighbours load ahead. Upscale shows its
  ring and time left there too.
- **The phone layout goes all the way to the bottom**, under Safari's toolbar
  and in the Home Screen app, instead of stopping at a black band. Sheets also
  stop flashing the page behind them as they close.
- **Settings are regrouped into eight sections** with a single restart button.
  Smart upscale and inpainting get drawers under Features, auto-grouping lives
  under Library, and feedback and Discord moved to About.
- **The model menu names a model's family once**, under its name, with icons for
  what it can do.
- **The start image moved into the sidebar's Basics**, with its change amount
  right under it.
- **Between 761 and 1040 px wide**, the controls now sit in columns beside the
  prompt bar.
- **The Images picker stops at 8** for built-in models, which is the most one
  run renders, instead of letting you go way past it.
- **Loading tiles are calmer.** A soft surface with one slow light sweep instead
  of a flickering checkerboard.

### Fixed
- **Gallery export works at any size.** Past 4 GB or 65,535 files it writes a
  ZIP64 archive and reads each file once, so it no longer holds the whole
  export in memory.
- **Big galleries scroll smoother and find thumbnails faster**, and at most four
  thumbnails get built at once instead of dozens.
- **Translating the page no longer takes the studio down.** Chrome's and Edge's
  translator rewrote the sidebar and viewer details and could crash everything.
  Both are left alone now.
- **Lifting one finger after a pinch no longer flings the picture.** The other
  finger used to pan it or send it gliding off.
- **Prompts are capped at 100,000 characters**, and an oversized or broken
  request now gets a short error instead of a wall of HTML.

**Come hang out: the HEISS UI Discord is open.** Ask questions, share what you
make, and watch the feedback board move. Every idea and bug report gets a post
when it's planned, started and fixed, with a live roadmap at the bottom. Join at
https://discord.gg/Hf7ysvDeGa, or from Settings and the website.

## [0.16.0] - 2026-10-04

> Video in the gallery, and steadier thumbnails and references

### Added
- **Videos play in the gallery.** Tiles show a still straight away and play a
  silent preview (720 px, up to 24 at once, 6 on a phone); the button by
  search pauses them. Opening a video plays it in a full player with seeking,
  sound and full screen; left and right step to the next item, and on a phone
  you swipe between them or down to close. Hidden videos preview too, kept in
  memory only, never on disk.
- **Videos from other folders take their real shape.** Their size is read from
  the file, for ones already in the gallery too, instead of a square tile and
  ?×? in the details.
- **Oversized start and reference images are resized** to what the model
  works at before they're sent. The originals stay as they are.

### Changed
- Download activity can take you back to the model or workflow that needs the
  file, and can be paused, resumed and canceled from its pill.
- Reference images in the prompt bar are bigger, and their menu no longer
  flickers when the pointer passes over or slips off its edge. On a phone it
  opens toward the screen instead of off its left edge.
- Calmer loading tiles, a clearer detail view and steadier tooltips.
- **Starting from a source checkout rebuilds the app when it changed**, so
  after a `git pull` the browser gets the new page, not the last build.

### Fixed
- **References come off when you remove them.** With an edit model and more
  than one reference, taking the first one off left the next picture in both
  slots, and its × did nothing until you picked another model. The others now
  move up instead, and a later reference's ×, which was hidden behind its
  neighbour, works too. Deleting an upload takes it out of every slot.
- **A new image never shows an older picture.** After deleting the newest
  image, ComfyUI gives the next one the same file name, and its tile showed
  the deleted picture until a reload.
- **Thumbnails come from ComfyUI's own file.** If the output folder set here
  isn't ComfyUI's, a same-named file there no longer becomes the thumbnail.
- **Notifications go away on their own again.** After you'd closed one with
  its × or Undo, every later one stayed until closed by hand, and a deleted
  image wasn't really deleted until then.
- **A new generation lands top left at once.** With the pointer over the
  gallery it used to land on the far right, then jump left.
- **The Windows download unzips cleanly in 7-Zip and PeaZip.** It held one
  link file that recent 7-Zip refuses as unsafe, reported as a fatal error
  although nothing was missing.

## [0.15.0] - 2026-09-30

> A feedback board, right from the app

### Added
- **A public feedback board** at [heiss-ui.vercel.app/board](https://heiss-ui.vercel.app/board/)
  for bugs, ideas and questions. Anyone can post, upvote and comment, no
  account needed, and each post shows whether it's open, planned, in progress
  or done.
- **Send feedback from the app.** Settings › Feedback sends a bug, idea or
  question to the board, and a failed generation has **Report bug** with the
  error filled in. The dialog shows everything a post carries, setup lines
  included only if you leave them on, and nothing goes until you press Send.
- **A crash screen** instead of a blank page if the studio hits an error it
  can't recover from, with Reload and Report this bug.

## [0.14.0] - 2026-09-29

> Generated images in the feature mockups

### Changed
- **The existing animated feature mockups now show real generated images** in
  their image areas, including the model thumbnail, render preview, phone
  gallery, search results, Hidden grid and upscale comparison.
- **The website moved to [heiss-ui.vercel.app](https://heiss-ui.vercel.app/)**, with
  new guides for every model family, popular graphics cards and Macs, and
  comparisons with other ComfyUI front ends. The Website link in Settings goes
  there, and old links forward.
- **Pony V7 runs as its makers' own workflow does:** its text encoder reads
  prompts padded to 768 tokens, and pictures start at 1280×1536.
- **The Krea 2 enhancer runs at its own default strength** of 1 instead of
  1.5, where its author says to start.
- **The original Sana 1.6B models run at CFG 2**, as NVIDIA's own ComfyUI
  workflows do. SANA 1.5 keeps 4.5.

### Fixed
- **Wan video comes out clean on a Mac.** Wan 2.1 and Wan 2.2 5B start on the
  euler sampler there, since uni_pc corrupts video on Apple Silicon.
- **A Mac gets files it can load.** Where a text encoder comes in full
  precision too (T5-XXL for SD 3.5, UMT5 for Wan), a Mac downloads that one,
  since Macs can't load quantized fp8 files. The fp8 starter models say
  they're not for Macs and are never picked there.
- **Speed models start at the step count they're made for.** An
  SDXL-Lightning, Qwen-Image Lightning or MiniMax H3 Turbo file with its step
  count in the name (like `4step`) runs at exactly that many steps. DMD2 starts
  at 4 steps, H3 Turbo at 8.
- **MiniMax H3 clips start at 5 seconds** (124 frames), the shortest length
  it's trained for, instead of 2.3 seconds.
- **HunyuanVideo 1.5 runs with Tencent's settings.** The shift follows the
  model (5 at 480p, 9 for 720p text to video, 7 for 720p image to video), the
  CFG-distilled models take the 50 steps they need for a clean result, and
  text to video starts at 121 frames. A 4-step lightx2v file runs as Fast.
- **Anima Turbo runs as Turbo:** 10 steps at CFG 1, as its card says, instead
  of 30 steps at CFG 4. Other Anima files start on er_sde, the card's sampler.
- **HiDream no longer makes black images with Flux's CLIP-L.** It takes only
  its own CLIP-L and CLIP-G, and offers their download when they're missing.
  Dev and Fast hide the negative prompt, which has no effect at their CFG 1.
- **SDXL merges named "Pony v7" stay SDXL** on a ComfyUI on another computer,
  where only the file name can tell. Only Pony V7 itself runs as AuraFlow.
- **SD 2.x base models start at 512**, the size they're made for.

## [0.13.0] - 2026-09-28

> Model fixes, plainer wording and wide images

### Added
- **Wide images take two columns** (Settings › General › Layout, off for
  now): landscape images span two gallery columns when there are three or
  more, so they show about as large as portraits.

### Changed
- **Workflow import is no longer beta.**
- **Recent prompts can be turned off** in Settings › Generation. Off, nothing
  new is kept and the recent ones are forgotten; starred prompts stay.
- **The model menu offers starter models only while there are none.** Once a
  model is installed, "Get more models" no longer shows.
- **LoRAs come right after Basics** in the sidebar, and right after the model
  in the phone's Advanced settings, where they're easier to reach.

### Fixed
- **Model settings work as they did before 0.12.0.** A renamed Krea 2,
  Z-Image or Klein fine-tune runs as Turbo or Distilled again unless its name
  says base or raw, stacking a speed LoRA no longer changes steps, CFG,
  sampler and scheduler, and img2img starts at 0.65 for every model.
- **The sidebar and other glass stay readable over the video gallery on
  Windows**, where Chrome can hand playing videos to a layer the blur can't
  reach.
- **Pixel glyphs no longer show a faint grid on Windows screens.** The toast
  marks, the update and upscale arrows and the plug draw their cells edge to
  edge where a screen is too coarse for the fine gaps between them.

## [0.12.0] - 2026-09-28

> An easy first run, prompt history, search and safer sharing

### What changes when you update
- **Phones and other computers sign in once more.** Set a studio password in
  Settings › Connection; until you do, the Hidden password still works.
- **Admin from other devices is off** until you turn on Trust other devices
  with admin at the computer running HEISS UI.
- **HEISS UI keeps a copy of its data first**, in `data/.backups/`, so going
  back to 0.11 works (see [the troubleshooting guide](docs/guides/TROUBLESHOOTING.md)).

### Security
- **Other websites can't drive HEISS UI any more.** Every request must name
  a known host, and anything that changes something must come from the
  studio's own page. Before, a page open in the same browser could clear the
  gallery or shut the server down.
- **Requests through a proxy or tunnel count as another device**, so Caddy,
  `tailscale serve` or `cloudflared` no longer hand out this computer's rights.
- **Trust other devices with admin** is a new switch in Settings › Connection,
  off by default. Updates, installs, the output folder, clearing the gallery
  and model downloads are then done at this computer only. The switch itself,
  the Hidden and studio passwords, HTTPS and sign-out-all never leave it.
- **Other devices sign in with a studio password** of their own, shown with a
  QR code per address. Sessions last 7 days, **Sign out all devices** ends
  them, and wrong guesses slow down per address without ever slowing this
  computer. Until you set one, the Hidden password still signs devices in.
- **HTTPS for other devices** with a certificate you already have (for example
  from `tailscale cert`); plain HTTP then answers this computer only.
- **Hiding an image leaves nothing of it in the open**: its thumbnails, the
  copies ComfyUI kept of a reference, and its prompt in the gallery file and
  prompt history go.
- **Updates can be signed.** Releases carry an Ed25519 signature, and once the
  public key is set, unsigned or badly signed updates are refused.
- **Node packs install a reviewed commit** with ComfyUI's PyTorch and numpy
  held in place, and HEISS asks before going around ComfyUI-Manager's
  security level. Model downloads are checked against their published SHA-256
  and resume only while the file is unchanged.
- **Share without settings** removes the prompt and workflow from a shared or
  downloaded image; on for Hidden. Imported workflows say when they contain
  nodes that run code, touch files elsewhere or go online.

### Added
- **Pick a first model.** An empty studio offers Krea 2, Flux.2 and SDXL, each
  in three versions, with the one that suits this computer marked. One tap
  gets the model, its text encoder and VAE, then selects it with a prompt
  ready. "Get more models" in the model menu brings the cards back.
- **HEISS UI finds ComfyUI by itself** on port 8188 or ComfyUI Desktop's 8000,
  and **No ComfyUI yet?** says which one to install.
- **Recent prompts.** Press ↑ in an empty prompt, or the clock beside Negative,
  to search, star and reuse earlier prompts.
- **Search the gallery** with `/` or ⌘F, and **star images** (F in the
  viewer) to find them under Favourites.
- **Earlier images**: add a folder of older ComfyUI, A1111 or Forge images to
  the gallery without copying them.
- **Starter prompts, Surprise me and Vary this** for a quick first run, and a
  `?` overlay with every shortcut.
- **GGUF models** load through ComfyUI-GGUF, which HEISS offers to install.
- **Image-to-video for Wan 2.2 14B and HunyuanVideo 1.5**, and a calm "usually
  about N min here" before a video starts.
- **Every build of a part** with its size and source under "Other versions";
  a gone or gated build falls back to the next. A Hugging Face token, mirror
  and proxy work for downloads.
- **LoRAs say what they were made for**, sort matching ones first and show
  their trigger words.
- **Civitai-ready images (beta)** write A1111-style parameters into new PNGs.
- **Copy image** and **Copy settings** in the viewer.
- **A copy of HEISS UI's data before each update**, kept for 14 days, for
  going back to the version before.
- **Troubleshooting guide**, linked from every failed card, and **Copy
  diagnostics** in Settings › About.

### Changed
- **The model picker is called Model**, with imported graphs under Your
  workflows. Desktop controls use the phone's plain labels, sampling moved to
  Advanced, and **Back to recommended** undoes changes.
- **Failed runs offer the fix**: free memory and retry, retry smaller,
  download again, rescan or install.
- **A ComfyUI that drops for a moment no longer fails the run**; the tile says
  Reconnecting and picks the result up. Cancel only stops HEISS's own runs.
- **Delete all moves images to a trash** you can restore for 30 days.
- **Downloads bring Node.js on every system**, the launcher opens the browser,
  and a taken port moves HEISS UI to the next free one.
- **Large galleries page and save faster**, the app is compressed for phones,
  and the thumbnail cache has a size limit.
- **Speed LoRAs switch to few-step settings**, and img2img strength follows
  each family.

### Fixed
- Nunchaku, NF4 and unrecognised checkpoints no longer look ready and then
  fail; unrecognised ones ask for their type instead of running as SDXL.
- Error toasts stay until dismissed.
- A Git checkout only updates without local changes, and goes back if the
  update doesn't build.

## [0.11.0] - 2026-09-27

> Notes as islands, a floating live run, gentler face detail

### Changed
- **Toasts are islands now.** Notes float in under the download and update
  pills in the same frosted capsule, with a small cell glyph for each kind:
  done, heads-up, failed, removed and plain info. Hover fans the stack out and
  holds every timer; flick one up to dismiss it.
- **Deleting a run of images counts up in one toast** ("4 images deleted")
  instead of stacking a toast per click, and its Undo brings all of them
  back. A ring around the glyph shows how long Undo stays, and the files are
  only removed once the toast is gone. Moving images into or out of Hidden,
  and repeats of the same message, count up the same way.
- **Downloads and updates are activities.** They share one column at the
  top and slide up when one above them leaves. When the work finishes, the
  same island turns into the note ("Smart upscale is ready") and leaves by
  itself, but not while the pointer rests on it.
- **Fewer toasts.** Copy buttons show a check where you clicked instead of a
  toast. Things you can already see no longer get one: a new cover, an
  ungrouped run, a reference image, a saved folder or ComfyUI address, a
  locked Hidden, a new passkey, or a workflow switch loading its defaults.
- **Errors offer the next step** when HEISS UI can take it: Check again,
  Workflows, Try again, See why, Reload. An error stays in front of lighter
  toasts that arrive after it.

### Added
- **A generation you can't see floats at the top.** With the viewer on
  another image, zen on an older one, or the gallery scrolled away, the run
  shows as an island with its live preview, progress and time left; click it
  to go to it. When it finishes it becomes "Image ready" with the result and
  View.

### Fixed
- **The face detail pass no longer ages faces.** It ran on the upscaled image,
  where the model redrew each face at several thousand pixels and baked in
  heavy freckles, pores and wrinkles. It now redraws small faces before the
  upscale, at the model's own size, and leaves close-ups alone.
- **A failed model download is reported once**, in its own island, instead
  of there and in a toast.
- **Images taken out of Hidden go back into the heiss-ui folder** with
  everything else HEISS UI saves, instead of loose in ComfyUI's output
  folder. Their upscales too.
- **Images taken out of Hidden are real outputs again.** They are handed to
  ComfyUI itself, so they land in the output folder ComfyUI actually uses,
  even on another computer, and work as reference images. Before, they were
  written to the folder HEISS UI had on record, which ComfyUI might never see.
- **A Hidden upscale says when ComfyUI's copy stays behind.** Its plaintext
  copy is removed once it is sealed; when HEISS UI can't reach ComfyUI's
  output folder to do that, it now tells you instead of leaving it silently.

## [0.10.0] - 2026-09-27

> Countdowns for runs and restarts, and Flux 2 edits

### Added
- **Flux 2 (Klein 4B, Klein 9B and Dev) edits from reference images**, the
  way ComfyUI's own Flux 2 edit templates do; the first reference frames
  the result. The reference slots show once your ComfyUI has the nodes.
- **Restarting ComfyUI tells you how long it usually takes.** After a few
  restarts that agree, the restart line fills toward your machine's usual
  time and counts down ("Back in about 12 s"). A restart well past it says
  ComfyUI may be installing something rather than counting on.
- **A restart says what it brought.** Once ComfyUI is back, a node pack
  that is new says so ("ComfyUI is back with Impact Pack"), and one that
  failed to load says that instead of turning up later as a missing node.
  Restart timings stay in your data folder and are only used for this.
- **Generations say how long is left.** A running image counts down ("12 s
  left", "About 2 min left") and its bar follows the whole run, loading and
  decoding included, instead of stalling once the steps are done. Queued
  images say when their turn ends. The Generate button's tip says what a run
  takes with your settings ("about 40 s"), and on the phone a run of 45 s or
  more says so before you start. It learns per model from your own runs:
  nothing shows until a model has run three times, and estimates that keep
  missing go quiet.
- **A hint when steps crawl.** If a run's steps are far slower than that
  model's usual, HEISS UI says once that ComfyUI may be short on video memory.

### Changed
- **LoRAs stay when you switch workflows on the same model**, and a
  different model starts from its own last stack (or none) instead of
  carrying LoRAs that don't fit it.
- **Upscale starts from the click.** The ring shows at once; if the upscale
  can't start, the button steps back and says why.
- **The upscale ring is crisp** instead of jagged at its edges.
- **Finished images appear the moment ComfyUI is done**, instead of up to
  1.6 s later.
- **An image's time is how long it took to make**, not counting its wait in
  the queue, on its tile and in the About page's totals.

## [0.9.0] - 2026-09-27

> Qwen-Image 2.1 edits from references, and restarts up front

### Added
- **Qwen-Image 2.1 edits from reference images.** The composer offers its
  reference slots one after another as you fill them; the first reference
  frames the result.
- **Restart ComfyUI or HEISS UI from the top of Settings › General.** Each
  tile shows whether it's running, spins while restarting and lands on a
  check when it's back.

### Fixed
- **Qwen-Image 2.1 files are recognized** from their weights instead of
  showing as an unknown model. Any file whose weights match no known model
  now falls back to its name before being called unknown.
- **Face-detail upscales of images from imported workflows work.** They were
  rejected every time. When an upscale fails after it started, the upscale
  button now says why instead of failing silently.

### Changed
- **An upscaled image is used upscaled.** Using it as a reference or start
  image (from the viewer, the reference picker or a drop) now hands the
  workflow its upscaled pixels, scaled back to the original's size so a run
  takes no longer than before. Switch the upscale off in the viewer and the
  next run uses the original again.
- **Each download has only its own launcher:** **Start HEISS UI.bat** on
  Windows, **.command** on macOS and a new **Start HEISS UI.sh** on Linux.
  Updating removes the ones for other systems. The release notes now say
  which zip is which.
- **Downloads in the workflow picker** keep their buttons beside the name,
  like the sidebar's, instead of always on a line of their own.

## [0.8.2] - 2026-09-27

> Finished images stay put, and the grid reads newest first

### Fixed
- **Finished images no longer vanish.** Deleting your newest image while
  another was generating let ComfyUI give the new one the deleted file's
  name, and the new image disappeared the moment it finished. A new image
  also went missing from any list built in the second after it was saved.
- **New images show up in the reference picker right away**, not only
  after a reload.
- **The grid reads newest first, top left**, the same before and after a
  reload, instead of new runs landing in scattered columns. While your
  pointer is over the grid, new results wait to reflow so nothing slides
  out from under it.
- **Deleting reflows the grid**: the tiles after a deleted one move up to
  fill the space, so columns stay even.

## [0.8.1] - 2026-09-27

> Updates show up right away, and Hidden keeps clear of tiles

### Fixed
- **The update pill no longer waits for ComfyUI.** While ComfyUI wasn't
  answering (HEISS UI started first, or ComfyUI was restarting), a new
  version stayed unannounced until ComfyUI connected or Settings was opened.
  HEISS UI now asks for the latest version as it starts, so the pill is
  there within a couple of seconds, and Settings › About no longer changes
  shape a moment after it opens.
- **The update pill sums up the release** in a line written for it, instead
  of quoting whichever change happened to come first.
- **The Hidden bar no longer covers the first row.** In Hidden, the gallery
  starts below the bar, so a tile's quick actions are never under it, and
  the zen strip keeps clear of it.

## [0.8.0] - 2026-09-27

### Added
- **A model's setup ends with a ready moment.** Parts that land stay in the
  list, ticked "In place", and the last one turns the panel into "<model> is
  ready". A ComfyUI restart halfway through keeps your progress.
- **Imported workflows offer their missing files.** A file HEISS UI knows
  gets a Download button; the rest say which folder they belong in.
- **Setup demo for contributors:** `npm run dev:setup-demo` runs against a
  pretend ComfyUI that lacks encoders, VAEs, a partner model and a node pack,
  with simulated downloads, so every missing-parts flow can be tried on any
  machine.

### Changed
- **Progress says what's happening.** Only sampler steps count as steps
  ("Step 1/2"); everything else is named: "Loading model", "Encoding image
  68%", "Upscaling". A tiled encode no longer shows as "Step 241/357".
- **Failed generations read calmly.** The tile shows a centred mark, a title
  and one line, with a **How to fix** pill that opens the full explanation.
  A damaged model file says which part and file it is ("The VAE file is
  damaged"); node, exception and raw error sit behind **Show details**.
- **An unready model leads to its setup.** A blocked Generate opens that
  model's setup, and the model menu and phone list say what each one lacks.

### Fixed
- **Downloads tell the truth.** A dropped connection retries by itself three
  times, then says so plainly. A gated file links to its Hugging Face page
  instead of offering a Retry that can't work. "Get all" adds up real sizes,
  and an outdated ComfyUI is listed first and blocks it. Wan 2.2's low-noise
  half can be downloaded.
- **Workflow cards keep up with finished downloads** instead of lagging a
  scan behind.
- **Hidden images stay out of the reference picker's Generations.** They have
  a **Hidden** shelf of their own next to Generations and Uploads, behind the
  same lock as Hidden: locked, it offers **Unlock** (Touch ID where set up)
  without leaving what you're doing. Anything made from a hidden image still
  goes to Hidden.

## [0.7.5] - 2026-09-27

### Added
- **A new version offers itself, once.** A small pill slides in at the top
  with what's new and an **Update** button. It downloads while you keep
  working, then **Restart** switches over in a few seconds; while something
  is generating it can wait and restart when that's done. "Later" puts that
  version away on every device. It only asks GitHub every few hours, stays
  quiet when you're offline, never interrupts a generation or Hidden, and
  **Settings › About › Check automatically** turns it off completely.

## [0.7.4] - 2026-09-27

### Fixed
- **iPhone haptics now actually tick.** iOS 26.5 stopped web pages from
  ticking from script, so the tap itself now lands on a hidden system switch:
  Generate, All/None, Select several, Compare, Delete and picking images
  while selecting. Long press and "image ready" stay silent on iPhone.
- **Update and restart from another PC again.** With LAN mode on, a trusted
  computer on your local network can once more install updates, restart
  ComfyUI and HEISS UI, and manage models, nodes, folders and workflows, as
  before 0.7.1. Creating or erasing the Hidden password still happens on
  the computer HEISS UI runs on.
- **Windows: finishing an image no longer crashes the browser.** With the
  mosaic preview on, the WebGL effect that resolved a finished image took
  the whole browser down. Windows now sharpens the image out of the mosaic
  without WebGL. On other systems, if the browser ever goes down while the
  WebGL mosaic runs, HEISS UI notices on the next load and switches that
  browser to the same safe reveal.

## [0.7.3] - 2026-09-25

### Added
- **Haptics on iPhone too.** Safari on iOS 18 and later now gives a light
  tick on the same taps that vibrate on Android (one kind of tick only; iOS
  has no patterns for web pages).

## [0.7.2] - 2026-09-24

### Fixed
- **Images vanished after switching layout.** Going from the phone studio to
  the full studio (or back, or into Hidden) left the gallery drawing no tiles
  until something else redrew it, so fresh images looked missing. The gallery
  now finds its scroll area from where it sits instead of a reference that
  still pointed at the previous layout.
- Demo mode reports ComfyUI as connected, so it can generate its placeholder
  images again.

## [0.7.1] - 2026-09-24

### Added
- **Select several on the phone.** Long press › "Select several", then tap
  more images and Save, Hide or Delete them together (one question, one
  Undo). All/None and Back work as expected.
- **Progress while you browse.** A ring around the phone's Generate button
  fills as images render, the pill says which step they are on, and a small
  "Ready" card slides up when a result lands, tap to open.
- **Haptic feedback on Android phones:** a tick on Generate and selecting, a
  firmer one on long press, a double pulse when an image is ready, and a
  warning buzz on delete. (iPhones do not let web pages vibrate.)

### Changed
- The phone's Advanced sheet is its own layout: Image/Video, sampler and
  scheduler as native pickers, prompt strength and denoise as sliders with
  plain-language ends, a numeric seed field, size and video sliders, model
  parts, and LoRAs with bigger controls.
- Shared dialogs come up as bottom sheets on the phone (confirmations, the
  Hidden unlock, failure details), the viewer gets Compare for upscaled images
  and shows upscale notices above its bar, and Info moved to the top corner.

### Fixed
- **No way back to the phone studio.** After "Use the full studio" the only
  return was a Settings switch that showed only when the screen was narrow
  enough, so a phone held sideways (or a large one) had none. The full studio
  on a phone now shows a "Simple view" chip above the dock, the Settings
  switch stays once you have left, and phones are recognised in landscape too.
- **The phone's steps slider ran from 1 to 10,000.** It took the workflow's
  technical limit (ComfyUI's maximum). The range is now built around the
  workflow's default (a 4-step turbo model gets 1–24, a 20-step one 1–60),
  and a "Workflow default" chip puts it back in one tap.

## [0.7.0] - 2026-09-24

### Added
- **A phone studio.** On a phone, HEISS UI is now its own simplified app
  for making, browsing and sharing, laid out for your thumb: a slim top bar,
  the gallery edge to edge, and one "Describe…" pill that opens a full-height
  create sheet (prompt, reference image, workflow, shape, number of images,
  steps, and Advanced one link away). Pickers are bottom sheets you swipe
  away; tiles open on tap and show Share, Upscale, Make another, Hide and
  Delete on a long press; the viewer has a labelled action bar. Share hands
  the file to the phone's share sheet where the page allows it (HTTPS),
  otherwise it saves the file. Added to the home screen it opens full-screen.
  "Use the full studio" in More (and a switch in Settings) goes back to the
  complete layout; `?phone=1` shows the phone studio on any screen.

### Changed
- **Looking after the computer happens at the computer.** Model folders and
  downloads, node installs, ComfyUI's address and restarts, the output
  folder, updates, workflow import and delete, deleting every image, clearing
  the cache and changing the Hidden password are refused from other devices
  on the network, and the app hides them there instead of offering them.

### Changed
- **Restarting ComfyUI looks like restarting, not like a crash.** While a
  restart HEISS asked for is under way, the Generate button says
  "Restarting…", the status dot turns amber and pulses, the empty stage,
  Settings, restart buttons, workflow checks, Hidden setup and folder setup
  all say ComfyUI is restarting, and the studio checks every 1.5 seconds so it
  picks ComfyUI up the moment it is back. The server keeps the state, so
  every tab and device agrees. If ComfyUI has not returned after two and a
  half minutes, everything goes back to normal reconnecting with one message
  saying so.

### Fixed
- **GGUF models in `models/unet_gguf` kept being offered as "not read".**
  HEISS added that folder under ComfyUI-GGUF's `unet_gguf` name, which the
  pack replaces with the diffusion model folders when it loads, so ComfyUI
  never saw it and the prompt came back after every restart. Such folders
  are now added as diffusion models (which the GGUF loader inherits), and an
  entry written the old way is corrected the next time you press Add. When
  the folder is ComfyUI's own, the dialog says only its subfolder is new.

## [0.6.0] - 2026-09-24

### Added
- **Works on a phone.** The viewer closes with a corner button, a swipe down,
  a tap beside the picture or Back, and swipes sideways between images. The
  workflow menu, composer settings and tile actions all fit and stay on
  screen; the composer rides above the keyboard; controls clear notches and
  are big enough for a finger; landscape phones get a layout of their own.
- **The ComfyUI address is a setting.** Settings › Connection tests and saves
  it (ComfyUI Desktop on port 8000 no longer needs `.env` edits), and the
  offline screen shows where it is looking.
- **Other devices, explained.** Settings shows whether the studio listens on
  the network, every address to open, and how to turn it on. A phone that
  connects before Hidden is set up is told to finish setup on the computer.
- **Seeds are recorded,** so "Apply these settings" makes the same image
  again. A fixed seed shows as a chip in the composer, one tap from random.
- **Undo** for deletes (six seconds before the file goes), for moving to
  Hidden and for "Apply these settings".
- A **Models** section in Settings, a **keyboard shortcuts** list, arrow keys
  through the gallery, a "(n)" in the tab title when runs finish in the
  background, and a one-click install for the face detail pass's nodes.

### Changed
- **Deleting says what it does.** Deletes and "Delete all finished images"
  (was "Clear gallery") state that files leave the disk; anything permanent
  asks even with confirmations off; Backspace no longer deletes.
- Setup explains itself: missing workflow files are named with the folder
  they go in, downloads check free space and name full disks and gated files,
  Manager 4 gets its own install steps, Restart ComfyUI asks when work would
  stop, and Hidden can be set up while ComfyUI is offline.
- Keyboard and screen readers: the viewer is a proper dialog, the closed
  sidebar leaves the tab order, pickers, steppers and tabs follow the arrow
  keys, and generation progress is announced.

### Fixed
- Clicking just beside a tile's Delete button opened the viewer instead.
- Tiles no longer reshuffle between columns when a new result lands.
- One dropped request no longer marks every running generation as failed.
- A failed delete no longer vanishes from the screen; Stop only removes a
  tile once ComfyUI confirmed it.
- Model setup now notices a ComfyUI on another computer before a download
  is tried.

## [0.5.3] - 2026-09-24

### Changed
- **Downloads come with everything they need.** Each release has a zip per
  system (`-windows-x64`, `-macos-arm64`, `-linux-x64`) with its packages
  already inside, so the first start no longer runs an npm install; only
  Node.js has to be installed. Unpacked on the wrong system, it fetches the
  one piece that differs. In-app updates keep using the small zip.
- **The Windows download brings its own Node.js** (the current LTS, from
  nodejs.org, checked against its published checksums), so a Windows PC
  needs nothing installed besides ComfyUI. The launcher uses it and falls
  back to a Node.js on PATH. When a release wants a newer Node.js, the
  in-app update fetches it next to the old one and switches over once the
  new version has started.
- Updates no longer reinstall packages when only the version number in the
  lockfile changed.

## [0.5.2] - 2026-09-24

### Changed
- **The model menu stays manageable with many models.** It scrolls inside a
  capped height with "Find more models" pinned below, gets a search field
  once there are more than eight models, and splits into Favorites (star any
  model), Recent and the rest grouped by family. Arrow keys and Enter pick,
  and typing searches. Picking a model in the composer now counts as recent
  too.

### Fixed
- Leaving Hidden no longer flashes the loading mosaic over the gallery; the
  gallery comes straight back and syncs behind it.

## [0.5.1] - 2026-09-24

### Added
- Four more model families run out of the box, with the settings from
  Comfy-Org's own workflows: **Ideogram 4** (main and unconditional model
  paired automatically; its Turbo, Default and Quality schedules follow the
  step count), **MageFlow** and **ERNIE-Image** (each with its Turbo
  variant), and **Lumina Image 2.0** including the Neta Lumina and NetaYume
  anime fine-tunes, which get the system prompt they were trained with.
  Missing text encoders, VAEs and Ideogram's unconditional model can be
  downloaded from the setup panel.

### Fixed
- Sana no longer shows up when you have no Sana weights: the "install a
  node pack" placeholder is gone, and ExtraModels presets only list once
  they are downloaded to `models/sana`. Sana runs through ExtraModels no
  longer fail with "'EmptySanaLatentImage' object has no attribute
  'device'" on current ComfyUI.
- Restart ComfyUI said ComfyUI-Manager was missing with the Manager custom
  node 3.4x, which only restarts on a POST.
- Install buttons for custom nodes now work through the ComfyUI-Manager
  custom node (3.x) too, not only the Manager built into newer ComfyUI.
- Adding model folders could report "models ready" before ComfyUI read
  them, when the added folder sat inside one ComfyUI already reads (its own
  `models` folder). It now waits until every added folder is read, so the
  models no longer stay listed as found afterwards.
- A model's setup card in the sidebar was cut off with a node install
  open; it now scrolls.

## [0.5.0] - 2026-09-24

### Added
- Hidden replaces Private Vault. It is a place, not a switch: open it from
  the lock in the dock, generate straight into it, or hide any finished
  image with the eye on its tile and bring it back the same way. Upscale,
  compare, remix and reuse all work inside it. It unlocks with Touch ID or
  Windows Hello as well as the password, shows nothing at all while locked,
  and locks itself after a while untouched. Setup waits for ComfyUI, then
  walks through password and biometrics with its own animated hero; Settings
  manages passkeys, the password, auto-lock, export, an encrypted backup and
  a full erase.

### Changed
- The Hidden password no longer touches the normal gallery: prompts are
  stored as before, generating never waits for an unlock, and prompts sealed
  by the old scheme open back up on the first unlock. Existing Private Vault
  items and passwords carry over as they are.
- HEISS UI now points you at `localhost` instead of `127.0.0.1`: the same
  server, but browsers only allow Touch ID and Windows Hello on a name.
- Hidden's setup, lock screen and settings use shorter, plainer copy, and
  the website describes Hidden instead of Private Vault.
- Moving into or out of Hidden is a short fade instead of the pixel curtain,
  which showed the gallery through it as a grid. The lock screen and empty
  Hidden use a quieter lock mark, and unlocking is quicker.
- **A faster gallery, especially a large one.** Thumbnails of images on this
  computer come straight from their cache instead of downloading the full
  image from ComfyUI each time, and loading a page no longer checks every
  image's file one by one. The app no longer reloads or redraws the gallery
  while nothing changes, pauses its checks while the tab is in the
  background, and typing in the prompt no longer redraws the gallery,
  sidebar and composer. Generating keeps the server responsive and no
  longer piles up preview frames in memory.
- Stop can now stop a running upscale: the upscale button shows a stop
  square while it runs, and the dock's Stop includes upscales.

### Fixed
- Clearing the gallery while the vault was locked deleted the files and then
  failed without a word.
- Finished private jobs handed out their per-file keys to any caller for
  five minutes.
- ComfyUI kept the full prompt of private runs in its history, and plaintext
  copies of private images used as references in its input folder.
- Private prompts leaked through tile titles and the workflow card's
  thumbnail; a locked session could not delete anything.
- Run grouping only applied once a vault existed.
- With any run grouped, the gallery reloaded itself every few seconds.
- Restarting ComfyUI reported that ComfyUI-Manager was missing with the
  Manager built into current ComfyUI.
- Upscales left running by a server restart spun forever.
- The ComfyUI connected card replayed every time you moved between the
  gallery and Hidden.
- A model folder picked on Windows could not be added when its path came
  back with other casing or as an 8.3 short name.

## [0.4.1] - 2026-09-24

### Changed
- **Shorter, plainer copy throughout the app.** Dropped reassurances nobody
  asked for, lines about the app doing things by itself, and explanations of
  how things work under the hood. Terms are now consistent: HEISS UI (not
  HEISS or "the server"), Private Vault and vault password, Stop for running
  generations, and images instead of "gens". The website and README now match
  the current workflow import, smart upscale and the Settings layout.

### Fixed
- **Windows: the first start of a download works.** It crashed while
  installing its packages (current Node refuses to run `npm.cmd` directly),
  and the launcher window closed before the error could be read. The `.bat`
  now checks for Node and an unpacked folder, and stays open on any error.
  Updating a Git copy from Settings failed the same way.
- Starting HEISS UI a second time said it was ready. It now says the port is
  taken and HEISS UI is probably already running.
- **Windows: sharper pixel art at 125% and 150% display scaling.** The
  generation mosaic, the About wordmark, the update button and the other cell
  canvases draw on whole screen pixels, so cells and gaps stay even. Without
  WebGL the About page shows the logo instead of an empty space.
- Blur was missing on tile buttons, bundle badges and dock chips in Chrome,
  Edge and Firefox.
- Scrolling a panel with a mouse wheel changed any number field under the
  pointer. Fields now only react to the wheel while focused.
- Thin scrollbars everywhere; the gallery's no longer hides under the bottom
  fade or pushes the gallery off centre. Sideways strips (zen thumbnails,
  workflow filters) scroll with a normal wheel, and viewer zoom follows how
  far the wheel or touchpad moves.
- Monospace text uses Geist Mono on every system. Long paths are cut at the
  start so the folder name stays visible. Windows High Contrast shows
  switches, buttons and focus.
- AltGr characters start typing into the prompt; confirming an IME word no
  longer generates; an image dropped outside a drop zone no longer opens in
  the tab.
- **Windows: model folders.** Paths are compared regardless of letter case,
  a disconnected network drive no longer freezes HEISS UI during the scan,
  `extra_model_paths.yaml` saved with Windows line endings is still
  recognised, and `C:\ComfyUI_windows_portable` is found.
- Installing node packs into the portable ComfyUI's Python no longer skips
  packages that are only installed in your user Python.
- Downloads, thumbnails, the vault and updates retry when antivirus or
  indexing briefly holds a file. A download stuck at 100% finishes, and an
  update that cannot put a folder back says where it left it and retries on
  the next start.
- With ComfyUI stopped, images load from disk straight away instead of
  after a two-second wait each. An output folder at a drive root works.
- A missing or blocked image library no longer stops HEISS UI from starting;
  thumbnails fall back to the full image.

## [0.4.0] - 2026-09-24

### Added
- **Models ComfyUI can't see are found and added in one step.** HEISS looks
  through shared folders, other ComfyUI installs, the ComfyUI Desktop app,
  Stability Matrix, A1111 and external drives for models in folders ComfyUI
  does not read. It says what it found in the sidebar, the model menu and
  Settings. One click adds the folders to ComfyUI's `extra_model_paths.yaml`
  (backed up, in a marked section Settings can remove again), restarts
  ComfyUI and confirms the models arrived.
- **Custom nodes install with one click.** Models that need a custom node
  pack say so in the sidebar and the workflow library, with an Install
  button. Packs in ComfyUI-Manager's list are installed through Manager; the
  rest are cloned and set up with ComfyUI's own Python when ComfyUI runs on
  this computer. Smart upscale's SeedVR2 setup uses the same button, and the
  manual steps stay available for a ComfyUI on another machine.
- Sana also runs through ComfyUI-SANA (diffusers, works on Apple Silicon):
  Sana folders in `models/diffusers` show up as ready models, next to the
  ComfyUI_ExtraModels route for CUDA.
- ComfyUI coming back is picked up without a reload. With an empty gallery
  the offline plug snaps into its socket and the scene dissolves into the
  empty state; with images on screen a small "ComfyUI connected" card slides
  in and out. Models, workflows and smart upscale refresh by themselves.
- A new empty state for a gallery with nothing in it yet: a blank pixel
  canvas where a picture keeps developing and fading.
- [The model guide](docs/guides/MODELS.md) documents how a new model family, and the custom nodes, text
  encoders or VAEs it needs, gets added.

### Fixed
- With ComfyUI stopped or restarting, every image in the gallery broke,
  because images were only ever fetched through ComfyUI. They now open from
  the output folder, and thumbnails from HEISS's own cache.
- A finished image whose file would not load (moved, deleted, ComfyUI
  unreachable) showed the browser's broken-image icon with "Untitled prompt"
  over the tile. It now shows the tile's unavailable state, and every image
  with a source that can go missing falls back the same way.
- The offline screen restarted its animation every five seconds while HEISS
  checked ComfyUI again, and a first start flashed the empty state before it
  knew ComfyUI was offline. Both now hold steady until the answer changes.
- Retry connection (and the composer's ComfyUI offline button) say
  "Checking…" with a spinning icon while they ask ComfyUI again.

## [0.3.1] - 2026-09-24

### Added
- One-click updates for downloaded releases. **Install update** in
  Settings › About downloads the new release, checks it against its
  published SHA-256 and swaps it in on **Restart now**, then reloads the page.
  The data folder, `.env` and installed packages are never touched. The
  previous version is kept, and a new version that does not start is rolled
  back by itself, with a note in Settings saying so. Copies from 0.3.0 and
  earlier need one manual download to get this.

## [0.3.0] - 2026-09-24

### Added
- NVIDIA Sana runs built in. With the ComfyUI_ExtraModels custom nodes
  installed, SANA 1.5 (1.6B, 4.8B), SANA Sprint, the 2K/4K models and the
  multilingual model show up as ready models; ComfyUI fetches the weights,
  the Gemma 2 2B text encoder and the DC-AE VAE on first use. Sana files in
  `checkpoints/` are recognised from their weights, and without the nodes
  HEISS says which pack to install.

### Changed
- The ComfyUI offline screen shows an animated pixel plug that keeps trying
  to reach its socket, in the same cell style as the wordmark. It pauses when
  hidden, holds still for reduced motion and falls back to the logo without
  WebGL.
- Starting HEISS UI in a terminal shows the wordmark as a dot mosaic with an
  ember glow, plus the version and where to open it. It adapts to the
  terminal: Braille dots or half blocks, true colour, 256 colours or none.

### Fixed
- With ComfyUI offline, HEISS pretended to work: it listed fake "(Demo)"
  models and "generated" placeholder images. It now shows ComfyUI as offline
  and refuses to generate. Demo mode is a developer opt-in
  (`npm run dev:demo` or `HEISS_DEMO=1`) for testing without a GPU.
- A generate request ComfyUI would reject (a missing model, a bad slot)
  quietly became a placeholder image instead of an error.
- When an upscale effort ran on a different SeedVR2 weight because its own
  was not downloaded, Settings still just said Ready. It now says it is
  running on a fallback, names the weight, and offers the download again.
- With no models, the model picker opened an empty popover. It now says why
  there is nothing to choose.

## [0.2.1] - 2026-09-24

### Added
- **Restart ComfyUI** from Settings, and wherever a setup step ends in a
  restart, when ComfyUI-Manager is installed. If the control is off, it says
  why (no Manager, or a HEISS server too old for it).
- Failed generations explain themselves: the tile shows a plain title and a
  hint, and the viewer shows the full error with a report you can copy.

### Changed
- Model file setup lands files in the folders ComfyUI actually reads from,
  resumes a stopped download (even after a restart), shows progress in a pill
  at the top, and uses the same panel in the workflow gallery.
- Models that can only redraw a picture (Krea 2, SDXL, Flux, Z-Image and the
  other built-in image models) now offer **Add start image** instead of Add
  reference, and a Change slider next to the image sets how much it may change.

### Fixed
- Models, text encoders and VAEs in folders added through ComfyUI's
  `extra_model_paths.yaml` (a shared model drive, an A1111 install) were
  never read, so HEISS could not tell what they were. It now reads every
  folder ComfyUI loads from.
- A reference image added to a built-in model was ignored, even at 0%
  change. The composer could show a reference restored from a draft or a
  model switch that it then never sent; it now sends what it shows, and the
  server accepts a bare image id too.
- The workflow menu showed the gallery through its top half instead of frosted
  glass, and the Add reference chip clashed with prompt text running under it.
- Generation time stuck at 0s when the browser's and the server's clocks
  disagreed. It now counts on the server's clock.
- A run that saved nothing deleted its tile; it now stays as a failure.
- Deleting from the gallery no longer shows a toast; only a failed delete does.
- Installing an update no longer shows "Could not reach HEISS UI" while the
  server restarts, unless LoRA edits are really waiting to sync, and the app
  now confirms when the update landed.

## [0.2.0] - 2026-09-23

The first tagged release of HEISS UI, a local studio for ComfyUI, built on
[J-AI Studio](https://github.com/jasperdevs/J-AI-Studio) by jasperdevs. These
notes cover everything that changed since the fork.

### Highlights

- **Drop in a model and go.** HEISS reads each model file's weights to tell what
  it is: 16 image and 5 video families, from SD 1.5 to Krea 2, Wan 2.2 and
  MiniMax H3. It uses the settings the model's makers recommend and pairs it with
  a matching text encoder and VAE, or downloads one for you.
- **Smart upscale.** One click on a finished image runs SeedVR2 at Fast,
  Balanced or High effort, with an optional face pass and a before/after slider.
  A guided setup installs everything it needs.
- **LoRAs.** A searchable library grouped by folder, stacks saved per
  model family, favorites, recents, drag to reorder and undo.
- **Private Vault.** Encrypt chosen generations, their prompts and settings
  behind a password.
- **Prebuilt downloads.** Unzip, double-click Start HEISS UI, done: about 30 MB
  of runtime packages, no build step.

### Added

#### Models
- 21 model families recognised from the weights: SD 1.5, SD 2.x, SDXL (Pony,
  Illustrious/NoobAI, v-pred, Lightning, DMD2, Hyper, Turbo), Pony V7, SD 3.5,
  Flux.1 (dev, schnell, de-distilled), Flux.2 Dev and Klein 4B/9B, Chroma,
  HiDream, Qwen-Image (incl. 2512 and 2.1), Z-Image, Krea 2, Anima, Wan 2.1,
  Wan 2.2 5B, the Wan 2.2 14B high/low-noise pair, HunyuanVideo 1.5 and
  MiniMax H3.
- Each family runs with the settings from its official templates and model
  cards, including Turbo/Base and Raw variants, clip skip for Pony and
  Illustrious, and v-prediction for NoobAI merges.
- All-in-one checkpoints and model-only files both work. HEISS sees which parts
  a checkpoint carries and fills the rest from compatible installed files,
  preferring abliterated text encoders.
- Missing text encoders or VAEs are named with a one-click download into
  ComfyUI's folders.
- One text encoder picker per slot, and a "Built into the checkpoint" VAE option.
- A "Use as" picker in Settings for files HEISS can't identify, including the
  variant.

#### Smart upscale
- SeedVR2 upscaling from any finished image at Fast, Balanced or High effort,
  with an optional face detail pass. The original is always kept.
- A compare slider in the viewer: drag, double-click to centre, or use the arrow
  keys. Zoom and pan keep working while comparing.
- A guided setup: install the nodes through ComfyUI Manager or one terminal
  command (macOS, Linux, PowerShell, Command Prompt), download the model with
  resume and checksum checks, then upscale the image you clicked.
- A download widget with percent, speed and time left while setup runs.
- A popover that says why an image can't be upscaled.

#### LoRAs
- A LoRA library grouped by nested folders, with search, favorites, recents and
  suggestions for the current model family.
- Stacks saved per model family, shown as chips; one click loads a stack.
- Cards with an on/off switch, a strength slider, drag-to-reorder (keyboard too)
  and remove with undo, plus All off and Clear.
- Warnings for LoRAs missing from ComfyUI or past a workflow's limit.

#### Reference and start images
- A reference library in the composer with an Uploads tab and pointer-aware
  drops; the chosen image survives a reload.
- Workflows can let a reference image set the output size and aspect.
- A bundled Flux 2 image-edit workflow.

#### Workflows
- A thumbnail workflow gallery with search, an image/video switch, favorites,
  filters and a detail panel listing missing nodes.
- Two-step import that previews name, type, family, status and control mapping
  before saving. Drop JSON files anywhere on the gallery.

#### Studio
- Private Vault: password-protected, encrypted storage for chosen generations
  and their prompts and settings, with backup export.
- An About page with version, update check, credits and local stats: outputs,
  render time, megapixels, streaks and most-used workflow.
- Output folder tools: Browse, automatic detection and live checking.
- Gallery bundles that group runs.
- A clear offline state with Retry, and deep links from errors to the right
  settings.
- Better layout on phones and in Safari.

### Changed

- Rebranded to HEISS UI, with a new website, mark and wordmark. Settings saved
  under the old J-AI names are still read.
- The studio is rebuilt around the generation composer: no top bar, a compact
  dock, and one frosted glass, control size and radius throughout.
- Every dialog uses one modal; settings live in seven sections (General,
  Generation, Upscale, Library, Privacy, Connection, About).
- Generation previews resolve from a pixel mosaic and show step and elapsed time.
- Gallery thumbnails are small WebP images, about 20 times lighter.
- Geist replaces Inter; the ember accent now only marks status and heat.
- Toasts appear top centre and above dialogs.
- Picking a workflow of the other type switches between image and video.
- Escape leaves zen mode once nothing else is open.

### Fixed

- Generating and saving LoRA stacks over plain-HTTP LAN failed.
- LoRA edits could overwrite each other across devices or be lost offline.
- A crash could wipe settings; files are now written atomically with a backup.
- A wrong output folder silently hid generations.
- FLUX.1 Krea was mistaken for Krea 2, and renamed fine-tunes went unrecognised.
- Toasts, dropdowns and tooltips sat under dialogs.
- The gallery flashed as every tile replayed its new-image animation.
- Offline workflow checks reported every node as missing.
- Built-in workflows could be deleted.
- Many smaller LoRA, upscale and layout issues.

### Removed

- The top bar and logo.
- The Workflows tab in Settings (moved into Library).
- The DarkBeast example workflow.
- Unused icon libraries and packages: the install is less than half the size.

### Under the hood

- Runtime needs only express, busboy and sharp: 32 MB for a release install,
  down from 563 MB of `node_modules`.
- `npm start` builds and repairs itself on first run.
- One graph builder for every model family.
- Semantic versioning, a changelog and `npm run release`; tagging publishes the
  download.
- 56 automated tests, run in CI.

## [0.1.0]

The baseline HEISS UI grew from, forked from
[J-AI Studio](https://github.com/jasperdevs/J-AI-Studio). Never tagged.

[Unreleased]: https://github.com/maxexcloo/studio/compare/v0.41.0...HEAD
[0.41.0]: https://github.com/maxexcloo/studio/compare/v0.40.1...v0.41.0
[0.40.1]: https://github.com/maxexcloo/studio/compare/v0.40.0...v0.40.1
[0.40.0]: https://github.com/maxexcloo/studio/compare/v0.39.0...v0.40.0
[0.39.0]: https://github.com/maxexcloo/studio/compare/v0.38.0...v0.39.0
[0.38.0]: https://github.com/maxexcloo/studio/compare/v0.37.0...v0.38.0
[0.37.0]: https://github.com/maxexcloo/studio/compare/v0.36.0...v0.37.0
[0.36.0]: https://github.com/maxexcloo/studio/compare/v0.35.0...v0.36.0
[0.35.0]: https://github.com/maxexcloo/studio/compare/v0.34.3...v0.35.0
[0.34.3]: https://github.com/maxexcloo/studio/compare/v0.34.2...v0.34.3
[0.34.2]: https://github.com/maxexcloo/studio/compare/v0.34.1...v0.34.2
[0.34.1]: https://github.com/maxexcloo/studio/compare/v0.34.0...v0.34.1
[0.34.0]: https://github.com/maxexcloo/studio/compare/v0.33.1...v0.34.0
[0.33.1]: https://github.com/maxexcloo/studio/compare/v0.33.0...v0.33.1
[0.33.0]: https://github.com/maxexcloo/studio/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/maxexcloo/studio/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/maxexcloo/studio/compare/v0.30.2...v0.31.0
[0.30.2]: https://github.com/maxexcloo/studio/compare/v0.30.1...v0.30.2
[0.30.1]: https://github.com/maxexcloo/studio/compare/v0.30.0...v0.30.1
[0.30.0]: https://github.com/maxexcloo/studio/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/maxexcloo/studio/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/maxexcloo/studio/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/maxexcloo/studio/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/maxexcloo/studio/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/maxexcloo/studio/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/maxexcloo/studio/compare/v0.23.1...v0.24.0
[0.23.1]: https://github.com/maxexcloo/studio/compare/v0.23.0...v0.23.1
[0.23.0]: https://github.com/maxexcloo/studio/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/maxexcloo/studio/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/maxexcloo/studio/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/maxexcloo/studio/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/maxexcloo/studio/releases/tag/v0.19.0
[0.18.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/tristmeister/HEISS-UI/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.5...v0.8.0
[0.7.5]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/tristmeister/HEISS-UI/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/tristmeister/HEISS-UI/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/tristmeister/HEISS-UI/releases/tag/v0.2.0
