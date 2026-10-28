import { expect, test } from "@playwright/test";
import {
  chooseView,
  closeLoras,
  create,
  fixtures,
  openNav,
  profiles,
  section,
  serveProfiles,
  signIn,
} from "./fixtures";

test("Model downloads cancel only the chosen file and explicitly resume or retry", async ({
  page,
}) => {
  const studio = await fixtures(page);
  let modelReads = 0;
  let freshModelReads = 0;
  const downloadedProfile = {
    ...profiles[0],
    id: "image:downloaded",
    label: "Downloaded Model",
    recipe: undefined,
  };
  await page.route(/\/api\/models(?:\?.*)?$/, (route) => {
    modelReads++;
    const fresh = !new URL(route.request().url()).searchParams.has("cached");
    if (fresh) freshModelReads++;
    // Like the server, a fresh read refreshes the cached catalogue that later cached reads return.
    return route.fulfill({
      json: {
        profiles: freshModelReads ? [...profiles, downloadedProfile] : profiles,
        features: { library: true, presets: true },
      },
    });
  });
  studio.jobs.push({
    id: "generation-kept",
    status: "running",
    input: { prompt: "Keep generating" },
  });
  const active = {
    id: "active",
    file: "active.safetensors",
    folder: "loras",
    status: "downloading",
    receivedBytes: 1048576,
    totalBytes: 4194304,
  };
  const queued = { id: "queued", file: "queued.safetensors", folder: "loras", status: "queued" };
  const paused = {
    id: "paused",
    file: "paused.safetensors",
    folder: "loras",
    status: "paused",
    receivedBytes: 2097152,
    totalBytes: 4194304,
  };
  const failed = {
    id: "failed",
    file: "failed.safetensors",
    folder: "loras",
    status: "error",
    error: "Connection interrupted",
    retryable: true,
  };
  const state = {
    active: active as typeof active | null,
    queued: [queued],
    paused: [paused],
    recent: [
      failed,
      {
        id: "completed",
        file: "completed.safetensors",
        folder: "loras",
        status: "done",
        finishedAt: "2026-10-23T10:00:00.000Z",
      },
    ] as any[],
  };
  const requests: { path: string; id: string }[] = [];
  let failCancel = true;
  await page.route("**/api/models/downloads**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const { id } = route.request().postDataJSON();
      requests.push({ path, id });
      if (path.endsWith("/cancel")) {
        if (failCancel) {
          failCancel = false;
          return route.fulfill({
            status: 503,
            json: { error: "Worker is reconnecting. Try again." },
          });
        }
        expect(id).toBe(active.id);
        state.active = null;
        state.paused.push({ ...active, status: "paused" });
      } else {
        const source = [...state.paused, ...state.recent].find((item) => item.id === id);
        expect(source).toBeTruthy();
        state.paused = state.paused.filter((item) => item.id !== id);
        state.recent = state.recent.filter((item) => item.id !== id);
        state.queued.push({ ...source, status: "queued" });
      }
    }
    return route.fulfill({ json: state });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  const readsBeforeDownloads = modelReads;
  await section(page, "Library", "Downloads");
  const table = page.getByRole("table", { name: "Model Downloads" });
  await expect(table.getByRole("row").filter({ hasText: active.file })).toContainText(
    "Downloading",
  );
  expect(requests).toEqual([]);
  await expect(table.getByRole("row").filter({ hasText: "completed.safetensors" })).toContainText(
    "Completed",
  );
  await expect.poll(() => modelReads).toBeGreaterThan(readsBeforeDownloads);
  const actions = async (file: string, action: string) => {
    await table.getByRole("button", { name: `Actions for ${file}`, exact: true }).click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    await expect(page.getByRole("menu")).toBeHidden();
  };
  await actions(active.file, "Cancel Download");
  await expect(page.getByText("Worker is reconnecting. Try again.", { exact: true })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: active.file })).toContainText(
    "Downloading",
  );
  await actions(active.file, "Cancel Download");
  await expect(table.getByRole("row").filter({ hasText: active.file })).toContainText("Paused");
  await expect(table.getByRole("row").filter({ hasText: queued.file })).toContainText("Queued");
  await actions(paused.file, "Resume Download");
  await expect(table.getByRole("row").filter({ hasText: paused.file })).toContainText("Queued");
  await actions(failed.file, "Retry Download");
  await expect(table.getByRole("row").filter({ hasText: failed.file })).toContainText("Queued");
  expect(requests).toEqual([
    { path: "/api/models/downloads/cancel", id: active.id },
    { path: "/api/models/downloads/cancel", id: active.id },
    { path: "/api/models/downloads", id: paused.id },
    { path: "/api/models/downloads", id: failed.id },
  ]);
  expect(studio.jobs[0].status).toBe("running");
  expect(freshModelReads).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Library", exact: true })).toBeHidden();
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click();
  const profile = page.getByRole("combobox", { name: "Profile", exact: true });
  await profile.click();
  await page.getByRole("option", { name: "Downloaded Model", exact: true }).click();
  await expect(profile).toHaveText("Downloaded Model");
  expect(studio.jobs).toHaveLength(1);
});

