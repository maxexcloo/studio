import assert from 'node:assert/strict';
import test from 'node:test';
import { generatingLabel } from '../src/app/itemWording.js';

test('the running line names one image or one video', () => {
  assert.equal(generatingLabel(1, [{ type: 'video', status: 'pending' }]), 'Generating 1 video');
  assert.equal(generatingLabel(1, [{ type: 'video', status: 'done' }, { type: 'image', status: 'pending' }]), 'Generating 1 image');
  assert.equal(generatingLabel(3, []), 'Generating 3');
});
