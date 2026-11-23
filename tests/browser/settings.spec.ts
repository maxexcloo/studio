import { expect, test } from "@playwright/test";

import {
  dreamPolicyFixture,
  fixtures,
  image,
  openTheme,
  section,
  serveDream,
  signIn,
  stamp,
} from "./fixtures";

test("Settings follow the settled section order and run maintenance and worker refreshes", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const cleared: unknown[] = [];
  let statusReads = 0;
  await page.route("**/api/gallery/errors/clear", (route) => {
    cleared.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, cleared: 2, outputs: [] } });
  });
  await page.route("**/api/diagnostics", (route) =>
    route.fulfill({ json: { ok: true, text: "Studio 0.0.0" } }),
  );
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/services/status") statusReads++;
  });
  await page.goto("/settings");
  // Personal, then Administration, each alphabetical, with About last.
  const order = [
    "Account",
    "Dream",
    "Preferences",
    "Where Work Runs",
    "Dream Defaults",
    "Groups",
    "Studio",
    "Users",
    "Workers",
    "About",
  ];
  if ((page.viewportSize()?.width || 1440) < 768) {
    await page.getByRole("combobox", { name: "Settings Section", exact: true }).click();
    await expect(page.getByRole("option")).toHaveText(order);
    await page.keyboard.press("Escape");
  } else
    await expect(
      page.getByRole("navigation", { name: "Settings Sections", exact: true }).getByRole("link"),
    ).toHaveText(order);
  if ((page.viewportSize()?.width || 1440) >= 768)
    await expect(
      page.getByRole("group", { name: "Administration", exact: true }).getByRole("link"),
    ).toHaveText(order.slice(4, -1));
  await section(page, "Settings", "Studio");
  const danger = page.getByRole("region", { name: "Danger Zone", exact: true });
  await danger.getByRole("combobox", { name: "Whose Failed Items", exact: true }).click();
  await page.getByRole("option", { name: "member@example.test", exact: true }).click();
  await danger.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Failed Items", exact: true });
  await expect(confirm).toContainText("Remove member@example.test's failed and cancelled items");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(cleared).toEqual([{ owner: "member" }]);
  await section(page, "Settings", "Workers");
  // Each worker's status comes first, under the page's own title, one line each: what it runs, its
  // state, what waits for it and its free memory.
  const workers = page.getByRole("list", { name: "Workers", exact: true });
  await expect(workers.getByRole("listitem")).toHaveText([
    "Image Worker · Images, Upscale, Model Library · Busy · 2 Queued · 8.0 GiB Free",
    "Video Worker · Videos · Offline",
  ]);
  const before = statusReads;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => statusReads).toBeGreaterThan(before);
});