test("Catalogue checks updates and queues only the explicitly chosen available or free version", async ({
  page,
}) => {
  await fixtures(page);
  let checked = false,
    replacementVerified = false;
  const applied: { key: string; alternative?: boolean }[] = [];
  const items = [
    {
      key: "checkpoints/base.safetensors",
      title: "Base Model",
      file: "base.safetensors",
      folder: "checkpoints",
      kind: "checkpoint",
      installed: true,
      families: ["test"],
    },
    {
      key: "checkpoints/paid.safetensors",
      title: "Paid Version Model",
      file: "paid.safetensors",
      folder: "checkpoints",
      kind: "checkpoint",
      installed: true,
      families: ["test"],
    },
  ];
  await page.route("**/api/library/items", (route) =>
    route.fulfill({
      json: {
        items: items.map((item, index) => ({
          ...item,
          update: checked
            ? {
                state: "available",
                latest: index
                  ? {
                      name: "Paid 3",
                      downloadable: false,
                      unavailable: { reason: "paid", note: "Paid release" },
                    }
                  : { name: "Version 2", downloadable: true },
                ...(index
                  ? {
                      freeAlternative: { name: "Free 2", downloadable: true },
                      note: "Paid 3 is paid; Free 2 is free.",
                    }
                  : {}),
              }
            : { state: "current" },
          ...(applied.some((choice) => choice.key === item.key)
            ? {
                applied: {
                  state: replacementVerified && index === 0 ? "kept" : "downloading",
                  note:
                    replacementVerified && index === 0
                      ? "Replacement verified; existing file retained because a profile still uses it."
                      : "Existing file retained while its replacement downloads.",
                },
              }
            : {}),
        })),
      },
    }),
  );
  await page.route("**/api/library/updates/**", async (route) => {
    if (route.request().url().endsWith("/check")) checked = true;
    else applied.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, available: 2 } });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Models");
  const table = page.getByRole("table", { name: "Library Models", exact: true });
  await expect(table.getByText("Base Model", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check Updates", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: "Base Model" })).toContainText(
    "Update Available",
  );
  expect(applied).toEqual([]);
  await table.getByRole("button", { name: "Actions for Base Model", exact: true }).click();
  await page.getByRole("menuitem", { name: "Update to Version 2", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: "Base Model" })).toContainText("Updating");
  await table.getByRole("button", { name: "Actions for Paid Version Model", exact: true }).click();
  await page.getByRole("menuitem", { name: "Update to Free 2", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: "Paid Version Model" })).toContainText(
    "Updating",
  );
  expect(applied).toEqual([{ key: items[0].key }, { key: items[1].key, alternative: true }]);
  replacementVerified = true;
  await page.getByRole("button", { name: "Check Updates", exact: true }).click();
  const original = table.getByRole("row").filter({ hasText: "Base Model" });
  await expect(original).toContainText(
    "Replacement verified; existing file retained because a profile still uses it.",
  );
  await expect(original.getByText("Installed", { exact: true })).toBeVisible();
  await original.getByRole("button", { name: "Actions for Base Model", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Update to / })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(applied).toHaveLength(2);
});

