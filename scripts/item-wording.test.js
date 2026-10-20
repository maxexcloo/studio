import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteConfirmation, generatingLabel } from '../src/app/itemWording.js';

test('delete confirmations name videos as videos and use Title Case', () => {
  assert.equal(deleteConfirmation({ type: 'video' }).title, 'Delete This Video?');
  assert.equal(deleteConfirmation({ type: 'image' }).title, 'Delete This Image?');
  assert.equal(deleteConfirmation({ type: 'video' }).description, 'The file is deleted from disk.');
  assert.equal(deleteConfirmation({ type: 'image', library: {} }).title, 'Remove from Gallery?');
});

test('the running line names one image or one video', () => {
  assert.equal(generatingLabel(1, [{ type: 'video', status: 'pending' }]), 'Generating 1 video');
  assert.equal(generatingLabel(1, [{ type: 'video', status: 'done' }, { type: 'image', status: 'pending' }]), 'Generating 1 image');
  assert.equal(generatingLabel(3, []), 'Generating 3');
});
