import { expect, test } from "@playwright/test";
import { create, fixtures, image, profiles, stamp } from "./fixtures";
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
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { profiles: [profile], features: { library: true, presets: true } } }),
  );
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An encoder comparison");
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "CLIP Encoder", exact: true })).toHaveValue(
    "clip-exact.safetensors",
  );
  await page.getByRole("combobox", { name: "T5 Encoder", exact: true }).click();
  await page.getByRole("option", { name: "t5-selected.safetensors", exact: true }).click();
  await page.getByRole("combobox", { name: "Weight Type", exact: true }).click();
  await page.getByRole("option", { name: "fp8_e4m3fn", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "CLIP Encoder", exact: true })).toHaveValue(
    "clip-exact.safetensors",
  );
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
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { profiles: [profile], features: { library: true, presets: true } } }),
  );
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
  const size = page.getByRole("button", { name: "Image Size", exact: true });
  await size.click();
  await page.getByText("Custom", { exact: true }).click();
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("1280");
  await page.getByRole("textbox", { name: "Height", exact: true }).fill("768");
  await size.click();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await page
    .getByRole("button", { name: "Use reference: Portrait framing source", exact: true })
    .click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await expect(size).toHaveText("Reference · 2:3");
  await size.click();
  await expect(
    page.getByText("The reference sets the output framing to 2:3.", { exact: true }),
  ).toBeVisible();
  await size.click();
  await page.getByText("Reference", { exact: true }).click();
  await expect(size).toHaveText("1280 × 768");
  await size.click();
  await page.getByText("Custom", { exact: true }).click();
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
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { profiles: [profile], features: { library: true, presets: true } } }),
  );
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
  await page.getByRole("combobox", { name: "Reference Slot", exact: true }).click();
  await page.getByRole("option", { name: "End · Optional", exact: true }).click();
  await page.getByRole("button", { name: "Use reference: Closing frame", exact: true }).click();
  await page.getByRole("button", { name: "Use References", exact: true }).click();
  await page.getByRole("button", { name: "Saved Presets", exact: true }).click();
  await page.getByRole("textbox", { name: "Preset Name", exact: true }).fill("End Frame Only");
  await page.getByRole("button", { name: "Save Preset", exact: true }).click();
  await expect.poll(() => state.presets.length).toBe(1);
  expect(state.presets[0].input.referenceAssets).toEqual([
    { assetId: "asset-ending", slot: "end" },
  ]);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("");
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
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await page.getByRole("button", { name: "Saved LoRA Stacks", exact: true }).click();
  await page.getByRole("combobox", { name: "Saved LoRA Stack", exact: true }).click();
  await page.getByRole("option", { name: "Copper Detail", exact: true }).click();
  await page.getByRole("button", { name: "Load LoRA Stack", exact: true }).click();
  const enabled = page.getByRole("switch", { name: "Enable Detail Slider", exact: true });
  await expect(enabled).not.toBeChecked();
  await expect(page.getByRole("textbox", { name: "Detail Slider", exact: true })).toHaveValue(
    "0.35",
  );
  await enabled.check();
  await page.getByRole("textbox", { name: "Detail Slider", exact: true }).fill("1.25");
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
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await page.getByRole("button", { name: "Saved LoRA Stacks", exact: true }).click();
  await page.getByRole("combobox", { name: "Saved LoRA Stack", exact: true }).click();
  await page.getByRole("option", { name: "Copper Detail Refined", exact: true }).click();
  await page.getByRole("button", { name: "Load LoRA Stack", exact: true }).click();
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
  await page.getByRole("button", { name: "Saved Presets", exact: true }).click();
  await page.getByRole("button", { name: "Masked Study", exact: true }).click();
  const role = page.getByRole("radiogroup", { name: "Reference Role", exact: true });
  await expect(role.getByRole("radio", { name: "Edit", exact: true })).toBeChecked();
  await expect(role.getByRole("radio", { name: "Reference", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(prompt).toHaveValue("");
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Seed", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Steps", exact: true })).toHaveValue("20");
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
  await original.getByRole("button", { name: "Edit & Rerun", exact: true }).click();
  const cardRole = original.getByRole("radiogroup", { name: "Reference Role", exact: true });
  await expect(cardRole.getByRole("radio", { name: "Edit", exact: true })).toBeChecked();
  await expect(cardRole.getByRole("radio", { name: "Reference", exact: true })).toBeDisabled();
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
  await page.getByRole("button", { name: "Saved Presets", exact: true }).click();
  await page.getByRole("button", { name: "Trigger Study", exact: true }).click();
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  const copy = page.getByRole("button", { name: "Copy Trigger Word: inkbird", exact: true });
  await copy.click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedTrigger)).toBe("inkbird");
  const source = page.getByRole("link", { name: "View Source", exact: true });
  await expect(source).toHaveAttribute("href", sourceUrl);
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  expect(state.jobs).toHaveLength(0);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("A delicate bird inkbird");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.prompt).toBe("A delicate bird inkbird");
  expect(state.jobs[0].input.loras).toEqual([
    { name: "detail.safetensors", strength: 0.7, enabled: true },
  ]);
  await page.goto(`/chat/${state.jobs[0].sessionId}`);
  await page.getByRole("button", { name: "Edit & Rerun", exact: true }).click();
  await page.getByRole("button", { name: "Expert Controls", exact: true }).click();
  await copy.click();
  await expect.poll(() => page.evaluate(() => (window as any).copiedTrigger)).toBe("inkbird");
  await expect(source).toHaveAttribute("href", sourceUrl);
  expect(state.jobs).toHaveLength(1);
  expect(state.chatRequests).toHaveLength(0);
});

test("Generation actions stay reachable while expert fields and references scroll", async ({
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
  await page
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Keep the actions in reach");
  const generate = page.getByRole("button", { name: "Generate Image", exact: true });
  if (isMobile) {
    await expect
      .poll(async () => {
        const button = await generate.boundingBox();
        return button!.y + button!.height;
      })
      .toBeGreaterThan(page.viewportSize()!.height - 48);
  }
  await page.getByRole("button", { name: "Expert Controls", exact: true }).press("Enter");
  const fields = page.getByLabel(
    isMobile ? "Generation Controls Scroll Area" : "Generation Fields",
    { exact: true },
  );
  await expect
    .poll(() => fields.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);
  await expect(generate).toBeInViewport();
  const initial = await generate.boundingBox();
  if (isMobile)
    expect(initial!.y + initial!.height).toBeGreaterThan(page.viewportSize()!.height - 48);
  await fields.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await expect(page.getByRole("textbox", { name: "Seed", exact: true })).toBeInViewport();
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
  await expect(useReferences).toBeInViewport();
  if (isMobile) {
    const footer = await useReferences.boundingBox();
    expect(footer!.y + footer!.height).toBeGreaterThan(page.viewportSize()!.height - 48);
  }
  await useReferences.click();
  await generate.click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.referenceAssets).toHaveLength(1);
  expect(state.jobs[0].input.prompt).toBe("Keep the actions in reach");
});
