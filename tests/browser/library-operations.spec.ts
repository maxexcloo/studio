import { expect, test } from "@playwright/test";

import {
  chooseView,
  closeLoras,
  create,
  expandComposer,
  fixtures,
  image,
  loadFromLibrary,
  openLoraChoices,
  openNav,
  openPresets,
  profiles,
  section,
  stamp,
  toolbarSearch,
} from "./fixtures";

test("The Library groups AI, Cards and Generation, sets Files and Imports apart and opens on the Chat Brief", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/library");
  const groups = {
    AI: ["Chat Brief", "Presets"],
    Cards: ["Characters", "Outfits", "Scenes"],
    Generation: ["Guides", "LoRAs", "Profiles", "Prompt Styles"],
  };
  const order = [...Object.values(groups).flat(), "Files", "Imports"];
  if ((page.viewportSize()?.width || 1440) < 768) {
    const select = page.getByRole("combobox", { name: "Library Section", exact: true });
    await expect(select).toHaveValue("Chat Brief");
    await select.click();
    await expect(page.getByRole("option")).toHaveText(order);
  } else {
    const nav = page.getByRole("navigation", { name: "Library Sections", exact: true });
    await expect(nav.getByRole("link", { name: "Chat Brief", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const [group, links] of Object.entries(groups))
      await expect(
        nav.getByRole("group", { name: group, exact: true }).getByRole("link"),
      ).toHaveText(links);
    await expect(nav.getByRole("link")).toHaveText(order);
  }
});

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
    status: "failed",
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
  await section(page, "Library", "Imports");
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
  await actions(active.file, "Stop Download");
  await expect(page.getByText("Worker is reconnecting. Try again.", { exact: true })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: active.file })).toContainText(
    "Downloading",
  );
  await actions(active.file, "Stop Download");
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
  // The lasting failure notification would sit over the phone composer's chips.
  await page.locator(".mantine-Notification-root").getByRole("button").click();
  await expandComposer(page);
  const profile = page.getByRole("combobox", { name: "Profile", exact: true });
  await profile.click();
  await page.getByRole("option", { name: /^Downloaded Model\b/ }).click();
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
  await section(page, "Library", "Files");
  const table = page.getByRole("table", { name: "Library Files", exact: true });
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

test("Update All applies every free update in one request", async ({ page }) => {
  await fixtures(page);
  let all = false;
  const item = (name: string, update: object) => ({
    key: `loras/${name}.safetensors`,
    title: name,
    file: `${name}.safetensors`,
    folder: "loras",
    kind: "lora",
    installed: true,
    families: ["test"],
    update: { state: "available", ...update },
    ...(all ? { applied: { state: "downloading", note: "Downloading." } } : {}),
  });
  await page.route("**/api/library/items", (route) =>
    route.fulfill({
      json: {
        items: [
          item("Style", { latest: { name: "Style 2", downloadable: true } }),
          {
            ...item("Detail", {
              latest: { name: "Detail 3", downloadable: false, unavailable: { reason: "paid" } },
              freeAlternative: { name: "Detail 2", downloadable: true },
            }),
            families: ["sdxl"],
          },
        ],
      },
    }),
  );
  const requests: unknown[] = [];
  await page.route("**/api/library/updates/apply", (route) => {
    requests.push(route.request().postDataJSON());
    all = true;
    return route.fulfill({ json: { ok: true, available: 2, started: 2, failed: [] } });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "LoRAs");
  const loras = page.getByRole("region", { name: "Library: LoRAs", exact: true });
  await loras.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filter LoRAs", exact: true });
  const family = filters.getByRole("combobox", { name: "Family", exact: true });
  await expect(family).toHaveValue("");
  await family.click();
  await page.getByRole("option", { name: "SDXL", exact: true }).click();
  const table = loras.getByRole("table", { name: "Library LoRAs", exact: true });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Detail");
  await filters.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(3);
  await loras.getByRole("button", { name: "Filter LoRAs", exact: true }).click();
  await loras.getByRole("button", { name: "Update All", exact: true }).click();
  await expect(loras.getByText("2 updates queued.", { exact: true })).toBeVisible();
  await expect(loras.getByRole("button", { name: "Update All", exact: true })).toBeHidden();
  expect(requests).toEqual([{ all: true }]);
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
    audit: "ready",
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
  await section(page, "Library", "Imports");
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
    page.getByText("Profile drafted. Review it in Library › Profiles.", { exact: true }).first(),
  ).toBeVisible();
  await expect(button).toBeHidden();
  await expect.poll(() => modelReads).toBeGreaterThan(previousReads);
  expect(attempts).toBe(2);
});

