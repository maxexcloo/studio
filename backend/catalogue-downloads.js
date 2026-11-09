/**
 * Every file Studio's catalogue downloads, as data (where each part comes from, its size and
 * hash), and the lookups the download route and import review use.
 */
import { families } from "./family-catalogue.js";
import { existingCopy } from "./model/downloads.js";
import { encoderKinds, vaeKinds } from "./model/components.js";

const hf = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;

/* ------------------------------------------------------------ Downloads */

// Where to get each part. The first entry is what a Download button fetches;
// abliterated builds lead wherever a ComfyUI-ready one exists. `fp8`: the file
// is quantized fp8 (per-layer scales, read from its header), which ComfyUI
// keeps in fp8 and a Mac cannot load. A plain fp8 file loads at full precision
// on a Mac and is not flagged. `sha256` is the file's Hugging Face LFS hash (its paths-info
// API), checked after every download; an entry without one is checked by
// length only.
export const encoderDownloads = {
  clip_l: [
    {
      file: "clip_l.safetensors",
      url: hf("comfyanonymous/flux_text_encoders", "clip_l.safetensors"),
      bytes: 246_144_152,
      sha256: "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd",
    },
  ],
  clip_g: [
    {
      file: "clip_g.safetensors",
      url: hf("Comfy-Org/stable-diffusion-3.5-fp8", "text_encoders/clip_g.safetensors"),
      bytes: 1_389_382_176,
      sha256: "ec310df2af79c318e24d20511b601a591ca8cd4f1fce1d8dff822a356bcdb1f4",
    },
  ],
  t5xl: [
    {
      file: "pony-v7-pile-t5xl.fp16.safetensors",
      url: hf("purplesmartai/pony-v7-base", "text_encoder/model.fp16.safetensors"),
      bytes: 2_950_448_704,
      sha256: "decf9b70814ed5e9965bfca9fbd0483462e2bf743790663025b7742f8c014c72",
    },
  ],
  t5xxl: [
    {
      file: "t5xxl_fp8_e4m3fn_scaled.safetensors",
      fp8: true,
      url: hf("comfyanonymous/flux_text_encoders", "t5xxl_fp8_e4m3fn_scaled.safetensors"),
      bytes: 5_157_348_688,
      sha256: "a498f0485dc9536735258018417c3fd7758dc3bccc0a645feaa472b34955557a",
    },
    {
      file: "t5xxl_fp16.safetensors",
      url: hf("comfyanonymous/flux_text_encoders", "t5xxl_fp16.safetensors"),
      bytes: 9_787_841_024,
      sha256: "6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635",
    },
  ],
  umt5xxl: [
    {
      file: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      fp8: true,
      url: hf(
        "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
      ),
      bytes: 6_735_906_897,
      sha256: "c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68",
    },
    {
      file: "umt5_xxl_fp16.safetensors",
      url: hf(
        "Comfy-Org/Wan_2.1_ComfyUI_repackaged",
        "split_files/text_encoders/umt5_xxl_fp16.safetensors",
      ),
      bytes: 11_366_399_385,
      sha256: "7b8850f1961e1cf8a77cca4c964a358d303f490833c6c087d0cff4b2f99db2af",
    },
  ],
  byt5_glyph: [
    {
      file: "byt5_small_glyphxl_fp16.safetensors",
      url: hf(
        "Comfy-Org/HunyuanVideo_1.5_repackaged",
        "split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors",
      ),
      bytes: 438_643_184,
      sha256: "516910bb4c9b225370290e40585d1b0e6c8cd3583690f7eec2f7fb593990fb48",
    },
  ],
  qwen3_06b: [
    {
      file: "qwen_3_06b_base.safetensors",
      url: hf("circlestone-labs/Anima", "split_files/text_encoders/qwen_3_06b_base.safetensors"),
      bytes: 1_192_135_096,
      sha256: "cd2a512003e2f9f3cd3c32a9c3573f820bb28c940f73c57b1ddaa983d9223eba",
    },
  ],
  // "Heretic" builds are abliterated with the Heretic tool; DreamFast and ethanfel
  // ship them converted for ComfyUI's single-file loaders.
  qwen3_4b: [
    {
      file: "qwen3-4b-heretic_fp8_e4m3fn.safetensors",
      url: hf("DreamFast/qwen3-4b-heretic", "comfyui/qwen3-4b-heretic_fp8_e4m3fn.safetensors"),
      bytes: 4_411_666_704,
      sha256: "f4ce8b26dcb710a73d3e81fd4bdb10daf8d063496b23655de4aa2e435b5f2d18",
    },
    {
      file: "qwen_3_4b.safetensors",
      url: hf("Comfy-Org/z_image_turbo", "split_files/text_encoders/qwen_3_4b.safetensors"),
      bytes: 8_044_982_048,
      sha256: "6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a",
    },
  ],
  qwen3_8b: [
    {
      file: "qwen3-8b-heretic_fp8_e4m3fn.safetensors",
      fp8: true,
      url: hf("DreamFast/qwen3-8b-heretic", "comfyui/qwen3-8b-heretic_fp8_e4m3fn.safetensors"),
      bytes: 9_435_845_548,
      sha256: "7869b38a7830fd021e36a1f00a1e012ac5c9afe36b974a8e5e67b311e654443e",
    },
    {
      file: "qwen_3_8b_fp8mixed.safetensors",
      fp8: true,
      url: hf(
        "Comfy-Org/vae-text-encorder-for-flux-klein-9b",
        "split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors",
      ),
      bytes: 8_664_848_742,
      sha256: "abad16806e0cbabc54e0325d6565847443fe396d5f0be38bb3cd3fe75a1201d6",
    },
  ],
  qwen3vl_4b: [
    {
      file: "qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors",
      fp8: true,
      url: hf(
        "DreamFast/Qwen3-VL-4b-Heretic-ComfyUI",
        "qwen3-vl-4b-heretic_fp8_e4m3fn.safetensors",
      ),
      bytes: 4_831_492_476,
      sha256: "7443c2b8df026a3271b3095d5d1dc07800dc5cf460b6e3586692253c7a7bc17c",
    },
    {
      file: "qwen3vl_4b_fp8_scaled.safetensors",
      fp8: true,
      url: hf("Comfy-Org/Krea-2", "text_encoders/qwen3vl_4b_fp8_scaled.safetensors"),
      bytes: 5_242_467_968,
      sha256: "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094",
    },
    // BFL's builds for FLUX.3, the ones a Mac can load. BFL's repository is gated (a license to
    // accept while signed in), so each is followed by the same file from an ungated community
    // copy, which a download falls back to when BFL's answers 401.
    {
      file: "qwen3vl_4b_int8_convrot.safetensors",
      url: hf(
        "black-forest-labs/flux-3-image-klein-comfy",
        "text_encoders/qwen3vl_4b_int8_convrot.safetensors",
      ),
      bytes: 4_858_559_240,
    },
    {
      file: "qwen3vl_4b_int8_convrot.safetensors",
      url: hf(
        "ml-resources/flux-3-image-klein-comfy",
        "text_encoders/qwen3vl_4b_int8_convrot.safetensors",
      ),
      bytes: 4_858_559_240,
      sha256: "32de113cbf8282b02cbff0794b637b9d6676da09314a1db5a30bcea9bf4ee01c",
    },
    {
      file: "qwen3vl_4b_bf16.safetensors",
      url: hf(
        "black-forest-labs/flux-3-image-klein-comfy",
        "text_encoders/qwen3vl_4b_bf16.safetensors",
      ),
      bytes: 8_875_719_408,
    },
    {
      file: "qwen3vl_4b_bf16.safetensors",
      url: hf("ml-resources/flux-3-image-klein-comfy", "text_encoders/qwen3vl_4b_bf16.safetensors"),
      bytes: 8_875_719_408,
      sha256: "f0b24fc5c8d7c0ea6ca909da14c20af5cac53f22506be942c6c956f838b9630f",
    },
  ],
  // FLUX.3's prompt upsampler, a Qwen3.5 9B tuned to write its captions: gated like the model,
  // so each build is followed by the same file from the ungated community copy (see qwen3vl_4b).
  flux3_upsampler: [
    {
      file: "qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors",
      url: hf(
        "black-forest-labs/flux-3-image-klein-comfy",
        "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors",
      ),
      bytes: 9_748_113_996,
    },
    {
      file: "qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors",
      url: hf(
        "ml-resources/flux-3-image-klein-comfy",
        "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors",
      ),
      bytes: 9_748_113_996,
      sha256: "cb8cb9b9dcd2569509de755dca54d96fd93a16a7aabfd2f4051f0a144230620f",
    },
    {
      file: "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
      fp8: true,
      url: hf(
        "black-forest-labs/flux-3-image-klein-comfy",
        "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
      ),
      bytes: 6_724_090_780,
    },
    {
      file: "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
      fp8: true,
      url: hf(
        "ml-resources/flux-3-image-klein-comfy",
        "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
      ),
      bytes: 6_724_090_780,
      sha256: "e5d85a7421d197bf5a12474511936ecabce19a833252f16e9310a983194a4458",
    },
    {
      file: "qwen3.5_9b_flux3_prompt_upsampler_bf16.safetensors",
      url: hf(
        "black-forest-labs/flux-3-image-klein-comfy",
        "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_bf16.safetensors",
      ),
      bytes: 18_819_722_392,
    },
    {
      file: "qwen3.5_9b_flux3_prompt_upsampler_bf16.safetensors",
      url: hf(
        "ml-resources/flux-3-image-klein-comfy",
        "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_bf16.safetensors",
      ),
      bytes: 18_819_722_392,
      sha256: "f5062a1fba3e63afe5c88349a311903fec06c959b362f1247127e63d5c860ed4",
    },
  ],
  qwen3vl_8b: [
    {
      file: "qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors",
      url: hf(
        "DreamFast/Qwen3-VL-8B-Heretic-1.3.0",
        "comfyui/qwen3-vl-8b-heretic-1.3.0_fp8_e4m3fn.safetensors",
      ),
      bytes: 10_017_064_632,
      sha256: "7f8ec20de729e2d99f3a04852d4c4499c1677cda167f5ea63d21b0882a5c32b5",
    },
    {
      file: "qwen3vl_8b_int8_convrot.safetensors",
      url: hf("Comfy-Org/Qwen-Image-2.1", "text_encoders/qwen3vl_8b_int8_convrot.safetensors"),
      bytes: 9_350_798_360,
      sha256: "8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f",
    },
  ],
  qwen3vl_32b: [
    {
      file: "qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors",
      url: hf(
        "ethanfel/Qwen3-VL-32B-Ultra-Heretic-H3-ComfyUI-INT8-ConvRot",
        "qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors",
      ),
      bytes: 26_363_476_151,
      sha256: "d84547412144b7c50a6ec77437a889b869d3ace88da77ef1775d3d2a4901c192",
    },
    {
      file: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      url: hf("Comfy-Org/MiniMax-H3", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"),
      bytes: 15_687_142_551,
      sha256: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
    },
  ],
  // Only Comfy-Org's quantized builds exist as single files so far; the w4a8 one carries fp8 scales.
  qwen35_9b: [
    {
      file: "qwen3.5_9b_int8_convrot.safetensors",
      url: hf("Comfy-Org/MOSS-Image", "text_encoders/qwen3.5_9b_int8_convrot.safetensors"),
      bytes: 9_748_121_532,
      sha256: "32e3787472f708fa5f83624acbf5ef23f7fc89c439e05065ea57cfe5a97f025a",
    },
    {
      file: "qwen3.5_9b_w4a8_gptq.safetensors",
      fp8: true,
      url: hf("Comfy-Org/MOSS-Image", "text_encoders/qwen3.5_9b_w4a8_gptq.safetensors"),
      bytes: 7_343_591_088,
      sha256: "4cc6a1543ad2061806da46f35f90cadb4801dcba246c44782cf42ec0feb6407c",
    },
  ],
  qwen25vl_7b: [
    {
      file: "qwen_2.5_vl_7b_huihui_abliterated_int8_convrot.safetensors",
      url: hf(
        "ethanfel/Qwen2.5-VL-7B-Huihui-Abliterated-ComfyUI-ConvRot-INT8",
        "qwen_2.5_vl_7b_huihui_abliterated_int8_convrot.safetensors",
      ),
      bytes: 10_064_106_602,
      sha256: "3dc4aae7dc34000c95de546cb220f1b67e51c86d7095fb9e3d19cec7032f5df7",
    },
    {
      file: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      fp8: true,
      url: hf(
        "Comfy-Org/Qwen-Image_ComfyUI",
        "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
      ),
      bytes: 9_384_670_680,
      sha256: "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4",
    },
  ],
  // fp8 first: half the size of bf16, and what fits next to Flux.2 Dev on most machines.
  mistral3_24b: [
    {
      file: "mistral_3_small_flux2_fp8.safetensors",
      fp8: true,
      url: hf(
        "Comfy-Org/flux2-dev",
        "split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors",
      ),
      bytes: 18_034_640_095,
      sha256: "e3467b7d912a234fb929cdf215dc08efdb011810b44bc21081c4234cc75b370e",
    },
    {
      file: "mistral_3_small_flux2_bf16.safetensors",
      url: hf(
        "Comfy-Org/flux2-dev",
        "split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors",
      ),
      bytes: 35_584_897_447,
      sha256: "7d79902f60b1aeb3a6de2cfad02f4367b5e300a1387de3d03ac717cfa3df117c",
    },
  ],
  llama31_8b: [
    {
      file: "llama_3.1_8b_instruct_fp8_scaled.safetensors",
      fp8: true,
      url: hf(
        "Comfy-Org/HiDream-I1_ComfyUI",
        "split_files/text_encoders/llama_3.1_8b_instruct_fp8_scaled.safetensors",
      ),
      bytes: 9_081_258_056,
      sha256: "9f86897bbeb933ef4fd06297740edb8dd962c94efcd92b373a11460c33765ea6",
    },
  ],
  ministral3_3b: [
    {
      file: "ministral-3-3b.safetensors",
      url: hf("Comfy-Org/ERNIE-Image", "text_encoders/ministral-3-3b.safetensors"),
      bytes: 7_717_637_511,
      sha256: "49a750a128863854eac7d85e1a277a7b44bf6ec3646405b84686dfeeca3708ca",
    },
  ],
  gemma2_2b: [
    {
      file: "gemma_2_2b_fp16.safetensors",
      url: hf(
        "Comfy-Org/Lumina_Image_2.0_Repackaged",
        "split_files/text_encoders/gemma_2_2b_fp16.safetensors",
      ),
      bytes: 5_232_958_283,
      sha256: "29761442862f8d064d3f854bb6fabf4379dcff511a7f6ba9405a00bd0f7e2dbd",
    },
  ],
  hidream_clip_l: [
    {
      file: "clip_l_hidream.safetensors",
      url: hf(
        "Comfy-Org/HiDream-I1_ComfyUI",
        "split_files/text_encoders/clip_l_hidream.safetensors",
      ),
      bytes: 247_586_528,
      sha256: "706fdb88e22e18177b207837c02f4b86a652abca0302821f2bfa24ac6aea4f71",
    },
  ],
  hidream_clip_g: [
    {
      file: "clip_g_hidream.safetensors",
      url: hf(
        "Comfy-Org/HiDream-I1_ComfyUI",
        "split_files/text_encoders/clip_g_hidream.safetensors",
      ),
      bytes: 1_389_743_104,
      sha256: "3771e70e36450e5199f30bad61a53faae85a2e02606974bcda0a6a573c0519d5",
    },
  ],
};

// Vision encoders that read a start image for image-to-video models (models/clip_vision).
export const visionDownloads = {
  sigclip_384: [
    {
      file: "sigclip_vision_patch14_384.safetensors",
      url: hf("Comfy-Org/sigclip_vision_384", "sigclip_vision_patch14_384.safetensors"),
      bytes: 856_505_640,
      sha256: "1fee501deabac72f0ed17610307d7131e3e9d1e838d0363aa3c2b97a6e03fb33",
    },
  ],
};

/** Which vision encoder a clip_vision file is, by name (they have no other use here). */
export const visionKinds = {
  sigclip_384: { label: "SigLIP vision (384)", test: /sig(clip|lip).*384|384.*sig(clip|lip)/i },
};

export const vaeDownloads = {
  sd15: [
    {
      file: "vae-ft-mse-840000-ema-pruned.safetensors",
      url: hf("stabilityai/sd-vae-ft-mse-original", "vae-ft-mse-840000-ema-pruned.safetensors"),
      bytes: 334_641_190,
      sha256: "735e4c3a447a3255760d7f86845f09f937809baa529c17370d83e4c3758f3c75",
    },
  ],
  sdxl: [
    {
      file: "sdxl_vae.safetensors",
      url: hf("stabilityai/sdxl-vae", "sdxl_vae.safetensors"),
      bytes: 334_641_164,
      sha256: "63aeecb90ff7bc1c115395962d3e803571385b61938377bc7089b36e81e92e2e",
    },
  ],
  flux1: [
    {
      file: "ae.safetensors",
      url: hf("Comfy-Org/Lumina_Image_2.0_Repackaged", "split_files/vae/ae.safetensors"),
      bytes: 335_304_388,
      sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
    },
  ],
  // SD3.5's VAE only ships inside its checkpoints or Stability's gated repo.
  sd3: [],
  aura: [
    {
      file: "pony-v7-vae.fp16.safetensors",
      url: hf("purplesmartai/pony-v7-base", "vae/diffusion_pytorch_model.fp16.safetensors"),
      bytes: 167_335_342,
      sha256: "bcb60880a46b63dea58e9bc591abe15f8350bde47b405f9c38f4be70c6161e68",
    },
  ],
  flux2: [
    {
      file: "flux2-vae.safetensors",
      url: hf("Comfy-Org/flux2-dev", "split_files/vae/flux2-vae.safetensors"),
      bytes: 336_213_556,
      sha256: "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5",
    },
  ],
  wan21: [
    {
      file: "wan_2.1_vae.safetensors",
      url: hf("Comfy-Org/Wan_2.1_ComfyUI_repackaged", "split_files/vae/wan_2.1_vae.safetensors"),
      bytes: 253_815_318,
      sha256: "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b",
    },
  ],
  wan22: [
    {
      file: "wan2.2_vae.safetensors",
      url: hf("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", "split_files/vae/wan2.2_vae.safetensors"),
      bytes: 1_409_400_960,
      sha256: "e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156",
    },
  ],
  qwen_image: [
    {
      file: "qwen_image_vae.safetensors",
      url: hf("Comfy-Org/Qwen-Image_ComfyUI", "split_files/vae/qwen_image_vae.safetensors"),
      bytes: 253_806_246,
      sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
    },
  ],
  qwen_image_21: [
    {
      file: "qwen_image_2.1_vae_bf16.safetensors",
      url: hf("Comfy-Org/Qwen-Image-2.1", "vae/qwen_image_2.1_vae_bf16.safetensors"),
      bytes: 675_509_688,
      sha256: "bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9",
    },
  ],
  hunyuan15: [
    {
      file: "hunyuanvideo15_vae_fp16.safetensors",
      url: hf(
        "Comfy-Org/HunyuanVideo_1.5_repackaged",
        "split_files/vae/hunyuanvideo15_vae_fp16.safetensors",
      ),
      bytes: 2_521_292_758,
      sha256: "e7c3091949c27e2d55ae6d5df917b99dadfebbf308e5a50d0ade0d16c90297ae",
    },
  ],
  h3_video: [
    {
      file: "minimax_h3_video_vae_int8_convrot.safetensors",
      url: hf("Comfy-Org/MiniMax-H3", "vae/minimax_h3_video_vae_int8_convrot.safetensors"),
      bytes: 2_811_065_184,
      sha256: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
    },
  ],
  h3_audio: [
    {
      file: "minimax_h3_audio_vae_fp32.safetensors",
      url: hf("Comfy-Org/MiniMax-H3", "vae/minimax_h3_audio_vae_fp32.safetensors"),
      bytes: 605_254_808,
      sha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
    },
  ],
  mage_flow: [
    {
      file: "mage_flow_vae_bf16.safetensors",
      url: hf("Comfy-Org/Mage-Flow", "vae/mage_flow_vae_bf16.safetensors"),
      bytes: 345_053_056,
      sha256: "34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0",
    },
  ],
};

// Second model files a family runs next to the one you pick (see `pair`).
// Comfy-Org's fp8_scaled halves are quantized fp8 (see fp8 on encoderDownloads).
const wan22 = (file, bytes, sha256) => [
  {
    file,
    ...(file.includes("fp8_scaled") ? { fp8: true } : {}),
    url: hf("Comfy-Org/Wan_2.2_ComfyUI_Repackaged", `split_files/diffusion_models/${file}`),
    bytes,
    sha256,
  },
];
export const modelDownloads = {
  wan22_t2v_low_fp8: wan22(
    "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
    14_293_923_632,
    "e71b96d7c82e638694c5e7fb98fac4bfb0e4ddc5fbbb4b1df40da8f0f1278a97",
  ),
  wan22_t2v_low_fp16: wan22(
    "wan2.2_t2v_low_noise_14B_fp16.safetensors",
    28_577_095_592,
    "431d1613ffa809ae1f735b661a01788c6d74991f51efd01f45d5aee955ccd224",
  ),
  wan22_i2v_low_fp8: wan22(
    "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    14_294_742_832,
    "5471a457b6ac404202a5fbe6c11595a3d5641fc766b00f38763f72303fffc21e",
  ),
  wan22_i2v_low_fp16: wan22(
    "wan2.2_i2v_low_noise_14B_fp16.safetensors",
    28_577_914_792,
    "edb89340c8a6fbf1a70e76a839ae01eaf7d289f05ea1ebd6b1a3fc6f533826e9",
  ),
  krea2_turbo_fp8: [
    {
      file: "krea2_turbo_fp8_scaled.safetensors",
      fp8: true,
      label: "Krea 2 Turbo",
      url: hf("Comfy-Org/Krea-2", "diffusion_models/krea2_turbo_fp8_scaled.safetensors"),
      bytes: 13_141_730_784,
      sha256: "eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1",
    },
  ],
  krea2_turbo_bf16: [
    {
      file: "krea2_turbo_bf16.safetensors",
      label: "Krea 2 Turbo",
      url: hf("Comfy-Org/Krea-2", "diffusion_models/krea2_turbo_bf16.safetensors"),
      bytes: 26_283_332_608,
      sha256: "78bbf8f4165eda19cea3cb06c78089221932a39e2eed8af9da741f942c47ffb3",
    },
  ],
  krea2_raw_bf16: [
    {
      file: "krea2_raw_bf16.safetensors",
      label: "Krea 2 Raw",
      url: hf("Comfy-Org/Krea-2", "diffusion_models/krea2_raw_bf16.safetensors"),
      bytes: 26_283_332_608,
      sha256: "f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7",
    },
  ],
  flux2_klein_4b_fp8: [
    {
      file: "flux-2-klein-4b-fp8.safetensors",
      fp8: true,
      label: "Flux.2 Klein 4B",
      url: hf("black-forest-labs/FLUX.2-klein-4b-fp8", "flux-2-klein-4b-fp8.safetensors"),
      bytes: 4_070_624_520,
      sha256: "97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6",
    },
  ],
  flux2_klein_4b: [
    {
      file: "flux-2-klein-4b.safetensors",
      label: "Flux.2 Klein 4B",
      url: hf(
        "Comfy-Org/vae-text-encorder-for-flux-klein-4b",
        "split_files/diffusion_models/flux-2-klein-4b.safetensors",
      ),
      bytes: 7_751_105_712,
      sha256: "ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343",
    },
  ],
  flux2_dev_fp8: [
    {
      file: "flux2_dev_fp8mixed.safetensors",
      fp8: true,
      label: "Flux.2 Dev",
      url: hf("Comfy-Org/flux2-dev", "split_files/diffusion_models/flux2_dev_fp8mixed.safetensors"),
      bytes: 35_455_599_592,
      sha256: "863a82e4ff950a42a6b0e80bea824828f129eb1a8fbbdbd9e8cb29859127b486",
    },
  ],
};

// Whole checkpoints (model, text encoders and VAE in one file), for models/checkpoints.
export const checkpointDownloads = {
  realvisxl5_lightning: [
    {
      file: "RealVisXL_V5.0_Lightning_fp16.safetensors",
      label: "RealVisXL V5.0 Lightning",
      url: hf("SG161222/RealVisXL_V5.0_Lightning", "RealVisXL_V5.0_Lightning_fp16.safetensors"),
      bytes: 6_938_065_512,
      sha256: "fabcadd9330dcc4f9702063428d40b9d4d07168d8acefc819b8d1d9db466b3ec",
    },
  ],
  realvisxl5: [
    {
      file: "RealVisXL_V5.0_fp16.safetensors",
      label: "RealVisXL V5.0",
      url: hf("SG161222/RealVisXL_V5.0", "RealVisXL_V5.0_fp16.safetensors"),
      bytes: 6_938_065_488,
      sha256: "6a35a7855770ae9820a3c931d4964c3817b6d9e3c6f9c4dabb5b3a94e5643b80",
    },
  ],
  sdxl_base: [
    {
      file: "sd_xl_base_1.0.safetensors",
      label: "SDXL 1.0",
      url: hf("stabilityai/stable-diffusion-xl-base-1.0", "sd_xl_base_1.0.safetensors"),
      bytes: 6_938_078_334,
      sha256: "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
    },
  ],
};

/** What a download is called in the queue and the top pill: the part, not its file name. */
function partLabel(kind, key, file) {
  if (kind === "encoder" && encoderKinds[key]) return `${encoderKinds[key].label} text encoder`;
  if (kind === "encoder" && families[key.replace(/_upsampler$/, "")]?.upsampler)
    return families[key.replace(/_upsampler$/, "")].upsampler.slot.label;
  if (kind === "vae" && vaeKinds[key]) return vaeKinds[key].label;
  if (kind === "vision" && visionKinds[key]) return `${visionKinds[key].label} encoder`;
  return file;
}

/** Who publishes a Hugging Face file: the repo's owner ("Comfy-Org", a community converter). */
export function downloadSource(url = "") {
  const match = /^https:\/\/huggingface\.co\/([^/]+)\/([^/]+)\//.exec(String(url));
  return match ? { source: match[1], repo: `${match[1]}/${match[2]}` } : {};
}

/** `onDisk`: fetched already (even before a restart), ComfyUI just has not listed it yet. */
function withDisk(entry) {
  return existingCopy(entry) ? { ...entry, onDisk: true } : entry;
}

/** Every catalogue download Studio will fetch, by kind. The only files the download route accepts. */
const downloadSources = {
  encoder: [encoderDownloads, "text_encoders"],
  vae: [vaeDownloads, "vae"],
  model: [modelDownloads, "diffusion_models"],
  checkpoint: [checkpointDownloads, "checkpoints"],
  vision: [visionDownloads, "clip_vision"],
};

/**
 * One catalogue download by id, with the builds listed after it for the same
 * part as `alternatives`: tried in order if this one is gone or gated.
 */
export function catalogueDownload(id = "") {
  const [kind, key, index] = String(id).split(":");
  const [source, folder] = downloadSources[kind] || [];
  const list = source && Object.hasOwn(source, key) ? source[key] : [];
  const at = Number(index);
  const entry = Number.isInteger(at) ? list[at] : null;
  if (!entry) return null;
  const spec = (item, position) => ({
    id: `${kind}:${key}:${position}`,
    folder,
    label: partLabel(kind, key, item.file),
    ...item,
  });
  return {
    ...spec(entry, at),
    alternatives: list.slice(at + 1).map((item, offset) => spec(item, at + 1 + offset)),
  };
}

/**
 * Catalogue downloads for one exact file name in one models folder, so a file a
 * profile names gets a Download button. Only an exact match: a file under a
 * subfolder, or any other build, is not the file the profile asks for.
 */
export function catalogueDownloadsForFile(file = "", folder = "") {
  const found = [];
  for (const [kind, [source, sourceFolder]] of Object.entries(downloadSources)) {
    if (sourceFolder !== folder) continue;
    for (const [key, list] of Object.entries(source)) {
      list.forEach((entry, index) => {
        if (entry.file === file)
          found.push(
            withDisk({
              id: `${kind}:${key}:${index}`,
              folder,
              label: partLabel(kind, key, entry.file),
              ...downloadSource(entry.url),
              ...entry,
            }),
          );
      });
    }
  }
  return found;
}
