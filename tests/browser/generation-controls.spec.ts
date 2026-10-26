import { expect, test } from "@playwright/test";
import {
  closeReferences,
  closeLoras,
  create,
  fixtures,
  image,
  profiles,
  stamp,
  withExpertSettings,
  serveProfiles,
} from "./fixtures";
import type { Profile } from "../../frontend/src/types";

test("Changing the second encoder and weight type preserves the first encoder in generation", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[0],
    encoderSlots: [
      {
        slot: "clip",
        label: "CLIP Encoder",
        default: "clip-exact.safetensors",
        options: ["clip-exact.safetensors", "clip-other.safetensors"],
      },
      {
        slot: "t5",
        label: "T5 Encoder",
        default: "t5-default.safetensors",
        options: ["t5-default.safetensors", "t5-selected.safetensors"],
      },
    ],
    defaults: {
      ...profiles[0].defaults,
      textEncoder: "clip-exact.safetensors",
      weightDtype: "default",
    },
    options: { ...profiles[0].options, weightDtypes: ["default", "fp8_e4m3fn"] },
  };
  await serveProfiles(page, [profile], { library: true, presets: true });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An encoder comparison");
  await withExpertSettings(page, async () => {
    const clip = page.getByRole("combobox", { name: "CLIP Encoder", exact: true });
    await expect(clip).toHaveValue("clip-exact.safetensors");
    await page.getByRole("combobox", { name: "T5 Encoder", exact: true }).click();
    await page.getByRole("option", { name: "t5-selected.safetensors", exact: true }).click();
    await page.getByRole("combobox", { name: "Weight Type", exact: true }).click();
    await page.getByRole("option", { name: "fp8_e4m3fn", exact: true }).click();
    // Choosing nested options keeps the Expert settings open.
    await expect(clip).toHaveValue("clip-exact.safetensors");
  });
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.textEncoder).toBe("clip-exact.safetensors");
  expect(state.jobs[0].input.textEncoders).toEqual([
    "clip-exact.safetensors",
    "t5-selected.safetensors",
  ]);
  expect(state.jobs[0].input.weightDtype).toBe("fp8_e4m3fn");
});

test("Edit framing uses the portrait reference while Reference mode retains the custom working size", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[0],
    aspectPolicy: "reference",
    capabilities: { ...profiles[0].capabilities, inpaint: false },
    defaults: { ...profiles[0].defaults, referenceRole: "edit" },
  };
  await serveProfiles(page, [profile], { library: true, presets: true });
  state.gallery.push({
    id: "portrait",
    jobId: "old-portrait",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Portrait framing source",
    width: 800,
    height: 1200,
    createdAt: stamp,
  });
  await page.route("**/api/reference-assets/from-gallery", (route) =>
    route.fulfill({
      json: {
        asset: {
          id: "portrait-asset",
          name: "Portrait Reference",
          url: image,
          thumbnailUrl: image,
          width: 800,
          height: 1200,
        },
      },
    }),
  );
  await create(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Use this portrait as a composition reference");
  const size = page.getByRole("button", { name: "Aspect", exact: true });
  await size.click();
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("1280");
  await page.getByRole("textbox", { name: "Height", exact: true }).fill("768");
  await size.click();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page
    .getByRole("button", { name: "Use reference: Portrait framing source", exact: true })
    .click();
  await closeReferences(page);
  await expect(size).toHaveText("Reference · 2:3");
  await size.click();
  await expect(
    page.getByText("The reference sets the output framing to 2:3.", { exact: true }),
  ).toBeVisible();
  await size.click();
  await withExpertSettings(page, () =>
    page
      .getByRole("radiogroup", { name: "Reference Role", exact: true })
      .getByText("Reference", { exact: true })
      .click(),
  );
  await expect(size).toHaveText("1280 × 768");
  await size.click();
  await expect(page.getByRole("textbox", { name: "Width", exact: true })).toHaveValue("1280");
  await expect(page.getByRole("textbox", { name: "Height", exact: true })).toHaveValue("768");
  await size.click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input).toMatchObject({
    width: 1280,
    height: 768,
    referenceRole: "reference",
    referenceAssets: [{ assetId: "portrait-asset", slot: "image" }],
  });
  expect(state.jobs[0].input.referenceDetails[0]).toMatchObject({
    width: 800,
    height: 1200,
    slot: "image",
  });
});

