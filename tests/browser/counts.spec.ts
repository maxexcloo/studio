import { expect, test, type Page } from '@playwright/test';
import { studioUi } from './helpers/ui';

async function prepare(page: Page, imageMaximum = 8) {
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) {
    profile.defaults.count = 1;
    profile.constraints.count = { min: 1, max: profile.kind === 'video' ? 1 : imageMaximum, step: 1 };
    profile.capabilities.variations = profile.kind === 'image';
    profile.mediaInputs = [];
    profile.capabilities.startImageRequired = false;
  }
  await page.route('**/api/models', (route) => route.fulfill({ json: models }));
  await page.goto('/');
  const ui = studioUi(page);
  await ui.openComposer();
  return ui;
}

type Ui = ReturnType<typeof studioUi>;

async function setCount(ui: Ui, kind: 'Images' | 'Videos', count: number) {
  const root = await ui.openComposer();
  await root.getByRole('button', { name: new RegExp(`^${kind}: \\d+$`) }).click();
  const input = root.getByRole('spinbutton', { name: kind, exact: true });
  await input.fill(String(count));
  await input.press('Enter');
  await expect(root.getByRole('button', { name: `${kind}: ${count}`, exact: true })).toBeVisible();
}

async function mode(ui: Ui, kind: 'Image' | 'Video') {
  const root = await ui.openComposer();
  await root.getByRole('group', { name: 'Generation Mode', exact: true }).getByRole('button', { name: kind, exact: true }).click();
}

async function generate(ui: Ui, prompt: string) {
  await ui.openComposer();
  await ui.prompt.fill(prompt);
  await ui.generate.click();
}

test('image and video default to two, retaining independent choices and reloads', async ({ page }) => {
  const ui = await prepare(page);
  await expect(ui.composer.getByRole('button', { name: 'Images: 2', exact: true })).toBeVisible();
  await setCount(ui, 'Images', 6);
  await mode(ui, 'Video');
  await expect(ui.composer.getByRole('button', { name: 'Videos: 2', exact: true })).toBeVisible();
  await setCount(ui, 'Videos', 3);
  await mode(ui, 'Image');
  await expect(ui.composer.getByRole('button', { name: 'Images: 6', exact: true })).toBeVisible();
  await mode(ui, 'Video');
  await expect(ui.composer.getByRole('button', { name: 'Videos: 3', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('heiss-ui-draft') || '{}').count)).toBe(3);
  await page.reload();
  await ui.openComposer();
  await expect(ui.composer.getByRole('button', { name: 'Videos: 3', exact: true })).toBeVisible();
  await mode(ui, 'Image');
  await expect(ui.composer.getByRole('button', { name: 'Images: 6', exact: true })).toBeVisible();
  const layout = await ui.composer.evaluate((element) => ({ scroll: element.scrollWidth, width: element.clientWidth }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
});

test('image payload batches two while video counts queue independent single-video jobs', async ({ page }) => {
  const ui = await prepare(page);
  const requests: Record<string, any>[] = [];
  await page.route('**/api/generate', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { jobId: `count-job-${requests.length}`, items: [] } });
  });
  await page.route('**/api/jobs/count-job-*', (route) => route.fulfill({ json: { status: 'done', outputs: [] } }));
  await generate(ui, 'Two images');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ kind: 'image', count: 2, variationCount: 2 });
  await mode(ui, 'Video');
  await setCount(ui, 'Videos', 3);
  await generate(ui, 'Three videos');
  await expect.poll(() => requests.length).toBe(4);
  for (const request of requests.slice(1)) {
    expect(request).toMatchObject({ kind: 'video', count: 1 });
    expect(request).not.toHaveProperty('variationCount');
    expect(request.profileId).toBe(requests[1].profileId);
    expect(request.model).toBe(requests[1].model);
  }
  expect(new Set(requests.map((request) => request.clientJobId)).size).toBe(4);
});

test('image defaults and outgoing count honour a model maximum of one', async ({ page }) => {
  const ui = await prepare(page, 1);
  const root = ui.composer;
  // The phone hides a count that cannot change.
  if (!await ui.isPhone()) await expect(root.getByRole('button', { name: 'Images: 1', exact: true })).toBeVisible();
  const increase = root.getByRole('button', { name: 'Increase images', exact: true });
  if (await increase.count()) await expect(increase).toBeDisabled();
  let payload: Record<string, any> | null = null;
  await page.route('**/api/generate', (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: 'Captured count payload' } });
  });
  await generate(ui, 'One image within the model limit');
  await expect.poll(() => payload).not.toBeNull();
  expect(payload).toMatchObject({ kind: 'image', count: 1, variationCount: 1 });
});

test('a failed video submission stops the remainder and preserves queued jobs', async ({ page }) => {
  const ui = await prepare(page);
  await mode(ui, 'Video');
  await setCount(ui, 'Videos', 3);
  let submissions = 0;
  let polls = 0;
  await page.route('**/api/generate', (route) => {
    submissions += 1;
    return submissions === 1
      ? route.fulfill({ json: { jobId: 'partial-count-job', items: [] } })
      : route.fulfill({ status: 400, json: { error: 'Video queue unavailable' } });
  });
  await page.route('**/api/jobs/partial-count-job', (route) => { polls += 1; return route.fulfill({ json: { status: 'done', outputs: [] } }); });
  await generate(ui, 'A partially accepted video queue');
  await expect(page.getByText('1 of 3 generations queued. Video queue unavailable', { exact: true }).first()).toBeVisible();
  await expect.poll(() => polls).toBeGreaterThan(0);
  expect(submissions).toBe(2);
});

test('Stop All prevents further video submissions and cancels an in-flight accepted job', async ({ page }) => {
  const ui = await prepare(page);
  await mode(ui, 'Video');
  await setCount(ui, 'Videos', 3);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let submissions = 0;
  let queueStopped = false;
  let lateJobStopped = false;
  await page.route('**/api/generate', async (route) => {
    submissions += 1;
    await held;
    await route.fulfill({ json: { jobId: 'late-count-job', items: [] } });
  });
  await page.route('**/api/queue/cancel', (route) => { queueStopped = true; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/jobs/late-count-job/cancel', (route) => { lateJobStopped = true; return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/jobs/late-count-job', (route) => route.fulfill({ json: { status: 'canceled', outputs: [] } }));
  await generate(ui, 'A stoppable video selection');
  await expect.poll(() => submissions).toBe(1);
  await ui.stopAll();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop all', exact: true }).click();
  await expect.poll(() => queueStopped).toBe(true);
  release();
  await expect.poll(() => lateJobStopped).toBe(true);
  expect(submissions).toBe(1);
});


for (const count of [1, 4]) {
  test(`an explicitly saved image default of ${count} survives preference migration`, async ({ page }) => {
    await page.addInitScript(count => {
      localStorage.setItem('heiss-ui-prefs', JSON.stringify({ defaultImageCount: count }));
    }, count);
    const ui = await prepare(page);
    await expect(ui.composer.getByRole('button', { name: `Images: ${count}`, exact: true })).toBeVisible();
    let payload: Record<string, any> | null = null;
    await page.route('**/api/generate', route => {
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 400, json: { error: 'Captured saved count' } });
    });
    await generate(ui, 'Retain the saved count');
    await expect.poll(() => payload).not.toBeNull();
    expect(payload!.variationCount).toBe(count);
  });
}