test("Gallery Captions in Settings › Studio catches up, shows its progress and stops", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const idle = {
    state: "ready",
    active: false,
    reason: "",
    done: 0,
    failed: 0,
    remaining: 9000,
    total: 9000,
    scope: "outdated",
    scopes: { all: 12_000, outdated: 9000, missing: 7000 },
    perMinute: 0,
    etaSeconds: null,
  };
  const running = {
    ...idle,
    state: "running",
    active: true,
    done: 120,
    remaining: 6880,
    total: 7000,
    scope: "missing",
    perMinute: 30,
    etaSeconds: 13_760,
  };
  let status: Record<string, unknown> = idle;
  const actions: unknown[] = [];
  await page.route("**/api/gallery/captions**", (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    if (action === "start") status = running;
    if (action === "stop") status = { ...running, state: "stopped", active: false, perMinute: 0 };
    if (action !== "captions") actions.push([action, route.request().postDataJSON()]);
    return route.fulfill({ json: status });
  });
  await page.goto("/settings#studio");
  const row = page.getByRole("region", { name: "Catch Up", exact: true });
  await expect(row.getByText("Ready · 9,000 to caption", { exact: true })).toBeVisible();
  await row.getByRole("combobox", { name: "Images to Caption", exact: true }).click();
  await page.getByRole("option", { name: "Missing (7,000)", exact: true }).click();
  await expect(row.getByText("Ready · 7,000 to caption", { exact: true })).toBeVisible();
  // Each feature's catch-up shares its row and name.
  const start = row.getByRole("button", { name: "Catch Up Gallery Captions", exact: true });
  await start.click();
  await expect(
    row.getByText("Running · 120 of 7,000 · 30 a minute · about 3 h 49 min left", { exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("progressbar", { name: "Caption Progress" })).toBeVisible();
  await row.getByRole("button", { name: "Stop Gallery Captions", exact: true }).click();
  await expect(row.getByText("Stopped · 120 of 7,000", { exact: true })).toBeVisible();
  await expect(start).toBeEnabled();
  expect(actions).toEqual([
    ["start", { scope: "missing" }],
    ["stop", {}],
  ]);
});

test("Unfinished Items in Settings › Workers retry, stop and clear any account's stuck jobs", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const job = (id: string, ownerId: string, prompt: string) => ({
    id,
    jobId: id,
    sessionId: "session",
    ownerId,
    dream: false,
    operation: "image",
    status: "running",
    reason: "Recovering the recorded generation; it will not be submitted again.",
    input: { prompt },
    items: [],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp,
  });
  let jobs = [job("stuck", "member", "A lost lighthouse"), job("slow", "admin", "A slow tide")];
  const actions: unknown[] = [];
  await page.route("**/api/maintenance/unfinished**", (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    if (action === "unfinished") return route.fulfill({ json: { jobs } });
    const body = route.request().postDataJSON();
    actions.push([action, body]);
    jobs = body.jobs ? [] : jobs.filter((entry) => entry.id !== body.id);
    return route.fulfill({ json: { job: jobs[0] } });
  });
  await page.goto("/settings#workers");
  const unfinished = page.getByRole("button", { name: "Unfinished Items", exact: true });
  await unfinished.click();
  const dialog = page.getByRole("dialog", { name: "Unfinished Items", exact: true });
  await expect(dialog.getByRole("row", { name: "A lost lighthouse" })).toContainText(
    "member@example.test",
  );
  await dialog.getByRole("button", { name: "Actions for A lost lighthouse", exact: true }).click();
  await page.getByRole("menuitem", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("row", { name: "A lost lighthouse" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Actions for A slow tide", exact: true }).click();
  await page.getByRole("menuitem", { name: "Clear", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Clear Unfinished Item", exact: true });
  await confirm.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(dialog.getByText("No Unfinished Items", { exact: true })).toBeVisible();
  // Every listed job at once: Stop All and Clear All confirm first.
  jobs = [job("one", "member", "A first owl"), job("two", "admin", "A second owl")];
  await page.reload();
  await unfinished.click();
  await expect(dialog.getByRole("row", { name: "A second owl" })).toBeVisible();
  await dialog.getByRole("button", { name: "Clear All", exact: true }).click();
  const clearAll = page.getByRole("dialog", { name: "Clear All Unfinished Items", exact: true });
  // Escape closes only the confirmation, leaving the list under it.
  await expect(clearAll).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(clearAll).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Clear All", exact: true }).click();
  await clearAll.getByRole("button", { name: "Clear All", exact: true }).click();
  await expect(dialog.getByText("No Unfinished Items", { exact: true })).toBeVisible();
  expect(actions).toEqual([
    ["retry", { ownerId: "member", id: "stuck" }],
    ["delete", { ownerId: "admin", id: "slow" }],
    [
      "delete-all",
      {
        jobs: [
          { ownerId: "member", id: "one" },
          { ownerId: "admin", id: "two" },
        ],
      },
    ],
  ]);
  // Clear All took its own button away; focus stays in the list, so its Escape still works, and
  // closes only the topmost dialog, leaving Settings open.
  await expect(clearAll).toBeHidden();
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: /^Settings/ })).toBeVisible();

  await unfinished.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("No Unfinished Items", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(unfinished).toBeFocused();
});

test("Tile Captions in Settings › Preferences pin phone tile captions", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, "Desktop shows captions on hover.");
  const state = await fixtures(page);
  state.gallery.push({
    id: "captioned",
    type: "image",
    status: "done",
    url: image,
    thumbnailUrl: image,
    prompt: "A quiet harbour, dawn light",
    createdAt: stamp,
  });
  await page.goto("/images");
  const caption = page.getByText("Quiet Harbour", { exact: true });
  await expect(
    page.getByRole("button", { name: "Open image: Quiet Harbour", exact: true }),
  ).toBeVisible();
  await expect(caption).toHaveCount(0);
  await page.goto("/settings#preferences");
  // The unlabelled track sits over the input; the row's accessible name is on the input.
  const toggle = page.getByRole("switch", { name: "Tile Captions", exact: true });
  // Force skips the wait for the switch to enable once the account's preferences load.
  await expect(toggle).toBeEnabled();
  await toggle.click({ force: true });
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(caption).toBeVisible();
  expect(state.preferences.preferences.tileCaptions).toBe(true);
});

test("An administrator turns LoRAs and Uncensored off for itself in Preferences", async ({
  page,
}) => {
  const state = await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  state.preferences.grants = { loras: true, uncensoredModels: true };
  await page.goto("/settings#preferences");
  const models = page.getByRole("region", { name: "Model Access", exact: true });
  await expect(models.getByRole("switch")).toHaveCount(2);
  const loras = models.getByRole("switch", { name: "LoRAs", exact: true });
  await expect(loras).toBeChecked();
  await loras.click({ force: true });
  await expect(loras).not.toBeChecked();
  await expect.poll(() => state.preferences.preferences.loras).toBe(false);
  const uncensored = models.getByRole("switch", { name: "Uncensored", exact: true });
  await expect(uncensored).toBeChecked();
  await uncensored.click({ force: true });
  await expect(uncensored).not.toBeChecked();
  await expect.poll(() => state.preferences.preferences.uncensoredModels).toBe(false);
});

test("Where Work Runs saves each group’s processing and default models", async ({ page }) => {
  const state = await fixtures(page);
  const dream = await serveDream(page, { enabled: true });
  await signIn(page, { id: "member", role: "user" });
  state.preferences.preferences.videos = "local";
  await page.route("**/api/assistant", (route) =>
    route.fulfill({
      json: {
        available: true,
        presets: [],
        writingModel: "cloud/uncensored",
        models: ["cloud/auto", "cloud/deepseek-flash-uncensored", "cloud/uncensored", "local/auto"],
      },
    }),
  );
  await page.goto("/settings#preferences");
  const prompts = page.getByRole("region", { name: "Prompts", exact: true });
  await expect(prompts.getByRole("switch", { name: "Keep Recent Prompts" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Prompt Assistant" })).toHaveCount(0);

  await section(page, "Settings", "Where Work Runs");
  const where = page.getByRole("region", { name: "Settings: Where Work Runs", exact: true });
  const group = (kind: string) => where.getByRole("region", { name: kind, exact: true });
  const workGroups = where.getByRole("region", { name: /^(Images|Videos|Dream|Text)$/ });
  await expect
    .poll(() => workGroups.evaluateAll((groups) => groups.map((group) => group.ariaLabel)))
    .toEqual(["Images", "Videos", "Dream", "Text"]);
  const textCloud = group("Text").getByRole("combobox", { name: "Cloud Model", exact: true });
  await expect(textCloud).toHaveText("Studio's Default");
  await textCloud.click();
  const options = page
    .getByRole("listbox")
    .getByRole("group", { name: "Cloud", exact: true })
    .getByRole("option");
  await expect(options).toHaveText(["Auto", "DeepSeek Flash Uncensored", "Uncensored"]);
  // The list scrolls inside the Settings modal and its choice applies at once.
  await options.last().scrollIntoViewIfNeeded();
  await options.last().click();
  await expect.poll(() => state.preferences.preferences.textCloud).toBe("cloud/uncensored");
  await expect(textCloud).toHaveText("Cloud · Uncensored");
  await group("Text").getByRole("button", { name: "Clear Cloud Model", exact: true }).click();
  await expect.poll(() => state.preferences.preferences.textCloud).toBeNull();
  await expect(textCloud).toHaveText("Studio's Default");
  const area = (kind: string) =>
    group(kind).getByRole("radiogroup", { name: `${kind} Run On`, exact: true });
  const choose = (name: string, choice: string) =>
    area(name).locator("label").filter({ hasText: choice }).click();
  await expect(area("Images").getByRole("radio", { name: "Local" })).toBeChecked();
  // Text runs on Cloud until the account picks Local.
  await expect(area("Text").getByRole("radio", { name: "Cloud" })).toBeChecked();
  await choose("Text", "Local");
  await expect.poll(() => state.preferences.preferences.text).toBe("local");
  await expect(area("Videos").getByRole("radio", { name: "Local" })).toBeChecked();
  await choose("Images", "Cloud");
  await expect.poll(() => state.preferences.preferences.images).toBe("cloud");
  await choose("Videos", "Cloud");
  await expect.poll(() => state.preferences.preferences.videos).toBe("cloud");
  await choose("Videos", "Local");
  await expect.poll(() => state.preferences.preferences.videos).toBe("local");
  await group("Images").getByRole("combobox", { name: "Default Aspect", exact: true }).click();
  await page.getByRole("option", { name: "16:9", exact: true }).click();
  await expect.poll(() => state.preferences.preferences.imageAspect).toBe("16:9");
  const dreamImages = group("Dream").getByRole("radiogroup", { name: "Dream Images" });
  await dreamImages.getByText("Cloud", { exact: true }).click();
  await expect.poll(() => dream.settings.imageBackend).toBe("cloud");
});

test("Header appearance preferences persist across reloads", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  await openTheme(page);
  const popup = await page.locator('.mantine-Popover-dropdown[role="dialog"]').boundingBox();
  const trigger = await page.getByRole("button", { name: "Appearance", exact: true }).boundingBox();
  expect(popup!.y).toBeGreaterThanOrEqual(trigger!.y + trigger!.height);
  await page.getByRole("button", { name: "Use Blue Colour", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Background", exact: true })
    .getByText("Warm", { exact: true })
    .click();
  const animations = page.getByRole("radiogroup", { name: "Animations", exact: true });
  for (const label of ["Off", "Fast", "Standard", "Relaxed"]) {
    await animations.getByText(label, { exact: true }).click();
    await expect(animations.getByRole("radio", { name: label, exact: true })).toBeChecked();
  }
  await animations.getByText("Fast", { exact: true }).click();
  await page.getByText("Round", { exact: true }).click();
  await page.getByText("Dark", { exact: true }).click();
  await page.getByText("Fixed Width", { exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await openTheme(page);
  await expect(page.getByRole("button", { name: "Use Blue Colour", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("radio", { name: "Warm", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Fast", exact: true })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(23, 19, 15)");
  await expect(page.getByRole("radio", { name: "Round", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Fixed Width", exact: true })).toBeChecked();
});

test("Administrator accounts retain worker visibility and attribution", async ({ page }) => {
  await fixtures(page);
  await signIn(page, { id: "account-a", role: "administrator" });
  await page.goto("/settings");
  await expect(
    page
      .getByRole("region", { name: "Settings: Account", exact: true })
      .getByText("Administrator", { exact: true }),
  ).toBeVisible();
  await section(page, "Settings", "Workers");
  await expect(page.getByRole("region", { name: "Settings: Workers", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Workers", exact: true })).toContainText(
    "Image Worker",
  );
  await page.route("**/api/stats", (route) =>
    route.fulfill({ json: { version: "ef19c18", releaseVersion: "v2026.1.1.1" } }),
  );
  await section(page, "Settings", "About");
  await expect(page.getByRole("link", { name: "v2026.1.1.1", exact: true })).toHaveAttribute(
    "href",
    /\/releases\/tag\/v2026\.1\.1\.1$/,
  );
  await expect(page.getByRole("link", { name: "ef19c18", exact: true })).toHaveAttribute(
    "href",
    /\/commit\/ef19c18$/,
  );
  await expect(page.getByRole("link", { name: "Licence", exact: true })).toHaveAttribute(
    "href",
    /\/LICENSE$/,
  );
});

test("Status summarises each kind's workers and state, quietly", async ({ page }) => {
  await fixtures(page);
  await page.goto("/images");
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", "Services Partly Available");
  await status.click();
  const drawer = page.getByRole("dialog", { name: "Queue", exact: true });
  const summary = drawer.getByRole("region", { name: "Service Status", exact: true });
  await expect(summary).toHaveText(
    "Images1 worker · IdleVideos1 worker · OfflineText1 worker · Running",
  );
  // Nothing in it acts.
  await expect(summary.getByRole("link")).toHaveCount(0);
  await expect(summary.getByRole("button")).toHaveCount(0);
});

test("Workers switch GPU workloads only through a reviewed preview", async ({ page }) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  await page.route("**/api/services/status", (route) =>
    route.fulfill({
      json: {
        services: {},
        workers: [
          {
            id: "image",
            label: "Image Worker",
            capabilities: ["image"],
            state: "healthy",
            queued: 0,
          },
        ],
        runtime: {
          configured: true,
          reason:
            "Studio switches GPU workloads when an administrator applies a placement, and swaps ComfyUI in for waiting work while Radiance is placed.",
        },
      },
    }),
  );
  const workload = (id: string, label: string, phase: string, gpus = 1) => ({
    id,
    label,
    kind: id.startsWith("video") ? "video" : "image",
    ...(id === "text" ? { text: true } : {}),
    pool: "gpu",
    gpus,
    phase,
    replicas: phase === "running" ? 1 : 0,
    ready: phase === "running" ? 1 : 0,
    acceptedOperations: 0,
  });
  await page.route("**/api/runtime", (route) =>
    route.fulfill({
      json: {
        pools: [{ id: "gpu", capacity: 2, used: 2 }],
        placement: ["image", "text"],
        // Four changes, newest first; only the latest three show until Show All.
        history: ["first", "second", "third", "earlier"].map((id) => ({
          id,
          type: "restart",
          status: "completed",
          requestedBy: "control-mcp",
          startedAt: stamp,
          finishedAt: stamp,
          before: ["text"],
          after: ["text"],
          target: ["text", "image"],
          stop: ["text"],
          start: ["text"],
          progress: "Done.",
          steps: id === "first" ? [{ at: stamp, message: "Stopping Text." }] : [],
        })),
        workloads: [
          workload("image", "Image", "running"),
          workload("text", "Text", "running"),
          workload("video", "Video", "parked"),
          { ...workload("radiance", "Radiance", "parked", 2), radiance: true },
        ],
      },
    }),
  );
  const previews: unknown[] = [];
  const applied: unknown[] = [];
  await page.route("**/api/runtime/preview", (route) => {
    const choice = route.request().postDataJSON();
    previews.push(choice);
    if (choice.workloads?.includes("radiance"))
      return route.fulfill({
        json: {
          target: ["radiance"],
          stop: ["image", "text"],
          start: ["radiance"],
          keep: [],
          signature: "radiance",
        },
      });
    return route.fulfill({
      json: {
        target: ["text", "video"],
        stop: ["image"],
        start: ["video"],
        keep: ["text"],
        signature: "fixture",
      },
    });
  });
  await page.route("**/api/runtime/apply", (route) => {
    applied.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { id: "next", status: "running" } });
  });
  await page.goto("/settings");
  await section(page, "Settings", "Workers");
  // The change history has its own section after the rarely changed controls.
  const history = page.getByRole("region", { name: "History", exact: true });
  await expect(history).toBeVisible();
  const table = page.getByRole("table", { name: "GPU Workloads", exact: true });
  const controls = page.getByRole("region", { name: "Placement", exact: true });
  await expect(controls.getByRole("list", { name: "Workers", exact: true })).toContainText(
    "Image Worker · Images · Idle",
  );
  const placement = controls.getByRole("combobox", { name: "GPU Placement", exact: true });
  await expect(placement).toHaveValue("ComfyUI · 2 GPUs");
  await placement.click();
  await expect(page.getByRole("option", { name: "ComfyUI · 1 GPU", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Radiance · 2 GPUs", exact: true }).click();
  await expect(table.getByRole("row", { name: "Radiance", exact: true })).toContainText("Stopped");
  await page.getByRole("button", { name: "Preview Changes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Apply GPU Placement" });
  await expect(dialog).toContainText("Start: Radiance");
  expect(previews).toEqual([{ workloads: ["radiance"] }]);
  expect(applied).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  const changes = history.getByRole("table", { name: "Runtime Changes" });
  await expect(changes.getByRole("row", { name: "Restart Text" })).toHaveCount(3);
  await page.getByRole("button", { name: "Show All", exact: true }).click();
  await expect(changes.getByRole("row", { name: "Restart Text" })).toHaveCount(4);
  // Each change's row menu opens its log: the steps, then how it ended.
  await changes
    .getByRole("button", { name: "Actions for Restart Text", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "View Logs", exact: true }).click();
  const log = page.getByRole("dialog", { name: "Runtime Log", exact: true });
  await expect(log.getByLabel("Change Steps", { exact: true })).toContainText(
    /Stopping Text\.\n.*Done\./,
  );
  await page.keyboard.press("Escape");
  await expect(log).toBeHidden();
  await expect(page.getByRole("dialog", { name: /^Settings/ })).toBeVisible();
  // A workload's own log opens on its pod's tail, with the changes that touched it a tab away.
  await page.route("**/api/runtime/workloads/text/logs*", (route) =>
    route.fulfill({
      json: {
        pods: [
          {
            name: "text-1",
            container: "main",
            phase: "Running",
            restarts: 0,
            lines: [`${stamp} Listening.`],
          },
        ],
      },
    }),
  );
  await table
    .getByRole("row", { name: "Text", exact: true })
    .getByRole("button", { name: "Actions for Text", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "View Logs", exact: true }).click();
  const workloadLog = page.getByRole("dialog", { name: "Text Log", exact: true });
  await expect(workloadLog.getByLabel("Pod Log", { exact: true })).toContainText("Listening.");
  await workloadLog.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(workloadLog.getByLabel("Change Steps", { exact: true })).toContainText(
    "Stopping Text.",
  );
  await page.keyboard.press("Escape");
  await expect(workloadLog).toBeHidden();
  await placement.click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await expect(table.getByRole("checkbox", { name: "Run Image", exact: true })).toBeChecked();
  await table.getByRole("checkbox", { name: "Run Image", exact: true }).click();
  await table.getByRole("checkbox", { name: "Run Video", exact: true }).click();
  await page.getByRole("button", { name: "Preview Changes", exact: true }).click();
  await expect(dialog).toContainText("Stop: Image");
  await expect(dialog).toContainText("Start: Video");
  expect(applied).toEqual([]);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(previews.at(-1)).toEqual({ workloads: ["text", "video"] });
  expect(applied).toEqual([{ workloads: ["text", "video"], signature: "fixture" }]);
  // A parked workload's own Start previews starting it beside what runs.
  const video = table.getByRole("row", { name: "Video", exact: true });
  await expect(video).toContainText("Stopped");
  await video.getByRole("button", { name: "Actions for Video", exact: true }).click();
  await page.getByRole("menuitem", { name: "Start", exact: true }).click();
  await expect(dialog).toContainText("Start: Video");
  expect(previews.at(-1)).toEqual({ start: ["video"] });
  // A running workload's Stop previews the placement without it; Start waits until it stops.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await table
    .getByRole("row", { name: "Image", exact: true })
    .getByRole("button", { name: "Actions for Image", exact: true })
    .click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "Start",
    "Stop",
    "Restart",
    "View Logs",
    "Cancel Queue",
  ]);
  await expect(page.getByRole("menuitem", { name: "Start", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Cancel Queue", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Stop", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(previews.at(-1)).toEqual({ workloads: ["text"] });
});

test("Workers keep a stopped workload quiet and stop a running change on request", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const unreachable = "The direct runtime could not be reached.";
  // One worker address serves both video workloads: one should run and can't, one is stopped.
  await page.route("**/api/services/status", (route) =>
    route.fulfill({
      json: {
        services: {
          video: {
            state: "offline",
            reason: "No runtime answered its health check.",
            endpoints: [
              {
                id: "video-worker",
                label: "Video",
                state: "offline",
                reason: unreachable,
                workloads: ["video", "video-tp2"],
              },
            ],
          },
        },
        runtime: { configured: true, reason: "" },
      },
    }),
  );
  const workload = (id: string, label: string, phase: string, gpus = 1) => ({
    id,
    label,
    kind: "video",
    pool: "gpu",
    gpus,
    phase,
    replicas: phase === "parked" ? 0 : 1,
    ready: 0,
    acceptedOperations: 0,
  });
  const operation = {
    id: "stuck",
    type: "apply",
    status: "running",
    requestedBy: "restoring the last placement after an outside stop",
    startedAt: stamp,
    before: [],
    target: ["video"],
    stop: [],
    start: ["video"],
    progress: "Waiting for Video: Starting.",
    steps: [],
  };
  await page.route("**/api/runtime", (route) =>
    route.fulfill({
      json: {
        pools: [{ id: "gpu", capacity: 2, used: 1 }],
        operation,
        history: [operation],
        workloads: [
          workload("video", "Video", "starting"),
          workload("video-tp2", "Both GPUs", "parked", 2),
        ],
      },
    }),
  );
  const cancelled: string[] = [];
  await page.route("**/api/runtime/operations/*/cancel", (route) => {
    cancelled.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: operation });
  });
  await page.goto("/settings");
  await section(page, "Settings", "Workers");
  const table = page.getByRole("table", { name: "GPU Workloads", exact: true });
  await expect(table.getByRole("row", { name: "Video", exact: true })).toContainText(unreachable);
  const stopped = table.getByRole("row", { name: "Both GPUs", exact: true });
  await expect(stopped).toContainText("Stopped");
  await expect(stopped).not.toContainText(unreachable);
  await page.getByRole("button", { name: "Stop Change", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Stop Change", exact: true });
  await dialog.getByRole("button", { name: "Stop Change", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(cancelled).toEqual(["/api/runtime/operations/stuck/cancel"]);
});

test("Workers select local text models to benchmark and list each run's figures", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  await page.route("**/api/services/status", (route) =>
    route.fulfill({
      json: {
        services: {},
        runtime: { configured: true, reason: "" },
      },
    }),
  );
  const workload = (id: string, label: string, text: boolean, phase: string) => ({
    id,
    label,
    kind: "image",
    ...(text ? { text } : {}),
    pool: "gpu",
    gpus: 1,
    phase,
    replicas: phase === "running" ? 1 : 0,
    ready: phase === "running" ? 1 : 0,
    acceptedOperations: 0,
  });
  await page.route("**/api/runtime", (route) =>
    route.fulfill({
      json: {
        pools: [{ id: "gpu", capacity: 2, used: 1 }],
        history: [],
        workloads: [
          workload("gemma", "Gemma", true, "running"),
          workload("image", "Image", false, "running"),
          workload("qwen", "Qwen", true, "parked"),
        ],
      },
    }),
  );
  const earlier = {
    id: "earlier",
    workload: "gemma",
    label: "Gemma",
    model: "gemma-4-31b",
    status: "completed",
    requestedBy: "account:admin",
    startedAt: stamp,
    finishedAt: stamp,
    summary: {
      version: "0.6.1",
      decode: 61.24,
      ttftMs: 140.4,
      aggregate: { level: 8, tps: 290.1 },
      prefill: { depth: 64000, tps: 4100 },
    },
  };
  let runs: Record<string, unknown>[] = [earlier];
  const started: unknown[] = [];
  const stopped: string[] = [];
  await page.route("**/api/runtime/workloads/gemma/benchmark-models", (route) =>
    route.fulfill({
      json: {
        models: [
          { id: "gemma-4-31b", label: "Gemma 4 31B" },
          { id: "qwen3.8-27b", label: "Qwen 3.8 27B" },
        ],
      },
    }),
  );
  await page.route("**/api/runtime/benchmarks", (route) => {
    if (route.request().method() === "POST") {
      const choice = route.request().postDataJSON();
      started.push(choice);
      const batch = choice.models.map((model: string, index: number) => ({
        ...earlier,
        model,
        id: index === 0 ? "next" : `waiting-${index}`,
        status: index === 0 ? "running" : "queued",
        summary: undefined,
      }));
      runs = [...batch, ...runs];
      return route.fulfill({ status: 202, json: batch });
    }
    return route.fulfill({ json: { configured: true, runs } });
  });
  await page.route("**/api/runtime/benchmarks/*/stop", (route) => {
    stopped.push(new URL(route.request().url()).pathname);
    runs = runs.map((run) => (run.id === "next" ? { ...run, status: "stopped" } : run));
    return route.fulfill({ json: runs[0] });
  });
  await page.goto("/settings");
  await section(page, "Settings", "Workers");
  const results = page.getByRole("table", { name: "Benchmarks", exact: true });
  await expect(results.getByRole("row", { name: "Gemma" })).toContainText("61.2 tok/s");
  // Phones leave out the secondary figures.
  if (!testInfo.project.use.isMobile)
    await expect(results.getByRole("row", { name: "Gemma" })).toContainText("290 tok/s · 8×");
  await expect(results.getByRole("row", { name: "Gemma" })).toContainText("Completed");
  await expect(results.getByRole("row", { name: "Gemma" })).toContainText(
    "Requested by admin@example.test",
  );
  const table = page.getByRole("table", { name: "GPU Workloads", exact: true });
  const menu = async (label: string) => {
    await table.getByRole("button", { name: `Actions for ${label}`, exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "View Logs", exact: true })).toBeVisible();
    return page.getByRole("menuitem", { name: "Benchmark", exact: true });
  };
  const closeMenu = async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  };
  // A workload without local text has no benchmark, and a stopped one can't run one.
  await expect(await menu("Image")).toHaveCount(0);
  await closeMenu();
  await expect(await menu("Qwen")).toBeDisabled();
  await closeMenu();
  await (await menu("Gemma")).click();
  const dialog = page.getByRole("dialog", { name: "Benchmark Gemma", exact: true });
  const benchmark = dialog.getByRole("button", { name: "Benchmark", exact: true });
  await expect(benchmark).toBeDisabled();
  const models = dialog.getByRole("group", { name: "Text Models", exact: true });
  await models.getByRole("checkbox", { name: "Qwen 3.8 27B", exact: true }).check();
  await expect(benchmark).toBeEnabled();
  await dialog.getByRole("checkbox", { name: "Select All", exact: true }).check();
  await expect(models.getByRole("checkbox").first()).toBeChecked();
  await benchmark.click();
  await expect(dialog).toBeHidden();
  expect(started).toEqual([{ workload: "gemma", models: ["gemma-4-31b", "qwen3.8-27b"] }]);
  await expect(results.getByRole("row", { name: "Gemma" }).first()).toContainText("Running");
  await expect(results.getByRole("row", { name: "Gemma" }).nth(1)).toContainText("Queued");
  await expect(results.getByRole("row", { name: "Gemma" }).nth(1)).toContainText("qwen3.8-27b");
  // One benchmark at a time.
  await expect(await menu("Gemma")).toBeDisabled();
  await closeMenu();
  await results
    .getByRole("button", { name: /^Actions for Gemma · / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Stop", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Stop Benchmark", exact: true });
  await confirm.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(stopped).toEqual(["/api/runtime/benchmarks/next/stop"]);
  await expect(results.getByRole("row", { name: "Gemma" }).first()).toContainText("Stopped");
});

test("Status counts workers that can run and their queue, reads a parked service as Stopped and offers no Start", async ({
  page,
}) => {
  await fixtures(page);
  await page.route("**/api/services/status", (route) =>
    route.fulfill({
      json: {
        services: {
          image: {
            state: "healthy",
            reason: "A direct runtime is healthy.",
            endpoints: [
              {
                id: "image",
                label: "Image",
                state: "healthy",
                reason: "Ready",
                running: true,
                queued: 3,
              },
              {
                id: "comfy",
                label: "ComfyUI",
                state: "parked",
                reason: "Stopped on purpose. An administrator can start it.",
                workloads: ["comfy"],
              },
            ],
          },
          video: {
            state: "parked",
            reason: "Stopped on purpose. An administrator can start it.",
            endpoints: [
              {
                id: "video",
                label: "Video",
                state: "parked",
                reason: "Stopped on purpose. An administrator can start it.",
                workloads: ["video"],
              },
            ],
          },
        },
        runtime: { configured: true, reason: "" },
      },
    }),
  );
  await page.goto("/images");
  const status = page.getByRole("button", { name: "Open Status", exact: true });
  await expect(status).toHaveAttribute("aria-description", "Services Running · Some Stopped");
  await status.click();
  const drawer = page.getByRole("dialog", { name: "Queue", exact: true });
  // A parked worker isn't counted, and the queue shows as Settings › Workers shows it.
  await expect(
    drawer.getByLabel("Images: 1 worker · Busy · 3 Queued", { exact: true }),
  ).toBeVisible();
  await expect(drawer.getByLabel("Videos: Stopped", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Start Videos" })).toHaveCount(0);
});

test("Settings › Studio switches follow at once and settle back after a failed save", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  const setting = (key: string) => ({
    key,
    configured: "",
    effective: "",
    source: "default",
    locked: false,
  });
  const captions = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/settings/deployment", async (route) => {
    if (route.request().method() === "POST") {
      await held;
      return route.fulfill({ status: 500, json: { error: "The setting could not be saved" } });
    }
    return route.fulfill({
      json: {
        defaults: {
          image: setting("STUDIO_DEFAULT_IMAGE_PROFILE"),
          video: setting("STUDIO_DEFAULT_VIDEO_PROFILE"),
          text: setting("STUDIO_DEFAULT_TEXT_PROFILE"),
          textModels: [],
          profiles: [],
        },
        dream: dreamPolicyFixture(),
        catalogue: [
          {
            key: "STUDIO_GALLERY_CAPTIONS",
            label: "Gallery Captions",
            description: "Caption images for search.",
            value: captions,
            source: "default",
            locked: false,
          },
        ],
      },
    });
  });
  await page.goto("/settings#studio");
  const toggle = page
    .getByRole("region", { name: "Background AI", exact: true })
    .getByRole("switch", { name: "Gallery Captions", exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click({ force: true });
  // The switch moves before the server answers.
  await expect(toggle).not.toBeChecked();
  release();
  await expect(page.getByText("The setting could not be saved")).toBeVisible();
  await expect(toggle).toBeChecked();
});

test("Dream Defaults saves shared queue delays and hands an override back to each account", async ({
  page,
}) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  await page.goto("/settings#dream-policy");
  const delay = page.getByRole("textbox", { name: "Model & LoRA Switch Delay", exact: true });
  await delay.fill("8");
  await delay.press("Enter");
  const idle = page.getByRole("textbox", { name: "Video Idle Delay", exact: true });
  await idle.fill("12");
  await idle.press("Enter");
  const images = page.getByRole("radiogroup", { name: "Dream Images", exact: true });
  const uncensored = page.getByRole("radiogroup", { name: "Dream Uncensored" });
  const choice = (group: typeof images, name: string) =>
    group.getByRole("radio", { name, exact: true });
  await expect(choice(images, "Per Account")).toBeChecked();
  await images.getByText("Cloud", { exact: true }).click();
  await uncensored.getByText("Off", { exact: true }).click();
  await expect(choice(images, "Cloud")).toBeChecked();
  await page.reload();
  await expect(delay).toHaveValue("8");
  await expect(idle).toHaveValue("12");
  await expect(choice(images, "Cloud")).toBeChecked();
  await expect(choice(uncensored, "Off")).toBeChecked();
  await expect(
    choice(page.getByRole("radiogroup", { name: "Dream Videos", exact: true }), "Per Account"),
  ).toBeChecked();
  await uncensored.getByText("Per Account", { exact: true }).click();
  await page.reload();
  await expect(choice(uncensored, "Per Account")).toBeChecked();
});

test("Settings › Studio saves and clears the default Text Profile", async ({ page }) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  await page.goto("/settings#studio");
  const text = page.getByRole("combobox", { name: "Text Profile", exact: true });
  await expect(text).toHaveText("Gateway Default");
  await text.click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/settings/deployment") &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await page
    .getByRole("group", { name: "Local", exact: true })
    .getByRole("option", { name: "Auto", exact: true })
    .click();
  await saved;
  await page.reload();
  await expect(text).toHaveText("Local · Auto");
  await text.click();
  await page.getByRole("option", { name: "Gateway Default", exact: true }).click();
  await expect(text).toHaveText("Gateway Default");
});