test("A saved End-only preset restores its explicit slot without creating a Start reference", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile: Profile = {
    ...profiles[1],
    mediaInputs: [
      { id: "start", role: "start", label: "Start", required: false },
      { id: "end", role: "end", label: "End", required: false },
    ],
  };
  await serveProfiles(page, [profile], { library: true, presets: true });
  state.gallery.push({
    id: "ending",
    jobId: "ending-source",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "Closing frame",
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await page.goto("/video?compose=1");
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Arrive at the closing frame");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByRole("button", { name: "Slot 2 · End", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Closing frame", exact: true }).click();
  await closeReferences(page);
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("End Frame Only");
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await expect.poll(() => state.presets.length).toBe(1);
  expect(state.presets[0].input.referenceAssets).toEqual([
    { assetId: "asset-ending", slot: "end" },
  ]);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("");
  await expect(page.getByRole("dialog", { name: "Presets", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "End Frame Only", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Arrive at the closing frame",
  );
  await page.getByRole("button", { name: "Generate Video", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toEqual([{ assetId: "asset-ending", slot: "end" }]);
  expect(state.jobs[0].input.referenceDetails).toHaveLength(1);
  expect(state.jobs[0].input.referenceDetails[0].slot).toBe("end");
});

test("Saved family LoRA stacks retain order and disabled entries through update and reload", async ({
  page,
}) => {
  const state = await fixtures(page);
  const original = [
    { name: "detail.safetensors", strength: 0.35, enabled: false },
    { name: "soft-style.safetensors", strength: 0.65, enabled: true },
  ];
  state.loraLibrary.snapshots["family:test"] = [
    { id: "copper-stack", name: "Copper Detail", loras: original },
  ];
  state.loraLibrary.snapshots["family:other"] = [
    { id: "other-stack", name: "Other Family Stack", loras: [] },
  ];
  await create(page);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Saved LoRA Stacks", exact: true }).click();
  await page.getByRole("combobox", { name: "Saved LoRA Stack", exact: true }).click();
  await page.getByRole("option", { name: "Copper Detail", exact: true }).click();
  await page.getByRole("button", { name: "Load LoRA Stack", exact: true }).click();
  const enabled = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(enabled).not.toBeChecked();
  await expect(
    page.getByRole("textbox", { name: "Detail Slider Strength", exact: true }),
  ).toHaveValue("0.35");
  await enabled.check();
  await page.getByRole("textbox", { name: "Detail Slider Strength", exact: true }).fill("1.25");
  await page
    .getByRole("textbox", { name: "LoRA Stack Name", exact: true })
    .fill("Copper Detail Refined");
  await page.getByRole("textbox", { name: "LoRA Stack Name", exact: true }).press("Enter");
  await expect
    .poll(() => state.loraLibrary.snapshots["family:test"][0].name)
    .toBe("Copper Detail Refined");
  expect(state.jobs).toHaveLength(0);
  expect(state.loraOperations.map((operation) => operation.op)).toEqual([
    "stack.update",
    "stack.rename",
  ]);
  expect(state.loraOperations.every((operation) => operation.key === "family:test")).toBe(true);
  expect(state.loraLibrary.snapshots["family:other"][0].name).toBe("Other Family Stack");
  await page.reload();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Saved LoRA Stacks", exact: true }).click();
  await page.getByRole("combobox", { name: "Saved LoRA Stack", exact: true }).click();
  await page.getByRole("option", { name: "Copper Detail Refined", exact: true }).click();
  await page.getByRole("button", { name: "Load LoRA Stack", exact: true }).click();
  await closeLoras(page);
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Reuse the refined LoRA stack");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.loras).toEqual([
    { ...original[0], strength: 1.25, enabled: true },
    original[1],
  ]);
});

test("Clear restores profile defaults and random seed; masked inputs keep Edit mode in both editors", async ({
  page,
}) => {
  const state = await fixtures(page);
  const asset = {
    id: "mask-source",
    slot: "image",
    name: "Reference",
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
  };
  state.presets.push({
    id: "masked",
    title: "Masked Study",
    input: {
      kind: "image",
      profileId: profiles[0].id,
      prompt: "A masked copper bird",
      negative: "harsh light",
      backendId: "worker-b",
      width: 768,
      height: 768,
      steps: 37,
      cfg: 8,
      seed: "117",
      count: 1,
      loras: [{ name: "detail.safetensors", strength: 0.7, enabled: true }],
      referenceAssets: [{ assetId: asset.id, slot: asset.slot }],
      referenceDetails: [asset],
      inpaint: { assetId: asset.id, mask: image, strength: 0.6 },
      referenceRole: "reference",
    },
  });
  await create(page);
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "Masked Study", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear Seed 117", exact: true })).toBeVisible();
  const role = page.getByRole("radiogroup", { name: "Reference Role", exact: true });
  await withExpertSettings(page, async () => {
    await expect(role.getByRole("radio", { name: "Edit", exact: true })).toBeChecked();
    await expect(role.getByRole("radio", { name: "Reference", exact: true })).toBeDisabled();
  });
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(prompt).toHaveValue("");
  await withExpertSettings(page, async () => {
    await expect(page.getByRole("textbox", { name: "Seed", exact: true })).toHaveValue("");
    await expect(page.getByRole("textbox", { name: "Steps", exact: true })).toHaveValue("20");
  });
  await prompt.fill("A fresh bird without inherited styling");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(2);
  expect(state.jobs[1].input).toMatchObject({
    profileId: profiles[0].id,
    backendId: "worker-b",
    seed: "",
    steps: 20,
    cfg: 5,
    width: 1024,
    height: 1024,
    loras: [],
    referenceAssets: [],
  });
  expect(state.jobs[1].input.inpaint).toBeUndefined();
  expect(state.jobs[1].sessionId).toBe(state.jobs[0].sessionId);
  await page.goto(`/chat/${state.jobs[0].sessionId}`);
  const original = page.getByRole("article", { name: "Iteration 1", exact: true });
  await original.getByRole("button", { name: "Edit Iteration 1", exact: true }).click();
  await original.getByRole("button", { name: "Expert Settings", exact: true }).click();
  await expect(role.getByRole("radio", { name: "Edit", exact: true })).toBeChecked();
  await expect(role.getByRole("radio", { name: "Reference", exact: true })).toBeDisabled();
});

test("LoRA trigger copying and published source links work in gallery and timeline editors", async ({
  page,
}) => {
  const state = await fixtures(page);
  const sourceUrl = "https://example.test/publisher/detail?version=2";
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Fixture clipboard permission denied");
        },
      },
    });
    document.execCommand = (command: string) => {
      const selected = document.activeElement as HTMLTextAreaElement;
      if (command !== "copy" || selected?.tagName !== "TEXTAREA") return false;
      (window as any).copiedTrigger = selected.value;
      return true;
    };
  });
  await page.route("**/api/loras/info", (route) =>
    route.fulfill({
      json: {
        loras: {
          "detail.safetensors": {
            title: "Detail Slider",
            families: ["test"],
            type: "slider",
            triggers: ["inkbird"],
            sourceUrl,
          },
        },
      },
    }),
  );
  state.presets.push({
    id: "trigger-study",
    title: "Trigger Study",
    input: {
      kind: "image",
      profileId: "image:test",
      prompt: "A delicate bird",
      negative: "",
      width: 1024,
      height: 1024,
      seed: "",
      count: 1,
      loras: [{ name: "detail.safetensors", strength: 0.7, enabled: true }],
      referenceAssets: [],
    },
  });
  await create(page);
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("button", { name: "Trigger Study", exact: true }).click();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  const copy = page.getByRole("button", { name: "Copy Trigger Word: inkbird", exact: true });
  await copy.click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedTrigger)).toBe("inkbird");
  const source = page.getByRole("link", { name: "View Source", exact: true });
  await expect(source).toHaveAttribute("href", sourceUrl);
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  expect(state.jobs).toHaveLength(0);
  await closeLoras(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A delicate bird inkbird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.prompt).toBe("A delicate bird inkbird");
  expect(state.jobs[0].input.loras).toEqual([
    { name: "detail.safetensors", strength: 0.7, enabled: true },
  ]);
  await page.goto(`/chat/${state.jobs[0].sessionId}`);
  await page.getByRole("button", { name: "Edit Iteration 1", exact: true }).click();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await copy.click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedTrigger)).toBe("inkbird");
  await expect(source).toHaveAttribute("href", sourceUrl);
  expect(state.jobs).toHaveLength(1);
  expect(state.chatRequests).toHaveLength(0);
});