test("A checkpoint profile draft can be retried after failure and refreshed into the model choices", async ({
  page,
}) => {
  await fixtures(page);
  let drafted = false,
    attempts = 0,
    modelReads = 0;
  const record = () => ({
    id: "checkpoint",
    title: "Imported Checkpoint",
    state: "ready",
    input: { kind: "hf-file" },
    grade: { value: "Ready", reasons: [] },
    resources: [
      { name: "checkpoint.safetensors", status: "installed", role: "checkpoint", optional: false },
    ],
    results: drafted ? { profileId: "custom:checkpoint" } : {},
  });
  await page.route(/\/api\/models(?:\?.*)?$/, (route) => {
    modelReads++;
    return route.fulfill({
      json: {
        profiles: drafted
          ? [...profiles, { ...profiles[0], id: "custom:checkpoint", label: "Imported Checkpoint" }]
          : profiles,
        features: { library: true, presets: true },
      },
    });
  });
  await page.route("**/api/library/imports**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/draft-profile")) {
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Draft assistant unavailable; existing import retained." },
        });
      drafted = true;
    }
    return route.fulfill({
      json: path === "/api/library/imports" ? { imports: [record()] } : { import: record() },
    });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await page.getByRole("button", { name: "Actions for Imported Checkpoint", exact: true }).click();
  await page.getByRole("menuitem", { name: "Review Import", exact: true }).click();
  const button = page.getByRole("button", { name: "Draft Profile", exact: true });
  await button.click();
  await expect(
    page.getByText("Draft assistant unavailable; existing import retained.", { exact: true }),
  ).toBeVisible();
  await expect(button).toBeEnabled();
  const previousReads = modelReads;
  await button.click();
  await expect(
    page.getByText("Profile drafted. Review it in Settings › Profiles.", { exact: true }).first(),
  ).toBeVisible();
  await expect(button).toBeHidden();
  await expect.poll(() => modelReads).toBeGreaterThan(previousReads);
  expect(attempts).toBe(2);
});

for (const ordinary of [true, false])
  test(
    ordinary
      ? "Ordinary accounts read catalogues without administrative or preset actions"
      : "Administrators retain model management when deployment imports are disabled",
    async ({ page }) => {
      await fixtures(page);
      if (ordinary) await signIn(page, { id: "member", role: "user" });
      await serveProfiles(page, profiles, { library: true, presets: !ordinary ? false : true });
      let unavailableReads = 0;
      for (const pattern of ["**/api/library/imports**", "**/api/presets**"])
        await page.route(pattern, (route) => {
          unavailableReads++;
          return route.fulfill({
            status: 403,
            json: { error: "Unavailable for this account or deployment." },
          });
        });
      await page.goto("/images");
      await openNav(page, "Library");
      await section(page, "Library", "Models");
      await chooseView(page, "Models", "Available");
      await expect(
        page
          .getByRole("table", { name: "Library Models", exact: true })
          .getByText("Base Model", { exact: true }),
      ).toBeVisible();
      if (ordinary)
        await expect(page.getByRole("button", { name: "Check Updates", exact: true })).toBeHidden();
      else
        await expect(
          page.getByRole("button", { name: "Check Updates", exact: true }),
        ).toBeVisible();
      if ((page.viewportSize()?.width || 1440) < 768) {
        await page.getByRole("combobox", { name: "Library Section", exact: true }).click();
        for (const name of ["Imports", "Inspiration", ...(ordinary ? ["Downloads"] : [])])
          await expect(page.getByRole("option", { name, exact: true })).toBeHidden();
      } else
        for (const name of ["Imports", "Inspiration", ...(ordinary ? ["Downloads"] : [])])
          await expect(
            page
              .getByRole("navigation", { name: "Library Sections", exact: true })
              .getByRole("link", { name, exact: true }),
          ).toBeHidden();
      expect(unavailableReads).toBe(0);
    },
  );

