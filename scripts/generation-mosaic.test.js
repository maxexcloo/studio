import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/app/generationEffect.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/export /g, '');

function probe({ renderer = 'Apple M4', available = true, storage = new Map(), brokenStorage = false, windows = false } = {}) {
  let released = false, requested = false;
  const context = {
    getExtension: (name) => name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : name === 'WEBGL_lose_context' ? { loseContext: () => { released = true; } } : null,
    getParameter: () => renderer,
  };
  const allowed = vm.runInNewContext(`${compiled}\nwebglMosaicAllowed()`, {
    console: { warn() {} },
    navigator: { userAgent: windows ? 'Windows' : 'Linux' },
    localStorage: {
      getItem: (key) => { if (brokenStorage) throw new Error('Storage disabled'); return storage.get(key); },
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    },
    document: { createElement: () => ({ getContext: (type, options) => {
      requested = true;
      assert.equal(type, 'webgl');
      assert.equal(options.failIfMajorPerformanceCaveat, true);
      return available ? context : null;
    } }) },
  });
  return { allowed, released, requested };
}

test('hardware mosaics release the probe context and work without browser storage', () => {
  assert.deepEqual(probe(), { allowed: true, released: true, requested: true });
  assert.equal(probe({ brokenStorage: true }).allowed, true);
});

test('unavailable and software WebGL use the lightweight generation preview', () => {
  assert.equal(probe({ available: false }).allowed, false);
  for (const renderer of ['Google SwiftShader', 'Mesa llvmpipe', 'softpipe', 'lavapipe', 'Software Renderer']) {
    assert.deepEqual(probe({ renderer }), { allowed: false, released: true, requested: true });
  }
});

test('Windows and a previous mosaic crash retain their fallback without probing WebGL', () => {
  assert.equal(probe({ windows: true }).requested, false);
  const storage = new Map([['heiss.generationMosaic.running', '1']]);
  assert.deepEqual(probe({ storage }), { allowed: false, released: false, requested: false });
  assert.equal(storage.has('heiss.generationMosaic.running'), false);
  assert.ok(storage.has('heiss.generationMosaic.crashed'));
});