test("Generation actions stay in place while the prompt grows and pickers open", async ({
  page,
  isMobile,
}) => {
  const state = await fixtures(page);
  state.gallery.push({
    id: "footer-reference",
    jobId: "footer-source",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "A reference for the pinned generation actions",
    width: 1024,
    height: 1024,
    createdAt: stamp,
  });
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Keep the actions in reach");
  const generate = page.getByRole("button", { name: "Generate Image", exact: true });
  await expect(generate).toBeInViewport();
  const initial = await generate.boundingBox();
  if (isMobile)
    expect(initial!.y + initial!.height).toBeGreaterThan(page.viewportSize()!.height - 48);
  const long = Array.from({ length: 24 }, (_, line) => `Detail ${line + 1}`).join("\n");
  await prompt.fill(long);
  await expect(generate).toBeInViewport();
  expect(Math.abs((await generate.boundingBox())!.y - initial!.y)).toBeLessThan(1);
  await page.setViewportSize({ ...page.viewportSize()!, height: 600 });
  await expect(generate).toBeInViewport();
  expect((await generate.boundingBox())!.y + initial!.height).toBeLessThanOrEqual(600);
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  const useReferences = page.getByRole("button", { name: "Use References", exact: true });
  await page
    .getByRole("button", {
      name: "Use reference: A reference for the pinned generation actions",
      exact: true,
    })
    .click();
  if (isMobile) {
    await expect(useReferences).toBeInViewport();
    const footer = await useReferences.boundingBox();
    expect(footer!.y + footer!.height).toBeGreaterThan(page.viewportSize()!.height - 48);
  } else await expect(useReferences).toHaveCount(0);
  await closeReferences(page);
  await generate.click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toHaveLength(1);
  expect(state.jobs[0].input.prompt).toBe(long);
});

