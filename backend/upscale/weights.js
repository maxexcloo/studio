/**
 * Every SeedVR2 weight a tier names, with the exact size and SHA-256 Hugging
 * Face publishes for it (the same hashes the SeedVR2 node's own registry checks).
 */
export const modelFiles = {
  "seedvr2_ema_3b_fp8_e4m3fn.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 3B",
    detail: "fp8",
    bytes: 3_391_544_696,
    sha256: "3bf1e43ebedd570e7e7a0b1b60d6a02e105978f505c8128a241cde99a8240cff",
  },
  "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors": {
    repo: "AInVFX/SeedVR2_comfyUI",
    label: "SeedVR2 7B",
    detail: "fp8, last block fp16",
    bytes: 8_466_296_338,
    sha256: "3d68b5ec0b295ae28092e355c8cad870edd00b817b26587d0cb8f9dd2df19bb2",
  },
  "seedvr2_ema_7b_fp8_e4m3fn.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 7B",
    detail: "fp8",
    bytes: 8_239_729_704,
    sha256: "1fdbf3877b7d1eb266038d3a165a977f17dbb4daa4a0f0d334d5461476963037",
  },
  "seedvr2_ema_7b_fp16.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 7B",
    detail: "fp16",
    bytes: 16_479_334_424,
    sha256: "7b8241aa957606ab6cfb66edabc96d43234f9819c5392b44d2492d9f0b0bbe4a",
  },
  "ema_vae_fp16.safetensors": {
    repo: "numz/SeedVR2_comfyUI",
    label: "SeedVR2 VAE",
    detail: "fp16",
    bytes: 501_324_814,
    sha256: "20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1",
  },
};
