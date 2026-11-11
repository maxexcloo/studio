import { expect, test } from "@playwright/test";
import { profileForBackend } from "../../frontend/src/features/generation/payload";
import {
  closeLoras,
  closeReferences,
  combinedImageProfile,
  create,
  fixtures,
  image,
  serveProfiles,
  showUploads,
} from "./fixtures";

test("A backend projection uses only its own recipe and image modes", () => {
  const model = combinedImageProfile();
  delete model.backendOptions![0].profile!.recipe;
  const profile = {
    ...model,
    recipe: { label: "Previous backend" },
    editReferences: true,
    keepsCharacters: true,
    imageModes: { reference: { defaults: { cfg: 4 } } },
    aliases: ["old-profile"],
  };
  const selected = profileForBackend(profile, "comfyui")!;
  expect(selected.recipe).toBeUndefined();
  expect(selected.editReferences).toBeUndefined();
  expect(selected.keepsCharacters).toBeUndefined();
  expect(selected.imageModes).toBeUndefined();
  expect(selected.aliases).toEqual(["old-profile"]);
});

test("Switching image backends changes reference capacity and preserves an oversized draft", async ({
  page,
}) => {
  const state = await fixtures(page);
  await serveProfiles(page, [combinedImageProfile()]);
  let uploaded = 0;
  await page.route("**/api/reference-assets/upload", (route) =>
    route.fulfill({
      json: {
        asset: {
          id: `backend-reference-${++uploaded}`,
          name: "reference.png",
          url: image,
          thumbnailUrl: image,
          width: 1024,
          height: 1024,
        },
      },
    }),
  );
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Keep every reference");
  const backend = page.getByRole("combobox", { name: "Backend", exact: true });
  await backend.click();
  await page.getByRole("option", { name: "ComfyUI", exact: true }).click();
  await page.getByRole("button", { name: "Choose References", exact: true }).click();
  await showUploads(page);
  const picker = page.getByRole("region", { name: "References", exact: true });
  await picker.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 10 }, (_, i) => ({
      name: `reference-${i + 1}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    })),
  );
  await expect(
    picker.getByRole("button", { name: "Reference 10 · Reference Image", exact: true }),
  ).toBeVisible();
  await closeReferences(page);
  await backend.click();
  await page.getByRole("option", { name: "Radiance", exact: true }).click();
  const generate = page.getByRole("button", { name: "Generate Image", exact: true });
  await expect(generate).toHaveAttribute("aria-disabled", "true");
  await expect(generate).toHaveAttribute("aria-description", /at most 4 reference images/);
  await backend.click();
  await page.getByRole("option", { name: "ComfyUI", exact: true }).click();
  await generate.click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.profileBackend).toBe("comfyui");
  expect(state.jobs[0].input.referenceAssets).toHaveLength(10);
  expect(state.jobs[0].input.width).toBe(2048);
  expect(state.jobs[0].input.prompt).toBe("Keep every reference");
});

test("A text-only Radiance backend exposes ComfyUI reference controls when selected", async ({
  page,
}) => {
  await fixtures(page);
  await serveProfiles(page, [combinedImageProfile(0)]);
  await create(page);
  const backend = page.getByRole("combobox", { name: "Backend", exact: true });
  await expect(page.getByRole("button", { name: "Choose References", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "LoRAs", exact: true })).toContainText(
    "0 of 4 Enabled",
  );
  await closeLoras(page);
  await backend.click();
  await page.getByRole("option", { name: "ComfyUI", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose References", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "LoRAs", exact: true })).toContainText(
    "0 of 8 Enabled",
  );
  await closeLoras(page);
  await backend.click();
  await page.getByRole("option", { name: "Radiance", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose References", exact: true })).toHaveCount(0);
});