test("The chip composer offers supported sizes and settings, follows the output route and Clear ends Refine", async ({
  page,
}) => {
  const state = await fixtures(page);
  const still: Profile = {
    ...profiles[0],
    native: { "2k": "yes" },
    aspectPresets: [
      { label: "1:1", w: 1024, h: 1024 },
      { label: "16:9", w: 1344, h: 768 },
    ],
    capabilities: { ...profiles[0].capabilities, variations: true },
  };
  const motion: Profile = {
    ...profiles[1],
    capabilities: { ...profiles[1].capabilities, duration: true },
    constraints: { duration: { min: 1, max: 10, step: 1 } },
  };
  await serveProfiles(page, [still, motion], { library: true, presets: true });
  state.gallery.push({
    id: "source",
    jobId: "source-job",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "A copper bird",
    width: 1024,
    height: 1024,
    createdAt: stamp,
    settings: { profileId: still.id },
  });
  await page.goto("/images");
  await page
    .getByRole("button", { name: "Open image: A copper bird", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Refine", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(page.getByRole("button", { name: "Refine Image", exact: true })).toBeVisible();
  await prompt.click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await prompt.fill("A wide copper horizon");
  const aspect = page.getByRole("button", { name: "Aspect", exact: true });
  await aspect.click();
  await page
    .getByRole("radiogroup", { name: "Resolution", exact: true })
    .locator("label")
    .filter({ hasText: "2K" })
    .click();
  await page.getByRole("button", { name: "16:9 2048 × 1152", exact: true }).click();
  await aspect.click();
  await expect(aspect).toHaveText("16:9 · 2K");
  await page.getByRole("combobox", { name: "Count", exact: true }).click();
  await page.getByRole("option", { name: "2 Images", exact: true }).click();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input).toMatchObject({
    operation: "image",
    width: 2048,
    height: 1152,
    count: 2,
    tiledDecode: true,
    referenceAssets: [],
  });
  expect(state.jobs[0].input.parentJobId).toBeUndefined();
  // Generation reports through its pending tile, never a notification.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await prompt.click();
  await page
    .getByRole("radiogroup", { name: "Generation Output", exact: true })
    .locator("label")
    .filter({ hasText: "Video" })
    .click();
  await expect(page).toHaveURL(/\/video/);
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toHaveText(
    "Motion Quality",
  );
  await expect(page.getByRole("combobox", { name: "Count", exact: true })).toHaveCount(0);
  await withExpertSettings(page, async () => {
    await expect(
      page.getByRole("textbox", { name: "Duration (Seconds)", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Frames", exact: true })).toHaveCount(0);
  });
});

test("References, masking, expert controls and runtime presets remain editable", async ({
  page,
}) => {
  const state = await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An amber bird");
  const upload = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page.getByText("Uploads", { exact: true }).click();
  await page.getByRole("button", { name: "Upload Reference", exact: true }).click();
  await (
    await upload
  ).setFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await closeReferences(page);
  await expect(page.getByRole("region", { name: "References", exact: true })).toBeHidden();
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Paint Mask", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Paint the Area to Refine" })).toBeVisible();
  await page.locator("canvas").click({ position: { x: 40, y: 40 } });
  await page.getByRole("button", { name: "Use Mask", exact: true }).click();
  await page.getByRole("button", { name: "Edit Mask", exact: true }).click();
  const canvas = page.locator("canvas");
  const painted = () =>
    canvas.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) total++;
      return total;
    });
  await expect.poll(painted).toBeGreaterThan(0);
  const beforeErase = await painted();
  await page.getByText("Erase", { exact: true }).click();
  await canvas.click({ position: { x: 40, y: 40 } });
  await expect.poll(painted).toBeLessThan(beforeErase);
  const erased = await painted();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(painted).toBe(beforeErase);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(painted).toBe(erased);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Use Mask", exact: true }).click();

  await withExpertSettings(page, async () => {
    await page.getByRole("textbox", { name: "Seed", exact: true }).fill("42");
    await page.getByRole("checkbox", { name: "Allow Fallback to Another Worker" }).check();
  });
  await page.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("Bird Study");
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await expect.poll(() => state.presets.length).toBe(1);
  expect(state.presets[0].input.seed).toBe("42");
  expect(state.presets[0].input.inpaint.mask).toMatch(/^data:image\/png/);
  expect(state.presets[0].input.inpaint.feather).toBe(0.4);
  expect(state.presets[0].input.allowFallback).toBe(true);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An updated amber bird");
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("Updated Bird Study");
  await page.getByRole("button", { name: "Update Preset", exact: true }).click();
  await expect.poll(() => state.presets[0].title).toBe("Updated Bird Study");
  expect(state.presets[0].input.prompt).toBe("An updated amber bird");
  expect(state.presets).toHaveLength(1);
});

