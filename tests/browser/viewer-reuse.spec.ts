import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';
import { studioUi } from './helpers/ui';

const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#527b8f"/></svg>');
const video = execFileSync(ffmpeg!, ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '2', '-an', '-c:v', 'libx264', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-loglevel', 'error', 'pipe:1']);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/loras/*', route => route.fulfill({ json: { found: false, loras: [] } }));
  const models = await (await page.request.get('/api/models')).json();
  for (const profile of models.profiles) profile.capabilities.negativePrompt = true;
  await page.route('**/api/models', route => route.fulfill({ json: models }));
});

for (const kind of ['image', 'video'] as const) {
  for (const failed of [false, true]) {
    test(`reusing ${failed ? 'failed' : 'completed'} ${kind} settings closes the viewer and opens the prompt box`, async ({ page }) => {
      const item = {
        id: `reuse-${kind}`,
        url: failed ? '' : kind === 'image' ? picture : '/reuse-video.mp4',
        filename: `reuse.${kind === 'image' ? 'png' : 'mp4'}`,
        type: kind,
        status: failed ? 'error' : 'done',
        prompt: `Open the prompt box with this ${kind}'s prompt`,
        negative: 'Keep the negative prompt too',
        model: kind === 'image' ? 'flux1-schnell.safetensors' : 'wan2.1_i2v_480p.safetensors',
        createdAt: new Date().toISOString(),
        width: 512,
        height: 512,
        error: failed ? 'Test generation failed' : undefined,
        settings: { profileId: kind === 'image' ? 'mock-flux-schnell' : 'mock-wan-video', steps: 4, cfg: 1, seed: '123' }
      };
      await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: new URL(route.request().url()).searchParams.get('type') === kind ? [item] : [], revision: 1, hasMore: false } }));
      await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
      await page.route('**/reuse-video.mp4*', (route) => route.fulfill({ body: video, contentType: 'video/mp4' }));
      await page.goto('/');
      const ui = studioUi(page);
      if (kind === 'video') await ui.switchMode('video');
      const viewer = await ui.openViewer(page.locator(`[data-tile-id="${item.id}"]`));
      const phone = await ui.isPhone();
      // The full studio offers a failed run's reuse in its failure panel.
      const reuse = failed && !phone ? viewer.locator('.failure-panel').getByRole('button', { name: 'Use Settings', exact: true }) : await ui.reuseButton();
      await reuse.click();
      await expect(viewer).toHaveCount(0);
      await expect(ui.composer).toBeVisible();
      await expect(ui.prompt).toHaveValue(item.prompt);
      await expect(ui.negativePrompt).toHaveValue(item.negative);
      // Ready to edit: the desktop's box is expanded with the prompt focused; the phone's sheet is open.
      if (phone) await ui.composerSettled();
      else {
        await expect(ui.prompt).toBeFocused();
        await expect(page.locator('.zen-prompt')).toHaveClass(/is-expanded/);
      }
    });
  }
}