test("Catalogue views, sorting, search and filters order and narrow the list", async ({ page }) => {
  await fixtures(page);
  const model = (key: string, title: string, families: string[], installed = true) => ({
    key: `diffusion_models/${key}.safetensors`,
    title,
    file: `${key}.safetensors`,
    folder: "diffusion_models",
    kind: "diffusion_model",
    installed,
    families,
  });
  await page.route("**/api/library/items", (route) =>
    route.fulfill({
      json: {
        items: [
          model("xl", "XL Base", ["sdxl"]),
          model("flux", "Flux Base", ["flux2_dev"]),
          model("later", "Later Model", ["sdxl"], false),
        ],
      },
    }),
  );
  await page.goto("/library#models");
  const table = page.getByRole("table", { name: "Library Models", exact: true });
  await expect(table.getByRole("row")).toHaveCount(3);
  const names = table.getByRole("row").locator("td:first-child p:first-child");
  await expect(names).toHaveText(["Flux Base", "XL Base"]);
  const name = table.getByRole("columnheader", { name: "Name", exact: true });
  await expect(name).toHaveAttribute("aria-sort", "ascending");
  await name.getByRole("button").click();
  await expect(name).toHaveAttribute("aria-sort", "descending");
  await expect(names).toHaveText(["XL Base", "Flux Base"]);
  await page.getByRole("button", { name: "Filter Models", exact: true }).click();
  await page.getByRole("combobox", { name: "Family", exact: true }).click();
  await page.getByRole("option", { name: "SDXL", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("XL Base");
  await page.getByRole("button", { name: "Reset Filters", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.getByRole("button", { name: "Filter Models", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Models Filters", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Search Models", exact: true }).click();
  await page.getByRole("textbox", { name: "Search Models", exact: true }).fill("flux");
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search Models", exact: true })).toBeFocused();
  await expect(table).toContainText("Flux Base");
  await expect(table).not.toContainText("XL Base");
  await page.getByRole("button", { name: "Search Models", exact: true }).click();
  await page.getByRole("textbox", { name: "Search Models", exact: true }).fill("nothing");
  await expect(page.getByText("No Matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear Search", exact: true }).click();
  await page.keyboard.press("Escape");
  await chooseView(page, "Models", "Available");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Later Model");
});

test("Library shows import grades and reuses compatible inspiration settings", async ({ page }) => {
  const state = await fixtures(page);
  await page.route("**/api/presets", (route) =>
    route.fulfill({
      json: {
        presets: [
          {
            id: "plain",
            name: "Amber Study",
            prompt: "Amber bird study",
            negative: "blur",
            settings: { steps: 24 },
            resources: [{ profileId: "image:test" }],
          },
          {
            id: "missing",
            name: "Missing Style Study",
            prompt: "A missing style study",
            negative: "",
            settings: { model: "foreign-model" },
            resources: [{ folder: "loras", status: "missing", weight: 0.8 }],
          },
        ],
      },
    }),
  );
  await create(page);
  await page.getByRole("button", { name: "Choose LoRAs", exact: true }).click();
  await page.getByRole("button", { name: "Detail Slider", exact: true }).click();
  await closeLoras(page);
  const close = page.getByRole("button", { name: "Close Generate", exact: true });
  if (await close.isVisible()) await close.click();
  else await page.getByRole("textbox", { name: "Prompt", exact: true }).press("Escape");
  await openNav(page, "Library");
  await expect(page.getByText("Watercolour Inspiration", { exact: true })).toBeVisible();
  await expect(page.getByText("Watercolour LoRA is missing", { exact: true })).toBeVisible();
  await section(page, "Library", "Inspiration");
  const missing = page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByText("Missing Style Study", { exact: true }) });
  await expect(missing.getByRole("button", { name: "Use Settings", exact: true })).toBeDisabled();
  await expect(missing.getByRole("button", { name: "Use Prompt", exact: true })).toBeEnabled();
  await page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByText("Amber Study", { exact: true }) })
    .getByRole("button", { name: "Use Settings", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "Amber bird study",
  );
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.profileId).toBe("image:test");
  expect(state.jobs[0].input.loras).toEqual([]);
});