test("Generation controls preserve the draft and return keyboard focus with reduced motion", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Keep this direction");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(prompt).toHaveValue("Keep this direction");
  await prompt.fill("Keep this direction, in soft daylight");
  await prompt.press("Escape");
  if (testInfo.project.use.isMobile)
    await expect(
      page.getByRole("dialog", { name: "Generation Controls", exact: true }),
    ).toBeHidden();
  const controls = page.getByRole("textbox", { name: "Prompt", exact: true });
  await expect(controls).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Keep this direction, in soft daylight",
  );
  await controls.press("Enter");
  await expect(page.getByRole("combobox", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Keep this direction, in soft daylight",
  );
});

test("Generation size presets and custom dimensions preserve profile constraints", async ({
  page,
}) => {
  const state = await fixtures(page);
  const profile = {
    ...profiles[0],
    aspectPresets: [
      { label: "Square", w: 1024, h: 1024 },
      { label: "Landscape", w: 1536, h: 1024 },
    ],
    constraints: {
      width: { min: 512, max: 2048, step: 64 },
      height: { min: 512, max: 2048, step: 64 },
    },
  };
  await serveProfiles(page, [profile]);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A wide landscape");
  await page.getByRole("button", { name: "Aspect", exact: true }).click();
  await page.getByRole("button", { name: "Landscape 1536 × 1024", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Width", exact: true })).toHaveValue("1536");
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("1600");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.width).toBe(1600);
  expect(state.jobs[0].input.height).toBe(1024);
});

test("Images and Videos retain independent prompts and expert settings", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Image draft");
  const negative = page.getByRole("textbox", { name: "Negative Prompt", exact: true });
  const seed = page.getByRole("textbox", { name: "Seed", exact: true });
  await withExpertSettings(page, async () => {
    await negative.fill("Image exclusions");
    await seed.fill("777");
  });
  if (testInfo.project.use.isMobile) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Generation Controls", exact: true }),
    ).toBeHidden();
  }
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Video draft");
  await page.getByRole("link", { name: "Images", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Image draft",
  );
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  await withExpertSettings(page, async () => {
    await expect(negative).toHaveValue("Image exclusions");
    await expect(seed).toHaveValue("777");
  });
  if (testInfo.project.use.isMobile) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Generation Controls", exact: true }),
    ).toBeHidden();
  }
  await page.getByRole("link", { name: "Videos", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Video draft",
  );
});