for (const promptsOnly of [false, true]) {
  test(`${promptsOnly ? 'prompts-only reuse preserves' : 'missing-model reuse safely adapts to'} the current model`, async ({ page }) => {
    const models = await (await page.request.get('/api/models')).json();
    const current = models.profiles.find((profile: any) => profile.id === models.defaults.imageModel);
    current.capabilities.negativePrompt = true;
    current.constraints.steps = { min: 1, max: 50, step: 1 };
    current.constraints.width = { min: 256, max: 2048, step: 32 };
    current.constraints.height = { min: 256, max: 2048, step: 32 };
    const item = { id: 'missing-model-output', url: picture, filename: 'missing.png', type: 'image', status: 'done', prompt: 'Reuse my prompts safely', negative: 'A different negative prompt', model: 'removed-model.safetensors', createdAt: new Date().toISOString(), width: 901, height: 701, settings: { profileId: 'removed-model', workflow: current.workflow, steps: 9999, cfg: 999, sampler: 'absent-sampler', vae: 'absent-vae', seed: '123', loras: [{ name: 'absent-lora', strength: 1 }] } };
    const reference = { id: 'preserved-reference', source: 'upload', name: 'Current Reference', url: picture, thumbnailUrl: picture, mime: 'image/png', width: 1024, height: 1024, size: 1, createdAt: '', privacyDomain: 'gallery' };
    await page.route('**/api/models', (route) => route.fulfill({ json: models }));
    await page.route('**/api/gallery?*', (route) => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
    await page.route('**/api/gallery/delta?*', (route) => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
    await page.route('**/api/reference-assets?*', (route) => route.fulfill({ json: { items: [reference], hasMore: false, nextCursor: '' } }));
    let body: Record<string, any> | null = null;
    await page.route('**/api/generate', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Test request captured' } }); });
    await page.goto('/');
    const ui = studioUi(page);
    await ui.openComposer();
    await ui.prompt.fill('Original draft');
    await page.getByRole('button', { name: 'Reference Image', exact: true }).click();
    await page.getByRole('button', { name: reference.name, exact: true }).click();
    await ui.closeComposer();
    const viewer = await ui.openViewer(page.locator(`[data-tile-id="${item.id}"]`));
    if (promptsOnly) {
      await expect(viewer.getByRole('button', { name: 'Reuse Options', exact: true })).toHaveCount(0);
      await ui.showDetails();
      const readouts = viewer.locator('.prompt-readout');
      await viewer.getByRole('group', { name: 'Reuse', exact: true }).getByRole('button', { name: 'Use Prompt', exact: true }).click();
      await expect(viewer).toHaveCount(0);
      await ui.closeComposer();
      await ui.openViewer(page.locator(`[data-tile-id="${item.id}"]`));
      await ui.showDetails();
      await readouts.getByRole('button', { name: 'Use Negative Prompt', exact: true }).click();
    } else await (await ui.reuseButton()).click();
    await expect(viewer).toHaveCount(0);
    await ui.openComposer();
    await expect(ui.prompt).toHaveValue(item.prompt);
    await expect(ui.negativePrompt).toHaveValue(item.negative);
    await ui.generate.click();
    await expect.poll(() => body).not.toBeNull();
    expect(body!.profileId).toBe(current.id);
    expect(body!.width % 32).toBe(0);
    expect(body!.height % 32).toBe(0);
    expect(body!.sampler).not.toBe('absent-sampler');
    expect(body!.vae).not.toBe('absent-vae');
    expect(body!.loras || []).toEqual([]);
    const referenceSlot = current.mediaInputs?.find((input: any) => input.kind === 'image')?.id || 'reference';
    expect(body!.referenceAssets).toEqual([{ slot: referenceSlot, assetId: reference.id }]);
    if (promptsOnly) {
      expect(body!.width).toBe(current.defaults.width);
      expect(body!.height).toBe(current.defaults.height);
      expect(body!.steps).toBe(current.defaults.steps);
      expect(body!.seed).not.toBe('123');
    } else {
      expect(body!.width).toBe(896);
      expect(body!.height).toBe(704);
      expect(body!.steps).toBeLessThanOrEqual(current.constraints.steps.max);
    }
  });
}

// Use Prompt (Details) loads both prompts; the negative readout's own button loads only that.
for (const field of ['negative'] as const) {
  test(`reusing only ${field} text preserves the other draft`, async ({ page }) => {
    const item = { id: 'text-reuse', url: picture, filename: 'text.png', type: 'image', status: 'done', prompt: 'Saved positive text', negative: 'Saved negative text', model: 'flux1-schnell.safetensors', createdAt: new Date().toISOString(), width: 512, height: 512 };
    await page.route('**/api/gallery?*', route => route.fulfill({ json: { items: [item], revision: 1, hasMore: false } }));
    await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
    await page.goto('/');
    const ui = studioUi(page);
    await ui.openComposer();
    await ui.prompt.fill('Positive draft');
    await ui.negativePrompt.fill('Negative draft');
    await ui.closeComposer();
    const viewer = await ui.openViewer(page.locator('[data-tile-id="text-reuse"]'));
    await ui.showDetails();
    const readout = viewer.locator('.prompt-readout').nth(field === 'prompt' ? 0 : 1);
    const copy = readout.getByRole('button', { name: /^Copy/ });
    const reuse = readout.getByRole('button', { name: /^Use (?:Negative )?Prompt$/ });
    const copyBox = await copy.boundingBox();
    const reuseBox = await reuse.boundingBox();
    expect(reuseBox!.y).toBeGreaterThanOrEqual(copyBox!.y + copyBox!.height);
    await reuse.click();
    await expect(viewer).toHaveCount(0);
    await ui.openComposer();
    await expect(ui.prompt).toHaveValue(field === 'prompt' ? item.prompt : 'Positive draft');
    await expect(ui.negativePrompt).toHaveValue(field === 'negative' ? item.negative : 'Negative draft');
  });
}

test('queued cards show each saved model', async ({ page }) => {
  const items = ['First Model.safetensors', 'Second Model.safetensors'].map((model, index) => ({ id: `queued-${index}`, url: '', filename: '', type: 'image', status: 'pending', prompt: 'Queued image', model: 'fallback.safetensors', settings: { modelName: model }, createdAt: new Date().toISOString(), width: 512, height: 512 }));
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  for (const item of items) await expect(page.locator(`[data-tile-id="${item.id}"] .generate-model`)).toHaveText(item.settings.modelName);
});

test('a running card names its profile beside Stop and holds still on hover', async ({ page }) => {
  const items = [{ id: 'running-0', jobId: 'job-0', url: '', filename: '', type: 'image', status: 'pending', prompt: 'Running image', model: 'flux1-schnell.safetensors', settings: { profileId: 'mock-flux-schnell', modelName: 'flux1-schnell.safetensors' }, progress: { value: 2, max: 4 }, createdAt: new Date().toISOString(), width: 512, height: 512 }];
  await page.route('**/api/gallery?*', route => route.fulfill({ json: { items, revision: 1, hasMore: false } }));
  await page.route('**/api/gallery/delta?*', route => route.fulfill({ json: { revision: 1, upserts: [], removes: [] } }));
  await page.goto('/');
  const card = page.locator('[data-tile-id="running-0"]');
  const label = card.locator('.generate-model');
  const stop = card.getByRole('button', { name: 'Stop', exact: true });
  await expect(label).toHaveText('FLUX.1 Schnell (Demo)');
  await expect(label).toHaveCount(1);
  await expect(card.locator('.generate-step-count')).toHaveText('2/4');
  await expect(card).toHaveCSS('opacity', '1');
  await expect(card).toHaveCSS('transform', 'none');
  const look = (element: Element) => { const style = getComputedStyle(element); return [style.height, style.borderRadius, style.fontSize, style.fontWeight, style.backgroundColor]; };
  expect(await label.evaluate(look)).toEqual(await stop.evaluate(look));
  const before = await label.boundingBox();
  const stopBox = await stop.boundingBox();
  expect(before!.x + before!.width).toBeLessThan(stopBox!.x);
  expect(before!.y).toBeCloseTo(stopBox!.y, 0);
  await card.locator('.tile').hover();
  await page.waitForTimeout(400);
  expect(await label.boundingBox()).toEqual(before);
  await label.hover({ force: true });
  await page.waitForTimeout(400);
  expect(await label.boundingBox()).toEqual(before);
});
