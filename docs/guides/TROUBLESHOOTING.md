# Troubleshooting

Common problems and how to get past them. A failed generation's card links to its section below.

Still stuck? **Settings › About › Copy diagnostics** copies the Studio, Node.js and ComfyUI versions, the system and the GPU, without prompts, images or file names. Paste it into [an issue](https://github.com/maxexcloo/studio/issues) with what you did and what happened. **Copy report** on a failed card adds the error itself. Or skip the pasting: **Report bug** on a failed card, **Idea or bug?** at the bottom of the Settings sidebar send it to the [feedback board](https://heiss-ui.vercel.app/board/), with the setup lines if you want them. For a quick hand, ask in the [Discord](https://discord.gg/Hf7ysvDeGa).

- [Starting Studio](#starting-studio)
- [When a generation fails](#when-a-generation-fails)
- [Inpainting, upscaling and stacks](#inpainting-upscaling-and-stacks)
- [Downloads and node packs](#downloads-and-node-packs)
- [Updates](#updates)
- [Phones and other devices](#phones-and-other-devices)

## Starting Studio

### The studio can't reach ComfyUI

ComfyUI makes every image, so it has to be running. Start it and the studio connects.

ComfyUI Desktop usually uses port 8000, a manual or portable install 8188. Both are checked on this computer. For another address, set it in **Settings › Connection** (a port such as `8000` is enough) or set `COMFY_URL` in `.env`. ComfyUI on another computer needs to be started with `--listen`.

### Which address to open

Open the address the server log shows under **Open**, usually `http://localhost:8787`, or the address and port the container is published on.

### The port is taken, or Studio is already running

When port 8787 is in use, the next free one (8788, 8789, …) is used instead. The log says which. To keep one fixed port, set `PORT` in `.env`.

"""Studio is already running""" means another copy has the port. Open that copy, or stop it first.

### Node.js is missing or too old

The container image brings its own Node.js. Running from source needs **Node.js 20.9 or newer** (22 LTS recommended) from [nodejs.org](https://nodejs.org).

### No models show up

The studio lists the models ComfyUI lists: files in its `models/checkpoints` and `models/diffusion_models` folders, plus anything `extra_model_paths.yaml` adds. After adding a file, use **Settings › Models › Rescan**. **Find models** looks for model files elsewhere on this computer and links them in.

### Video isn't there

Switch the sidebar from Image to **Video** (beta). Wan 2.1, Wan 2.2 5B and 14B, HunyuanVideo 1.5 and MiniMax H3 run built in, and the model's setup lists anything missing.

## When a generation fails

A failed run stays in the gallery as a card that says what went wrong. Open it for the fix, **Use these settings** to try again, or **Copy report** for the full error.

### A model file is damaged or incomplete

The file can't be read. A download may have stopped early, or saved a web page instead of the model. The card names the file and whether it's the model, the VAE, a text encoder or a LoRA. Delete it and download it again. Downloads offered in the studio resume and check themselves.

### The GPU ran out of memory

The model, the image size and the number of images didn't fit in the GPU's memory. Try a smaller size, fewer images per run, or a lighter model (an fp8 or smaller variant). **Settings › General › Clear cache** frees what ComfyUI still holds from earlier runs. On a Mac, closing other large apps helps too.

<a name="comfyui-does-not-have-a-file-this-run-asked-for"></a>

### ComfyUI can't find a file this run uses

ComfyUI answered """Value not in list""". A model, LoRA, text encoder or VAE picked here isn't in ComfyUI's folders, or ComfyUI hasn't picked up a new one yet. Use **Rescan** in Settings › Models, or pick another file.

<a name="parts-that-do-not-fit-together"></a>

### A part doesn't match the model

The text encoder, VAE or a LoRA is made for a different model family, for example a Flux LoRA on SDXL. Check the picks in **Advanced** and turn off LoRAs that don't match the model.

### A file went missing

A file the run needs was moved or deleted after ComfyUI listed it. Use **Rescan** in Settings › Models and try again.

### ComfyUI-GGUF can't load this model yet

ComfyUI-GGUF only loads the model types its maintainers have added. As of September 2026 it doesn't load Krea 2, Ideogram 4, MiniMax H3 or Qwen-Image 2.1 GGUFs. Update ComfyUI-GGUF through ComfyUI-Manager, or download the model's safetensors version.

### A node is missing in ComfyUI

The workflow uses a custom node ComfyUI doesn't have. Install the node pack (the card offers it when the pack is known), restart ComfyUI, and try again. For a built-in model, the card says **Newer ComfyUI** instead when ComfyUI itself is too old. Update ComfyUI.

### ComfyUI dropped this run

The run is no longer in ComfyUI's queue or history, usually because ComfyUI restarted or its queue was cleared somewhere else. Generate again once ComfyUI is running.

### Lost the connection to ComfyUI

ComfyUI stopped answering for about a minute mid-run. It may have crashed (often from running out of memory), been closed, or restarted. Check its window or log, start it again if needed, then try again.

### No image was saved

The run finished without an image to show. An imported workflow may end in a preview node instead of **Save Image**, or ComfyUI skipped a step. Run the workflow once in ComfyUI to see what it does.

### Needs a separate part

A checkpoint that looked all-in-one has no text encoder or VAE built in. From then on it uses a separate one. Rescan models, pick or download the missing part in **Advanced**, and generate again.

### Generation failed

Anything else. **Show details** on the card has ComfyUI's own message and traceback. Check that the model runs in ComfyUI itself and that the custom nodes it needs are installed. If it works there but not here, [open an issue](https://github.com/tristmeister/HEISS-UI/issues) with the copied report.

## Inpainting, upscaling and stacks

### The inpainting brush is missing

The brush sits in a reference or start image's menu. When it isn't there, **Inpainting** is turned off in **Settings › Features**, or the current model can't inpaint. Ideogram 4, MageFlow, Sana, video models and imported workflows can't. The model menu marks which models can, and **Settings › Features › Inpainting** lists yours.

### 2K was skipped, or a 2K picture repeats or warps

2K is drawn by the model itself. A run skips it when a reference image being edited decides the size (edit models) or part of the picture is painted for inpainting; your 2K pick comes back afterwards. A model not made for 2K says so in the size menu, and it may repeat subjects or warp at that size. Use Default there and take the picture to 2K or 4K with the upscale arrow.

### Smart upscale didn't start or stopped

The upscale arrow needs the ComfyUI-SeedVR2 nodes and a SeedVR2 model. If they're missing, the first upscale offers to set them up. If an upscale stops or fails, the picture stays at its generated size, and the arrow tries again.

### Auto-grouping doesn't stack anything

Auto-grouping is off by default. Turn it on with the stack button next to the gallery search, or in **Settings › Library › Auto-grouping**. A stack needs at least 3 pictures from similar prompts, and it forms about 5 minutes after you stop working on that prompt. While you're still generating, the pictures stay ordinary tiles. Coming back to a prompt after 6 hours or more starts a new stack.

## Downloads and node packs

### A download says the file is no longer at its address

The link in this version is out of date (HTTP 404). Deploy a newer Studio image. Newer versions have newer links. Or download the file from its Hugging Face page, put it in the ComfyUI folder the setup panel names, and use **Rescan** in Settings › Models.

### A download needs a Hugging Face sign-in

Some models need a sign-in and an accepted licence first (HTTP 401 or 403). Accept it on the page that opens. Then either save a Hugging Face token in **Settings › Models** and download again, or download the file in the browser, put it in the named ComfyUI folder, and use **Rescan** in Settings › Models.

### ComfyUI-Manager blocks a node pack install

ComfyUI-Manager only installs what its security level allows. At the default, `normal`, it installs packs from its registry while ComfyUI only listens on this computer. `strong` blocks them, and a ComfyUI started with `--listen` blocks more. Installing from a Git address needs `normal-` or `weak`.

Use the terminal command the panel shows, or change the level:

1. Stop ComfyUI.
2. Open Manager's `config.ini`: `ComfyUI/user/__manager/config.ini` in current versions, `ComfyUI/user/default/ComfyUI-Manager/config.ini` in older ones.
3. Set `security_level = normal` (or `normal-` for a Git address) and save.
4. Start ComfyUI again and retry the install.

### A download stops because the disk is full

Free space is checked before a large download. Free some space on the disk that holds ComfyUI's models, then start the download again. It resumes where it stopped.

## Updates

### Going back to an earlier version

The first time a new version starts, it saves a copy of the settings, the gallery list and sign-ins in `data/.backups/`, in a folder named after the two versions (for example `0.11.0-to-0.12.0-…`). Thumbnails, reference images and `data/backups/` aren't copied, because updates don't change them. To go back, stop Studio, deploy the earlier image, copy everything from that folder back into `data/`, and start it. Copies are removed after 14 days, and at most three are kept.

## Phones and other devices

### A phone can't open the studio

1. Turn on **Settings › Connection › Other devices** and restart Studio.
2. Use one of the addresses Settings shows. The phone must be on the same network.
3. Set a studio password on this computer first. Other devices sign in with it.
4. If the page still doesn't load, the computer's firewall may block the port. Allow Node.js (or port 8787) on private networks.
