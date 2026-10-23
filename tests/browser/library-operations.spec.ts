import { expect, test } from "@playwright/test";
import { fixtures, openNav, profiles, section } from "./fixtures";

test("Model downloads cancel only the chosen file and explicitly resume or retry", async ({
  page,
}) => {
  const studio = await fixtures(page);
  let modelReads = 0;
  await page.route("**/api/models", (route) => {
    modelReads++;
    return route.fallback();
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
    await table.getByRole("button", { name: `Download Actions for ${file}`, exact: true }).click();
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
  await table.getByRole("button", { name: "Update Actions for Base Model", exact: true }).click();
  await page.getByRole("menuitem", { name: "Update to Version 2", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: "Base Model" })).toContainText("Updating");
  await table
    .getByRole("button", { name: "Update Actions for Paid Version Model", exact: true })
    .click();
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
  await expect(
    original.getByRole("button", { name: "Update Actions for Base Model", exact: true }),
  ).toBeHidden();
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
  await page.route("**/api/models", (route) => {
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
  await page.getByRole("button", { name: "Review Import", exact: true }).click();
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

for (const ordinary of [true, false])
  test(
    ordinary
      ? "Ordinary accounts read catalogues without administrative or preset actions"
      : "Administrators retain model management when deployment imports are disabled",
    async ({ page }) => {
      await fixtures(page);
      if (ordinary)
        await page.route("**/api/accounts/status", (route) =>
          route.fulfill({
            json: { mode: "multi-user", signedIn: true, account: { id: "member", role: "user" } },
          }),
        );
      await page.route("**/api/models", (route) =>
        route.fulfill({
          json: { profiles, features: { library: true, presets: !ordinary ? false : true } },
        }),
      );
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
