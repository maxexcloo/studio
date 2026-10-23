# Custom Workflows

Studio reads ComfyUI workflow profiles from the mounted ai configuration directory. This folder retains standalone compatibility examples; deployed definitions belong in ai.

Use ComfyUI's API workflow JSON format, then add a `heissUi` block that tells the simple UI which node inputs map to common controls.

```json
{
  "heissUi": {
    "id": "my-workflow",
    "name": "My Workflow",
    "kind": "image",
    "controls": {
      "prompt": { "node": "4", "input": "text" },
      "negative": { "node": "5", "input": "text" },
      "width": { "node": "6", "input": "width" },
      "height": { "node": "6", "input": "height" },
      "steps": { "node": "7", "input": "steps" },
      "cfg": { "node": "7", "input": "cfg" },
      "sampler": { "node": "7", "input": "sampler_name" },
      "scheduler": { "node": "7", "input": "scheduler" },
      "seed": { "node": "7", "input": "seed" }
    }
  },
  "4": {
    "class_type": "CLIPTextEncode",
    "inputs": {}
  }
}
```

Mark a workflow that makes adult content with `"nsfw": true` in its `heissUi` block. Access profiles without the NSFW Models feature (such as the built-in User profile) never offer it; administrators always can.

Only mapped controls are changed by Studio. Everything else stays exactly as it was in the exported ComfyUI API workflow.

The controls it can map are `prompt`, `negative`, `seed`, `steps`, `cfg`, `sampler`, `scheduler`, `denoise`, `width`, `height`, `count` (batch size), `frames`, `fps` and `startImage`, plus the loader choices `model`, `textEncoder`, `vae`, `clipType` and `weightDtype`. Each points at one input on one node. A second sampler or prompt encoder keeps its saved values unless you feed both from one node (a core `PrimitiveInt` or `PrimitiveString`) and map that.

For existing unannotated imports, the retained parser can infer common mappings from node types and order. Production profiles should declare their inputs explicitly in ai so control behaviour is reviewable. In-app definition editing and draft approval are deferred.

Smart upscale's 2K and 4K picks work with imported workflows too: the upscale runs in the same ComfyUI job, after the workflow's own output. Inpainting doesn't: an imported workflow gets reference and start images, not the brush.

## Image-to-image inputs

Declare image editing explicitly rather than relying only on a `LoadImage`
node:

```json
{
  "heissUi": {
    "capabilities": { "imageToImage": true },
    "mediaInputs": [
      {
        "id": "reference",
        "kind": "image",
        "label": "Reference image",
        "required": true,
        "min": 1,
        "max": 1,
        "control": { "node": "369", "input": "image" }
      }
    ],
    "promptComposition": {
      "prefix": "Edit: ",
      "suffix": "Keep everything else the same.",
      "policy": "preserve-source-v1",
      "version": 1
    }
  }
}
```

The user prompt stays unchanged in gallery history. Prefix and suffix text are
applied only to the graph input. Existing workflows with `controls.startImage`
are automatically exposed as an optional single-image media input.

Visual workflow imports prefer ComfyUI's `widgets_values_named` map when it is
available. This avoids positional drift from UI-only widget values such as
`control_after_generate` and upload controls.

## Power LoRA Loader

An API workflow can opt in to Studio's LoRA picker with an existing rgthree Power LoRA Loader:

```json
{
  "heissUi": {
    "capabilities": { "lora": true },
    "loraStack": {
      "adapter": "rgthree-power-v1",
      "node": "4",
      "max": 8
    }
  }
}
```

The referenced node must be `Power Lora Loader (rgthree)` and already have its model and CLIP wiring connected. Studio replaces only its `lora_` inputs using the selected LoRAs, in sidebar order.

The simpler rgthree stack used by the bundled Flux 2 edit workflow is also
supported:

```json
{
  "heissUi": {
    "capabilities": { "lora": true },
    "loraStack": {
      "adapter": "rgthree-stack-v1",
      "node": "374",
      "max": 4
    }
  }
}
```

A Radiance node (such as `RadianceImageGenerate`) takes its LoRAs as one JSON
string instead of loader slots:

```json
{
  "heissUi": {
    "capabilities": { "lora": true },
    "loraStack": {
      "adapter": "radiance-tags-v1",
      "node": "1",
      "max": 4
    }
  }
}
```

Studio sets the node's `loras` input to the enabled LoRAs in stack order, such
as `[{"name":"style.safetensors","strength":0.8}]`, or `[]` when none are
chosen. The prompt text is left as written; Radiance adds the LoRA tags itself.
