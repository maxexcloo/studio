import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'heiss-account-export-'));
const output = path.join(temporary, 'output');
process.env.HEISS_DATA_DIR = path.join(temporary, 'data');
process.env.COMFY_OUTPUT_DIR = output;
process.env.STUDIO_MULTI_USER = '1';
const { setGallery } = await import('./gallery-store.js');
const { accountOutputSubfolder } = await import('./account-ownership.js');
const { sendGalleryExport } = await import('./gallery-export.js');
const ownerA = { heissAccount: { userId: 'account-a' } };
const ownerB = { heissAccount: { userId: 'account-b' } };
for (const [owner, name] of [['account-a', 'account-a.png'], ['account-b', 'account-b.png']]) {
  const folder = accountOutputSubfolder(owner);
  fs.mkdirSync(path.join(output, folder), { recursive: true });
  fs.writeFileSync(path.join(output, folder, name), owner);
}
setGallery([
  { id: 'a', ownerId: 'account-a', status: 'done', type: 'image', filename: 'account-a.png', outputName: 'account-a.png', url: `/comfy/view?filename=account-a.png&subfolder=${accountOutputSubfolder('account-a')}&type=output` },
  { id: 'b', ownerId: 'account-b', status: 'done', type: 'image', filename: 'account-b.png', outputName: 'account-b.png', url: `/comfy/view?filename=account-b.png&subfolder=${accountOutputSubfolder('account-b')}&type=output` }
], { persist: false });

async function archive(req) {
  const response = new class extends EventEmitter {
    chunks = [];
    write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; }
    end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.emit('finish'); }
    destroy() { this.emit('close'); }
  }();
  await sendGalleryExport(response, [], { req });
  return Buffer.concat(response.chunks).toString('latin1');
}

test('gallery exports include only the signed-in account outputs in account mode', async () => {
  const a = await archive(ownerA);
  assert.match(a, /gallery\/account-a\.png/);
  assert.doesNotMatch(a, /gallery\/account-b\.png/);
  const b = await archive(ownerB);
  assert.match(b, /gallery\/account-b\.png/);
  assert.doesNotMatch(b, /gallery\/account-a\.png/);
  const anonymous = await archive(null);
  assert.doesNotMatch(anonymous, /account-[ab]\.png/);
});
