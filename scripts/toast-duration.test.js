import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/app/toast.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { toast, toastSnapshot, dismissToast, runToastAction } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const clear = () => toastSnapshot().forEach(item => dismissToast(item.id));
test.afterEach(clear);

test('all notification tones, actions and legacy finite durations use three seconds', () => {
  for (const tone of ['info', 'success', 'warning', 'error', 'removed']) {
    clear();
    toast[tone]('A long notification '.repeat(10), { duration: 20000, action: { label: 'Try Again', onClick() {} } });
    assert.equal(toastSnapshot()[0].duration, 3000, tone);
  }
});

test('repeating notifications restart their countdown without running an action', () => {
  let ran = 0;
  const id = toast.removed('Item deleted', { group: 'delete', action: { label: 'Undo', onClick() { ran++; } } });
  const version = toastSnapshot()[0].version;
  toast.removed('Item deleted', { group: 'delete' });
  assert.equal(toastSnapshot()[0].id, id);
  assert.equal(toastSnapshot()[0].version, version + 1);
  assert.equal(toastSnapshot()[0].duration, 3000);
  dismissToast(id);
  assert.equal(ran, 0);
});

test('confirmation questions stay pending even with a finite requested duration', () => {
  let confirmed = 0;
  let cancelled = 0;
  const id = toast.warning('Delete Items?', { duration: 3000, confirm: { destructive: true }, action: { label: 'Delete', onClick() { confirmed++; } }, onClose() { cancelled++; } });
  assert.equal(toastSnapshot()[0].duration, Infinity);
  dismissToast(id);
  assert.equal(confirmed, 0);
  assert.equal(cancelled, 1);
  const approved = toast.warning('Delete Items?', { confirm: {}, action: { label: 'Delete', onClick() { confirmed++; } } });
  runToastAction(approved);
  assert.equal(confirmed, 1);
});

test('explicit live progress stays until its producer replaces it with a notification', () => {
  const id = toast.info('Applying allocation', { id: 'allocation', duration: Infinity });
  assert.equal(toastSnapshot()[0].duration, Infinity);
  toast.success('Allocation applied', { id });
  assert.equal(toastSnapshot()[0].duration, 3000);
});
