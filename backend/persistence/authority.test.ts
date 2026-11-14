import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readGalleryRows, writeGalleryRows } from "./gallery-rows.ts";
import { closeRuntimeDatabase, readRuntimeDocument, runtimeDatabase } from "./runtime.ts";

test("Studio refuses a folder still on JSON; on current storage, sign-in and gallery edits persist across restarts", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-authority-"));
  const earlier = fs.mkdtempSync(path.join(os.tmpdir(), "studio-authority-earlier-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    closeRuntimeDatabase(earlier);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(earlier, { recursive: true, force: true });
  });
  const run = (source: string, folder = dataDir) =>
    execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        STUDIO_DATA_DIR: folder,
        STUDIO_ENV_FILE: "/dev/null",
        STUDIO_MULTI_USER: "",
        STUDIO_WORKERS: JSON.stringify([
          {
            id: "primary",
            url: "http://127.0.0.1:9",
            capabilities: ["image", "video", "upscale", "models"],
          },
        ]),
      },
    });
  run(
    `
    import {createLocalAccount} from './backend/account-store.js';
    await createLocalAccount({username:'authority.example',password:'fixture password for authority',role:'administrator'});
  `,
    dataDir,
  );
  // A data folder as JSON-era Studio left it: the accounts store as a file.
  fs.writeFileSync(
    path.join(earlier, "accounts.json"),
    JSON.stringify(readRuntimeDocument(dataDir, "accounts")),
  );
  assert.throws(
    () => run(`import './backend/storage-check.js';`, earlier),
    /accounts\.json, so it predates current storage/,
  );

  const kept = { id: "kept", jobId: "kept-job", index: 0, type: "image", status: "pending" };
  writeGalleryRows(runtimeDatabase(dataDir), [kept]);
  closeRuntimeDatabase(dataDir);
  run(`
    import assert from 'node:assert/strict';
    import './backend/storage-check.js';
    import {verifyLocalAccount,createAccountSession,accountSession} from './backend/account-store.js';
    import {galleryItems,putGalleryItems} from './backend/gallery/store.js';
    import {runtimeDatabase} from './backend/persistence/runtime.ts';
    import {readGalleryRows} from './backend/persistence/gallery-rows.ts';
    const account=await verifyLocalAccount('authority.example','fixture password for authority');
    assert.ok(account?.userId);
    const session=createAccountSession(account.userId);
    assert.equal(accountSession(session.token).userId,account.userId);
    assert.equal(galleryItems()[0].id,'kept');
    const db=runtimeDatabase(${JSON.stringify(dataDir)});
    db.exec('PRAGMA query_only=ON');
    const added={id:'added',type:'image',status:'pending',createdAt:'2020-01-02T00:00:00Z'};
    assert.throws(()=>putGalleryItems([added]));
    assert.equal(readGalleryRows(db).length,1);
    db.exec('PRAGMA query_only=OFF');
    putGalleryItems([added]);
  `);
  run(`
    import assert from 'node:assert/strict';
    import {accountStoreSnapshot} from './backend/account-store.js';
    import {galleryItems} from './backend/gallery/store.js';
    assert.equal(accountStoreSnapshot().sessions,1);
    assert.equal(galleryItems().length,2);
    assert.ok(galleryItems().every(item=>item.status==='pending'));
  `);
  assert.equal(readGalleryRows(runtimeDatabase(dataDir)).length, 2);
});
