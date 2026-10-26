// Imported first by tests that talk to a ComfyUI on this computer: one worker at its usual address.
process.env.STUDIO_WORKERS = JSON.stringify([
  {
    id: "primary",
    url: "http://127.0.0.1:8188",
    capabilities: ["image", "video", "upscale", "models"],
  },
]);
