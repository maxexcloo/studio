# Auto-downloads: what's covered

Pick a model to see what it still needs. Each part gets a Download or Install button, and **Get all** fetches the lot. Nothing downloads until you press a button.

- **What each model needs.** Pick a model to see what's missing, whether that's a text encoder, a VAE, a companion file (like Wan 2.2's low-noise half), a custom node pack or a newer ComfyUI. The model menu shows what each model lacks, and a blocked Generate opens that model's setup.
- **One click per part, or Get all.** Files come from Hugging Face into the folders ComfyUI reads from, including shared folders set up in `extra_model_paths.yaml`. **Get all** adds up the sizes and checks free space first. Where an uncensored (abliterated) text encoder exists, it comes first; other builds (smaller precisions, Comfy-Org's own) are under **Other versions**. A build that has moved or is gated falls back to the next one.
- **Custom node packs (beta).** Packs listed in ComfyUI-Manager install through it. Otherwise, with ComfyUI on this computer, the pack is cloned and its requirements installed with ComfyUI's own Python. The manual steps stay one tap away.
- **Resumable downloads.** Progress, speed and time left show as they run. Downloads resume after a restart, retry a dropped connection and check free space first, and gated files link to their Hugging Face page.
- **Ready at the end.** Each part is ticked off as it lands, and the last one turns the panel into “Krea 2 is ready”. Progress survives a ComfyUI restart halfway through.
