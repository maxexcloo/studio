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
