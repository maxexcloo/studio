# Adding a model

How a new model family gets into Studio so it works out of the box: dropped
into ComfyUI, recognised, set up with the settings its makers ship, and, when
something is missing, explained with a way to get it right in the app.

Everything below is data plus one graph. The sidebar, the workflow library,
the "Use as …" picker, downloads and node-pack installs all read the same
catalog, so a family that is described correctly needs no UI work.

## The pieces

| What                   | Where                                                                                                      | Holds                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Families               | `backend/family-catalog.js` → `families`                                                                   | Label, kind, sources, encoder slots, VAE kinds, latent node, size step, negative mode, sampling style, variants with default settings                                                               |
| Detection              | `family-catalog.js` → `familyFromHeader`, `familyFromName`; `model-families.js` → `familyFromMetadata`     | Tensor-key signatures (mirroring ComfyUI's `comfy/model_detection.py`), filename patterns, safetensors metadata                                                                                     |
| Text encoders and VAEs | `backend/model-components.js` → `encoderKinds`, `vaeKinds`, `encoderKindFromHeader`, `vaeLayoutFromHeader` | What each encoder or VAE file is, by shape first and name second                                                                                                                                    |
| Downloads              | `family-catalog.js` → `encoderDownloads`, `vaeDownloads`                                                   | Hugging Face files the Download buttons fetch. Abliterated builds first wherever a ComfyUI-ready one exists                                                                                         |
| Quantized files        | `family-catalog.js` → `quantFormats`, `quantFromHeader`                                                    | Formats ComfyUI's own loaders cannot read (Nunchaku SVDQuant, bitsandbytes NF4): the loader node that reads each one instead, per model source, or why it cannot run                                |
| Node packs             | `backend/node-packs.js` → `nodePacks`                                                                      | Every custom node pack Studio may ask for: name, Git URL, folder, the node classes that prove it loaded                                                                                             |
| Graph                  | `backend/family-graph.js` → `familyGraph`                                                                  | One builder for every family; special sampling styles branch off it                                                                                                                                 |
| Profiles               | `backend/family-profiles.js`                                                                               | Turns every model file into a runnable profile and lists exactly what is missing                                                                                                                    |
| GGUF                   | `backend/gguf.js`                                                                                          | Reads GGUF headers as safetensors-style headers (so detection needs no GGUF rules), lists GGUF models and encoders, and swaps core loaders for ComfyUI-GGUF's twins in the graph. See [GGUF](#gguf) |

## Recipe

1. **Find the reference workflow.** Prefer Comfy-Org's
   [workflow_templates](https://github.com/Comfy-Org/workflow_templates) (their
   `properties.models` list loaders, settings and download URLs), then the
   model card, then the maker's own ComfyUI workflow. Note loaders, encoders,
   VAE, latent node, sampler, scheduler, steps, CFG, shift and resolution for
   every variant (base, turbo, distilled, 2K, …).

2. **Native or custom nodes?** Search ComfyUI for the model's loader and
   detection (`comfy/model_detection.py`, `comfy/text_encoders/`). If it is
   native, skip to step 4.

3. **Custom nodes: register the pack.** Add it to `nodePacks` in
   `backend/node-packs.js`: `name`, `repository` (a `.git` URL), `folder` (its
   `custom_nodes` folder), `nodes` (classes it must load), and optionally
   `manager` (its id in ComfyUI-Manager's list, from `custom-node-list.json`
   or api.comfy.org), `search` (what finds it there) and `note` (one line
   for the panel). Then point the family at it with `pack: "<id>"`. When a model runs
   on more than one pack (for example one CUDA-only, one that also runs on
   Apple Silicon), describe each as a runner the way `sanaRunners` does, one
   model source per runner. Studio then shows an **Install** button wherever
   the model appears (`backend/pack-installer.js`): packs with a `manager` id
   are queued in ComfyUI-Manager when it answers; otherwise, with ComfyUI on
   this computer, Studio clones the pack and installs its requirements with
   ComfyUI's own Python. Manager 4 cannot install by Git URL (only in its
   legacy UI, behind a config flag), so unlisted packs always take the local
   route. Manual steps (Manager or terminal) stay one tap away and are all a
   remote ComfyUI gets. A pack that ships inside its makers' model repository
   gets `subdir` (its folder there): the one-click route checks the repository
   out outside custom_nodes and copies only that folder in, and the terminal
   steps do the same. `requirements: false` leaves pip out for a pack with no
   requirements.txt.

   When a model runs both on ComfyUI's own nodes and on a pack, give the
   family `runners`: per model source, the pack, its `loader` (one node that
   loads model, encoder and VAE, standing in for the three core loaders),
   `patches` for the model before sampling, the core nodes those need, and
   `folders` when the loader takes a Diffusers folder by path (Studio lists
   matching folders in models/diffusers itself; see `backend/diffusers-folders.js`).
   MOSS-Image is the example: Comfy-Org's single files on core nodes, the
   official folder on its makers' pack.