test("Imports group by what they need: Download All Missing, substitutes to accept or reject, Clear Stale and Delete", async ({
  page,
}) => {
  await fixtures(page);
  const requests: { path: string; body: unknown }[] = [];
  let records = [
    {
      id: "imp-missing",
      name: "Missing Model",
      state: "needs-files",
      audit: "needs-files",
      resources: [
        {
          name: "missing.safetensors",
          want: { file: "missing.safetensors", folder: "loras" },
          status: "missing",
          downloadable: true,
        },
      ],
    },
    {
      id: "imp-close",
      name: "Close Recipe",
      state: "ready",
      audit: "substitute",
      resources: [
        {
          name: "DreamShaper",
          want: { file: "dreamshaper_8.safetensors", folder: "checkpoints" },
          status: "substitute",
          substitute: { file: "dreamshaper_9.safetensors", reason: "Version 9 instead of 8" },
        },
      ],
    },
    {
      id: "imp-failed",
      name: "Blocked Model",
      state: "failed",
      audit: "failed",
      stale: true,
      error: "HTTP 451",
      resources: [],
    },
    { id: "imp-ready", name: "Kept Model", state: "ready", audit: "ready", resources: [] },
  ];
  await page.route("**/api/library/imports**", (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (method === "POST") requests.push({ path: pathname, body: route.request().postDataJSON() });
    if (pathname.endsWith("/clear-stale")) {
      const before = records.length;
      records = records.filter((record) => !record.stale);
      return route.fulfill({ json: { ok: true, cleared: before - records.length } });
    }
    if (pathname.endsWith("/download-missing"))
      return route.fulfill({ json: { ok: true, queued: 1, imports: 1, failures: [] } });
    if (pathname.endsWith("/substitute")) {
      records = records.map((record) =>
        record.id === "imp-close" ? { ...record, audit: "ready" } : record,
      );
      return route.fulfill({ json: { ok: true, import: records[1] } });
    }
    if (method === "DELETE") {
      records = records.filter((record) => !pathname.endsWith(`/${record.id}`));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { imports: records } });
  });
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Imports");
  const needs = page.getByRole("region", { name: "Needs Files · 1", exact: true });
  await expect(needs).toContainText("missing.safetensors: Not downloaded yet");
  await needs.getByRole("button", { name: "Download All Missing", exact: true }).click();
  // A substitute shows beside the file it stands in for.
  const substitutes = page.getByRole("table", { name: "Substitutes", exact: true });
  await expect(substitutes).toContainText("dreamshaper_8.safetensors");
  await expect(substitutes).toContainText("dreamshaper_9.safetensors");
  await substitutes
    .getByRole("button", {
      name: "Actions for Close Recipe: dreamshaper_8.safetensors",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Accept", exact: true }).click();
  await expect(substitutes).toBeHidden();
  expect(requests).toEqual([
    { path: "/api/library/imports/download-missing", body: {} },
    { path: "/api/library/imports/imp-close/substitute", body: { index: 0, accept: true } },
  ]);
  await page.getByRole("button", { name: "Clear Stale", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Clear Stale Imports" })
    .getByRole("button", { name: "Clear Stale", exact: true })
    .click();
  await expect(page.getByText("1 cleared", { exact: true })).toBeVisible();
  await expect(page.getByText("Blocked Model", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Clear Stale", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Actions for Kept Model", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete Import", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Import", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByText("Kept Model", { exact: true })).toBeHidden();
});

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
  await page.goto("/library#files");
  const table = page.getByRole("table", { name: "Library Files", exact: true });
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
  await page
    .getByRole("dialog", { name: "Filter Models", exact: true })
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await expect(table.getByRole("row")).toHaveCount(3);
  await page.getByRole("button", { name: "Filter Models", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Filter Models", exact: true })).toBeHidden();
  await (await toolbarSearch(page, "Files")).fill("flux");
  await expect(table.getByRole("row")).toHaveCount(2);
  // Escape leaves search, keeping the query and the Library open.
  await page.keyboard.press("Escape");
  await expect(table).toContainText("Flux Base");
  await expect(table).not.toContainText("XL Base");
  await (await toolbarSearch(page, "Files")).fill("nothing");
  await expect(page.getByText("No Matches", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear Search", exact: true }).click();
  await page.keyboard.press("Escape");
  await chooseView(page, "Files", "Available");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Later Model");
});

test("Library shows import grades, and the Presets chip loads inspiration settings where they fit", async ({
  page,
}) => {
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
  await page.goto("/images");
  await openNav(page, "Library");
  await section(page, "Library", "Imports");
  await expect(page.getByText("Watercolour Inspiration", { exact: true })).toBeVisible();
  await expect(
    page.getByText("watercolour.safetensors: Not downloaded yet", { exact: true }),
  ).toBeVisible();
  await create(page);
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await openLoraChoices(page);
  await page.getByRole("button", { name: "Detail Slider", exact: true }).click();
  await closeLoras(page);
  // An imported image whose LoRA is missing gives only its prompt.
  await openPresets(page);
  await loadFromLibrary(page, "Missing Style Study");
  await expect(prompt).toHaveValue("A missing style study");
  await expect(page.getByRole("button", { name: "Save Preset", exact: true })).toBeHidden();
  await openPresets(page);
  await loadFromLibrary(page, "Amber Study");
  await expect(prompt).toHaveValue("Amber bird study");
  await page.getByRole("button", { name: "Generate Image", exact: true }).click();
  await expect.poll(() => state.jobs.length).toBe(1);
  expect(state.jobs[0].input.profileId).toBe("image:test");
  expect(state.jobs[0].input.steps).toBe(24);
  expect(state.jobs[0].input.loras).toEqual([]);
});

test("Library › Presets lists what each preset holds, renames with unique names, edits in the composer and deletes after asking", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.presets.push(
    {
      id: "heron",
      title: "Heron",
      input: { prompt: "A grey heron" },
      parts: ["prompt"],
      savedAt: stamp,
    },
    {
      id: "detail",
      title: "Fine Detail",
      input: { loras: [{ name: "detail.safetensors", strength: 0.8, enabled: true }] },
      parts: ["loras"],
      family: "test",
      savedAt: stamp,
    },
  );
  await page.goto("/library#presets");
  const table = page.getByRole("table", { name: "Presets", exact: true });
  await expect(table.getByRole("row", { name: /Heron/ })).toContainText("Prompt");
  // Saved dates read in Australian English whatever the browser's locale; phones leave them out.
  if (!test.info().project.use.isMobile)
    await expect(table.getByRole("row", { name: /Heron/ })).toContainText(/\d+ Oct 2026/);
  await expect(table.getByRole("row", { name: /Fine Detail/ })).toContainText("LoRAs");
  await page.getByRole("button", { name: "Actions for Heron", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename Preset", exact: true });
  const name = rename.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("fine detail");
  await expect(rename.getByText("A preset has this name", { exact: true })).toBeVisible();
  await expect(rename.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await name.fill("Grey Heron");
  await rename.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.presets[0].title).toBe("Grey Heron");
  await page.getByRole("button", { name: "Actions for Fine Detail", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete Preset", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect.poll(() => state.presets.map((preset) => preset.id)).toEqual(["heron"]);
  await page.getByRole("button", { name: "Actions for Grey Heron", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit in Composer", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A grey heron",
  );
});

test("Library preset loading confirms replacement and restores saved references without old run context", async ({
  page,
}) => {
  const state = await fixtures(page);
  const asset = {
    id: "saved-reference",
    name: "Saved Reference",
    slot: "image",
    url: image,
    thumbnailUrl: image,
    width: 1024,
    height: 1024,
  };
  state.presets.push({
    id: "reference-study",
    title: "Reference Study",
    input: {
      kind: "image",
      profileId: profiles[0].id,
      prompt: "A copper heron",
      referenceAssets: [{ assetId: asset.id, slot: "image" }],
      referenceDetails: [asset],
    },
  });
  await create(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("An unsaved owl");
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith("studio-composer-draft:"))!;
    const drafts = JSON.parse(localStorage.getItem(key)!);
    drafts.image.operation = "refine";
    drafts.image.parentItemId = "old-result";
    drafts.image.parentJobId = "old-job";
    drafts.image.references = [{ id: "old-reference", slot: "image" }];
    drafts.image.compare = { variants: [{ input: drafts.image.input, references: [] }], active: 0 };
    drafts.video.input.prompt = "Keep my video draft";
    localStorage.setItem(key, JSON.stringify(drafts));
  });
  await page.goto("/library#presets");
  await page.getByRole("button", { name: "Actions for Reference Study", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit in Composer", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Load Preset", exact: true });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Reference Study", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit in Composer", exact: true }).click();
  await confirm.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
    "A copper heron",
  );
  await expect(page.getByRole("img", { name: "Reference 1", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const entry = Object.keys(localStorage).find((key) =>
          key.startsWith("studio-composer-draft:"),
        );
        const draft = entry ? JSON.parse(localStorage.getItem(entry)!).image : {};
        return {
          references: draft.references?.map((reference: { id: string }) => reference.id),
          operation: draft.operation,
          parentItemId: draft.parentItemId,
          compare: draft.compare,
          videoPrompt: entry ? JSON.parse(localStorage.getItem(entry)!).video.input.prompt : "",
        };
      }),
    )
    .toEqual({
      references: [asset.id],
      operation: "image",
      parentItemId: undefined,
      compare: undefined,
      videoPrompt: "Keep my video draft",
    });
});

for (const surface of ["Library", "Composer"])
  for (const dirty of ["settings", "references"])
    test(`${surface} protects promptless ${dirty} only when the loaded preset overwrites them`, async ({
      page,
    }) => {
      const state = await fixtures(page);
      state.presets.push(
        {
          id: "full-replacement",
          title: "Full Replacement",
          input: {
            kind: "image",
            profileId: profiles[0].id,
            prompt: "A saved bird",
            steps: 20,
            seed: "7",
            referenceAssets: [],
            referenceDetails: [],
          },
        },
        {
          id: "prompt-only",
          title: "Prompt Only",
          parts: ["prompt"],
          input: { prompt: "A saved bird" },
        },
      );
      const references =
        dirty === "references"
          ? [
              {
                id: "manual",
                slot: "image",
                name: "Manual",
                url: image,
                thumbnailUrl: image,
                width: 1024,
                height: 1024,
              },
            ]
          : [];
      const seed = dirty === "settings" ? "42" : "";
      await page.addInitScript(
        ({ references, seed, profileId }) => {
          localStorage.setItem(
            "studio-composer-draft:local",
            JSON.stringify({
              image: {
                input: {
                  kind: "image",
                  profileId,
                  prompt: "",
                  negative: "",
                  steps: seed ? 37 : 20,
                  seed,
                  loras: [],
                  referenceAssets: references.map((asset) => ({
                    assetId: asset.id,
                    slot: asset.slot,
                  })),
                },
                references,
                operation: "image",
                sessionId: "",
              },
            }),
          );
        },
        { references, seed, profileId: profiles[0].id },
      );
      if (surface === "Library") {
        await page.goto("/library#presets");
        await page
          .getByRole("button", { name: "Actions for Full Replacement", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Edit in Composer", exact: true }).click();
        const confirmation = page.getByRole("dialog", { name: "Load Preset", exact: true });
        await expect(confirmation).toBeVisible();
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      } else {
        await create(page);
        await openPresets(page);
        await page.getByRole("combobox", { name: "Preset Name", exact: true }).click();
        await page.getByRole("option", { name: "Full Replacement", exact: true }).click();
        await expect(
          page.getByText("Replace the current prompt and settings with this preset?", {
            exact: true,
          }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      expect(
        await page.evaluate(() => {
          const draft = JSON.parse(localStorage.getItem("studio-composer-draft:local")!).image;
          return {
            prompt: draft.input.prompt,
            steps: draft.input.steps,
            seed: draft.input.seed,
            references: draft.references.map((asset: { id: string }) => asset.id),
          };
        }),
      ).toEqual({
        prompt: "",
        steps: seed ? 37 : 20,
        seed,
        references: references.map((asset) => asset.id),
      });
      if (surface === "Library") {
        await page.getByRole("button", { name: "Actions for Prompt Only", exact: true }).click();
        await page.getByRole("menuitem", { name: "Edit in Composer", exact: true }).click();
      } else {
        await page.getByRole("combobox", { name: "Preset Name", exact: true }).click();
        await page.getByRole("option", { name: "Prompt Only", exact: true }).click();
      }
      await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(
        "A saved bird",
      );
      await expect
        .poll(() =>
          page.evaluate(() => {
            const draft = JSON.parse(localStorage.getItem("studio-composer-draft:local")!).image;
            return {
              seed: draft.input.seed,
              references: draft.references.map((asset: { id: string }) => asset.id),
            };
          }),
        )
        .toEqual({ seed, references: references.map((asset) => asset.id) });
    });

test("Composer preset confirmation checks the output draft that will be overwritten", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.presets.push({
    id: "video-preset",
    title: "Video Preset",
    input: { kind: "video", profileId: profiles[1].id, prompt: "A saved video", seed: "7" },
  });
  await page.addInitScript(
    ({ imageProfile, videoProfile }) => {
      const draft = (kind: string, profileId: string, seed: string) => ({
        input: { kind, profileId, prompt: "", seed },
        references: [],
        sessionId: "",
        operation: kind === "image" ? "image" : "animate",
      });
      localStorage.setItem(
        "studio-composer-draft:local",
        JSON.stringify({
          image: draft("image", imageProfile, ""),
          video: draft("video", videoProfile, "42"),
        }),
      );
    },
    { imageProfile: profiles[0].id, videoProfile: profiles[1].id },
  );
  await create(page);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("studio-composer-draft:local")!).video.input.seed,
    ),
  ).toBe("42");
  await openPresets(page);
  await page.getByRole("combobox", { name: "Preset Name", exact: true }).click();
  await page.getByRole("option", { name: "Video Preset", exact: true }).click();
  await expect(
    page.getByText("Replace the current prompt and settings with this preset?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("studio-composer-draft:local")!).video.input.seed,
    ),
  ).toBe("42");
});
