import assert from 'node:assert/strict';
import test from 'node:test';
import { currentStorageKey, migrateStorageKeys, renamedSessionKeys, renamedStorageKeys } from '../src/app/storageNames.js';

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    entries: () => Object.fromEntries(map)
  };
}

test('old HEISS UI storage keys map to Studio keys, per-account copies included', () => {
  assert.equal(currentStorageKey('heiss-ui-prefs'), 'studio-prefs');
  assert.equal(currentStorageKey('heiss-ui-draft:account:abc'), 'studio-draft:account:abc');
  assert.equal(currentStorageKey('heiss-ui:starter-pick:account:abc'), 'studio:starter-pick:account:abc');
  assert.equal(currentStorageKey('heiss.generationMosaic.crashed'), 'studio.generationMosaic.crashed');
  assert.equal(currentStorageKey('heiss-force-phone', renamedSessionKeys), 'studio-force-phone');
  assert.equal(currentStorageKey('studio-prefs'), '');
  assert.equal(currentStorageKey('heiss-ui-prefsextra'), '');
  assert.equal(currentStorageKey('j-ai-studio-prefs'), '');
  for (const [current, legacy] of renamedStorageKeys) assert.equal(currentStorageKey(legacy), current);
});

test('migration moves old values, keeps newer ones and leaves other keys alone', () => {
  const storage = memoryStorage({
    'heiss-ui-prefs': '{"dateHeaders":true}',
    'heiss-ui-draft:account:abc': '{"prompt":"kept"}',
    'heiss-ui-lora-library': '{"old":true}',
    'studio-lora-library': '{"new":true}',
    'j-ai-studio-prefs': '{}',
    'other': 'x'
  });
  assert.equal(migrateStorageKeys(storage), 2);
  assert.deepEqual(storage.entries(), {
    'studio-prefs': '{"dateHeaders":true}',
    'studio-draft:account:abc': '{"prompt":"kept"}',
    'studio-lora-library': '{"new":true}',
    'j-ai-studio-prefs': '{}',
    'other': 'x'
  });
  // A second start finds nothing left to move.
  assert.equal(migrateStorageKeys(storage), 0);
});

test('storage that refuses is left as it is', () => {
  const refusing = { length: 1, key: () => 'heiss-ui-prefs', getItem: () => '{}', setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('nope'); } };
  assert.equal(migrateStorageKeys(refusing), 0);
  assert.equal(migrateStorageKeys(null), 0);
});
