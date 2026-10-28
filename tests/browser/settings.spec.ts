import { expect, test } from "@playwright/test";
import { fixtures, image, openTheme, section, signIn, stamp } from "./fixtures";

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
  const order = [
    "Account",
    "Chat Gateway",
    "Groups",
    "Maintenance",
    "Models",
    "Profiles",
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
  await section(page, "Settings", "Maintenance");
  await page.getByRole("combobox", { name: "Whose Failed Items", exact: true }).click();
  await page.getByRole("option", { name: "member@example.test", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Failed Items", exact: true });
  await expect(confirm).toContainText("Remove member@example.test's failed and cancelled items");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("2 failed items deleted", { exact: true })).toBeVisible();
  expect(cleared).toEqual([{ owner: "member" }]);
  await section(page, "Settings", "Workers");
  await expect(page.getByRole("combobox", { name: "Images Endpoint", exact: true })).toHaveValue(
    "Image Worker",
  );
  const before = statusReads;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => statusReads).toBeGreaterThan(before);
});

test("Caption Gallery in Settings › Maintenance starts a pass, shows its progress and stops", async ({
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
  await page.goto("/settings#maintenance");
  const row = page.getByRole("region", { name: "Clean Up", exact: true });
  await expect(row.getByText("Ready · 9,000 to caption", { exact: true })).toBeVisible();
  await row.getByRole("combobox", { name: "Images to Caption", exact: true }).click();
  await page.getByRole("option", { name: "Missing (7,000)", exact: true }).click();
  await expect(row.getByText("Ready · 7,000 to caption", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    row.getByText("Running · 120 of 7,000 · 30 a minute · about 3 h 49 min left", { exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("progressbar", { name: "Caption Progress" })).toBeVisible();
  await row.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(row.getByText("Stopped · 120 of 7,000", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  expect(actions).toEqual([
    ["start", { scope: "missing" }],
    ["stop", {}],
  ]);
});

test("Unfinished Items in Settings › Maintenance retry and delete any account's stuck jobs", async ({
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
    jobs = jobs.filter((entry) => entry.id !== body.id);
    return route.fulfill({ json: { job: jobs[0] } });
  });
  await page.goto("/settings#maintenance");
  const row = page.getByRole("region", { name: "Clean Up", exact: true });
  await expect(row.getByText(/2 now\.$/)).toBeVisible();
  await row.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unfinished Items", exact: true });
  await expect(dialog.getByRole("row", { name: "A lost lighthouse" })).toContainText(
    "member@example.test",
  );
  await dialog.getByRole("button", { name: "Actions for A lost lighthouse", exact: true }).click();
  await page.getByRole("menuitem", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Queued again", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("row", { name: "A lost lighthouse" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Actions for A slow tide", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Unfinished Item", exact: true });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog.getByText("No Unfinished Items", { exact: true })).toBeVisible();
  expect(actions).toEqual([
    ["retry", { ownerId: "member", id: "stuck" }],
    ["delete", { ownerId: "admin", id: "slow" }],
  ]);
});

test("Tile Captions in Settings › Studio pin phone tile captions", async ({ page }, testInfo) => {
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
  const caption = page.getByText("A quiet harbour", { exact: true });
  await expect(
    page.getByRole("button", { name: "Open image: A quiet harbour", exact: true }),
  ).toBeVisible();
  await expect(caption).toHaveCount(0);
  await page.goto("/settings#studio");
  // The unlabelled track sits over the input; the row's accessible name is on the input.
  await page.getByRole("switch", { name: "Tile Captions", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await expect(caption).toBeVisible();
});

test("Finish Starred Images in Settings › Studio saves its switch, quality and face detail", async ({
  page,
}) => {
  await fixtures(page);
  const status = {
    settings: { enabled: false, quality: "balanced", faceDetail: true },
    waiting: 0,
  };
  const saves: Record<string, unknown>[] = [];
  await page.route("**/api/finishing**", (route) => {
    if (route.request().method() === "PUT") {
      const patch = route.request().postDataJSON();
      saves.push(patch);
      Object.assign(status.settings, patch);
      if (patch.enabled) status.waiting = 3;
    }
    return route.fulfill({ json: status });
  });
  await page.goto("/settings#studio");
  const toggle = page.getByRole("switch", { name: "Finish Starred Images", exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("combobox", { name: "Finishing Quality", exact: true })).toHaveCount(
    0,
  );
  await toggle.click({ force: true });
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText("Upscale images you star while the GPU is idle. 3 waiting.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Finishing Quality", exact: true }).click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  const face = page.getByRole("switch", { name: "Face Detail", exact: true });
  await face.click({ force: true });
  await expect(face).not.toBeChecked();
  await expect
    .poll(() => saves)
    .toEqual([{ enabled: true }, { quality: "high" }, { faceDetail: false }]);
});

test("Header appearance preferences persist across reloads", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  await openTheme(page);
  const popup = await page.locator('.mantine-Popover-dropdown[role="dialog"]').boundingBox();
  expect(popup!.y).toBeGreaterThanOrEqual(68);
  await page.getByRole("button", { name: "Use Blue Colour", exact: true }).click();
  await page.getByRole("button", { name: "Use Warm Background", exact: true }).click();
  await page.getByText("Fast", { exact: true }).click();
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
  await expect(
    page.getByRole("button", { name: "Use Warm Background", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
    page.getByRole("region", { name: "Your Account" }).getByText("Administrator", { exact: true }),
  ).toBeVisible();
  await section(page, "Settings", "Workers");
  await expect(page.getByRole("heading", { name: "Workers", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Images Endpoint", exact: true })).toHaveValue(
    "Image Worker",
  );
  await section(page, "Settings", "About");
  await expect(page.getByText("Development", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Licence", exact: true })).toHaveAttribute(
    "href",
    /\/LICENSE$/,
  );
});

test("Status summarises service health and opens Workers over the current page", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/chat");
  const status = page.getByRole("button", { name: "Open Chats", exact: true });
  await expect(status).toHaveAttribute("aria-description", "Services Partly Available");
  await status.click();
  const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
  await expect(drawer.getByLabel("Videos: Offline", { exact: true })).toBeVisible();
  await drawer.getByRole("link", { name: "Workers", exact: true }).click();
  await expect(drawer).toBeHidden();
  const settings = page.getByRole("dialog", { name: /^Settings/ });
  const images = settings.getByRole("combobox", { name: "Images Endpoint", exact: true });
  await expect(images).toHaveValue("Image Worker");
  await images.click();
  await page.getByRole("option", { name: /Image Worker/ }).click();
  await expect(settings.getByText("Fixture GPU", { exact: false })).toBeVisible();
  await expect(settings.getByText("Automatic Control Off", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText("No Chat Selected", { exact: true })).toBeVisible();
});

test("Workers switch GPU workloads only through a reviewed preview", async ({ page }) => {
  await fixtures(page);
  await signIn(page, { id: "admin", role: "administrator" });
  await page.route("**/api/services/status", (route) =>
    route.fulfill({
      json: {
        services: {},
        runtime: {
          configured: true,
          automaticLifecycle: false,
          reason: "Studio switches GPU workloads only when an administrator applies a placement.",
        },
      },
    }),
  );
  const workload = (id: string, label: string, phase: string, gpus = 1) => ({
    id,
    label,
    kind: id === "text" ? "text" : id.startsWith("video") ? "video" : "image",
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
        automaticLifecycle: false,
        pools: [{ id: "gpu", capacity: 2, used: 2 }],
        history: [
          {
            id: "earlier",
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
            steps: [],
          },
        ],
        workloads: [
          workload("image", "Image", "running"),
          workload("text", "Text", "running"),
          workload("video", "Video", "stopped"),
        ],
      },
    }),
  );
  const previews: unknown[] = [];
  const applied: unknown[] = [];
  await page.route("**/api/runtime/preview", (route) => {
    previews.push(route.request().postDataJSON());
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
  const table = page.getByRole("table", { name: "GPU Workloads", exact: true });
  await expect(table.getByRole("checkbox", { name: "Run Image", exact: true })).toBeChecked();
  await expect(page.getByRole("table", { name: "Runtime Changes" })).toContainText("Restart Text");
  await table.getByRole("checkbox", { name: "Run Image", exact: true }).click();
  await table.getByRole("checkbox", { name: "Run Video", exact: true }).click();
  await page.getByRole("button", { name: "Preview Changes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Apply GPU Placement" });
  await expect(dialog).toContainText("Stop: Image");
  await expect(dialog).toContainText("Start: Video");
  expect(applied).toEqual([]);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(previews).toEqual([{ workloads: ["text", "video"] }]);
  expect(applied).toEqual([{ workloads: ["text", "video"], signature: "fixture" }]);
});