4. **Describe the family** in `families`. Settings live on variants; the last
   variant is the fallback. `match(name, header, detail)` picks a variant, so
   let the weights decide where they can (see Flux Schnell and Sana Sprint)
   and the filename only where they cannot. A variant's `apple` replaces some
   of its defaults when ComfyUI runs on Apple Silicon, for a setting known to
   break there (Wan's uni_pc sampler corrupts video on MPS, so `apple:
   { sampler: "euler" }`). `stepsFromName: true` takes the steps from a count
   in the file name (`sdxl_lightning_4step` → 4), for variants whose files are
   distilled for exactly that many; the variant's own steps stay the fallback.
   `variantDefaults` applies both.

5. **Teach detection.** Add the tensor-key signature to `familyFromHeader` at
   the same position ComfyUI checks it, so no file is read two ways. Watch for
   keys another family also has (diffusers-format Sana carries LTX-Video's
   `adaln_single` keys). Add a filename pattern to `familyFromName` for remote
   ComfyUIs where headers are out of reach. The pattern also covers local files
   whose weights match no signature yet: those fall back to their name rather
   than showing as unknown.

6. **Encoders and VAE.** Reuse an existing kind where the file is the same.
   Otherwise add the kind (header signature plus name fallback) and at least
   one download. When a model needs its own build of an encoder whose shapes
   others share (HiDream's CLIP-L and CLIP-G), give the slot `only` (a name
   pattern the file must match) and a `detail` that says why: other builds
   are then left out and the part shows as missing with its download. Mark a
   download `fp8: true` when its header carries per-layer
   fp8 quantization (`_quantization_metadata`, `comfy_quant` or `scale_weight`
   keys): ComfyUI keeps those in fp8, which a Mac cannot load, so on a Mac any
   other build of the part is offered first and an fp8 starter never counts as
   fitting. A plain fp8 file (no scales) loads at full precision and stays
   unmarked. Parts that cannot be downloaded as single files (diffusers
   folders, gated repos) get a `command` on their missing entry: a
   copyable shell command, see `diffusersDownloadPlan` in
   `backend/node-install.js`.

7. **Graph.** If the family fits the common path (load, LoRAs, encode,
   KSampler or SamplerCustomAdvanced, decode, save), there is nothing to
   write. Otherwise add a `sampling` style and a branch in `familyGraph`, and
   name every node it uses in `requiredNodes` (or the pack's `nodes`) so an
   older ComfyUI is told to update instead of failing mid-run.

   Two more family fields cover models that need more than one file or a
   fixed preamble. `pair` runs a second model file next to the picked one
   (Wan 2.2's low-noise half, Ideogram 4's unconditional model): it names
   which files are partners and how to find a picked file's partner, hides
   the partner from the model list and offers its download when missing.
   `promptPrefix` and `negativePrefix` put the system prompt a model was
   trained with in front of the user's text (Lumina 2 and its fine-tunes).
   `upsampler` runs a small language model before the encoder, for models
   made to read long captions rather than what people type (FLUX.3): its
   own slot (missing means a Download button like any encoder), its makers'
   system prompts verbatim in `backend/prompt-upsamplers.js`, and the
   TextGenerate settings from their workflow. With reference images it gets
   the edit prompt and sees the images.

   Image-to-video is a family of its own with `imageToVideo: true`: its
   `latent` names the node that takes both conditionings, the VAE and the start
   image (`WanImageToVideo`, `HunyuanVideo15ImageToVideo`), `startImage:
   "required"` makes the composer ask for the picture, and `clipVision` adds a
   vision encoder (with its download) where the template reads the image
   twice. When the weights cannot tell it from its text-to-video sibling,
   `refines` narrows the detected family by name (HunyuanVideo 1.5 I2V).

8. **Capabilities.** Turn off what the model cannot do: `ownLoaders` (encoder
   and VAE come with the pack, so no pickers and no LoRAs), `negative: "none"`,
   no `img2img`. Profiles hide the matching controls. An edit model that reads
   images as guidance sets `references: n`: the composer offers n reference
   slots (each after the one before is filled), the first reference frames the
   output. By default `familyGraph` wires them the `ReferenceLatent` way
   (scale, VAE-encode, chain onto both conditionings, as ComfyUI's Flux 2 edit
   templates do), and the slots only appear when ComfyUI has those core nodes;
   `referenceVia: "encoder"` hands them to an encoder that reads images itself
   (Qwen-Image 2.1's `TextEncodeQwenImage21`).

   Inpainting needs no field of its own. An image family that takes a picture
   in through the shared graph (`img2img` or `references`) can inpaint;
   one with its own sampling style (Ideogram 4, MageFlow, Sana, H3, Wan's
   pair) or `ownLoaders` cannot. `canInpaint` in `backend/family-profiles.js`
   decides, and the model menu shows the result.

   **Guided setup.** A family that runs more than one way can have a setup
   dialog of its own: add it to `guidedSetups` (`backend/family-setup.js`)
   and point the family at it with `setup`. Its setup panel then gets a
   **Guided setup** button. The dialog works out the way from the file you
   have and walks through what that needs; like everything else here, it
   never downloads the model itself.

9. **Tests** in `backend/model-families.test.js`. Cover detection from a
   header, each variant's defaults, what a missing part or pack reports, and
   the graph's nodes and inputs. The fixtures write tiny fake safetensors
   headers, so no weights are needed. `backend/contract.test.js` then builds
   every variant's graph and checks it against the recorded `/object_info`
   snapshots in `backend/fixtures/`: known nodes and inputs, values in their
   lists and ranges, links of the right type, and any node that ComfyUI
   lacks listed in the family's nodes (so it shows "Newer ComfyUI"). When a
   family needs nodes from a newer ComfyUI, record that version too with
   `node backend/commands/record-object-info.mjs` while it runs. A family whose text
   encoder type a snapshot lacks is checked against the newer one only, and
   every family must be checked against at least one.

10. **Check it against a real ComfyUI.** Save `/object_info` and
    `/system_stats`, feed them to `inferModels`, build the graph through
    `sanitizeGenerateBody` and `familyGraph`, and queue it once on `/prompt`.
    Then add a line under **Unreleased** in `CHANGELOG.md`.

## Rules of thumb

- The weights are the first witness. Names lie; fine-tunes get renamed.
- Take settings from the makers, never from memory.
- Never prefer "official" files over community ones; abliterated encoders
  lead wherever they fit.
- Everything a model needs is named in its `missing` list with a way to get
  it: a Download button, node install steps, or a copyable command. A model
  that is not ready never runs.

## Native 2K

`native` on a family (or a variant) declares support for 2K and 4K output.
The size menu offers only entries marked `"yes"`, within the selected model's
dimension limits. Two choices use buttons; more than two use a dropdown.
Models without additional supported native sizes hide the Resolution control.
Custom dimensions and aspect ratios remain available separately.

A selected 2K or 4K resolution draws the chosen shape with its long side at
2048 or 4096 pixels, without an automatic upscale. Entries marked `"maybe"`
record mixed or missing reports and are not offered as supported resolutions.
Megapixel sizing still warns when a requested size exceeds known support.
The upscale arrow (SeedVR2) remains available independently of native support.

Current entries:

- **Nothing:** SD 1.5 and SD 2.x (trained at 512/768, duplicated subjects at
  large sizes are long settled), Sana 512px.
- **2K maybe:** models documented at about 1 MP: SDXL and its finetunes,
  Pony V7/AuraFlow (768-1536), SD 3.5, Flux.1 (BFL: 1.6 MP max), Chroma,
  HiDream, Qwen-Image (1328), Anima, Lumina 2.0, ERNIE-Image, Krea 2 Raw
  (trained up to 1K), Sana 1024 and Sprint. 4K (3-4x past their training) is
  left out.
- **2K yes:** MOSS-Image (its makers document 0.25 to 4 MP and recommend
  1 to 2 MP). 4K is left out.
- **2K yes, 4K maybe:** Flux.2 Dev and Klein (BFL: up to 4 MP), Qwen-Image 2.1
  (native 2K), Z-Image (up to 2048²), Krea 2 Turbo (1K-2K), Ideogram 4 (up to
  2048), MageFlow (512-2048, any aspect), Sana 2K. No hands-on 4K reports.
- **2K and 4K yes:** Sana 4K, FLUX.3 Klein (BFL: up to 4K, best at 2K).

A new family states its own `native`; leaving it out means none.

## Supported families

Studio's runtime profiles define the supported catalogue for a deployment; the ai mount seeds missing definitions. The retained native family detectors and graph builders are defined in `backend/family-catalog.js`; only offer a profile after its required nodes and files are verified on its worker.

Administrators edit profiles in **Settings › Profiles**. The Connections tab maps existing controls and reference inputs to separate node and input choices, preserving the saved graph and other metadata. Use Advanced JSON to add mappings or change the graph; Check validates the edited definition before saving.

## Formats

### GGUF

GGUF workflows require the [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) node pack on the selected worker. Studio reads GGUF headers through `backend/gguf.js`, keeps the existing tensor-family detectors and substitutes the matching GGUF loader nodes. Mixed encoder slots are supported when the worker's loader advertises them.

Architecture support depends on the pinned worker node revision, not the file extension. Verify the worker's node catalogue and required encoder/vision components before offering a GGUF profile. Unsupported loader formats can use a reviewed [custom workflow](backend/workflows/README.md) imported into Studio.

### Worker Memory

`backend/hardware.js` uses the selected worker's `/system_stats` response for its memory estimate; the application container's own RAM is not the GPU budget. CUDA-style device reports also include ROCm workers. CPU and placeholder device values do not establish a usable GPU budget. Memory estimates help present requirements; they do not replace a verified model run on the actual placement.

For local MPS development the retained estimator uses a configured wired-memory limit where available, otherwise 70% of unified memory. It favours full-precision alternatives to scaled or mixed FP8 formats that MPS cannot execute. Worker deployments use the exact image, GPU placement and model paths owned in ai.

## Downloads

Library imports show matching files, their grade and missing parts before downloads begin. Downloads keep progress across restarts, verify file integrity and retain server-side provider credentials. Administrators manage live catalogue definitions in Studio; the ai mount provides missing-definition seeds and backups.
