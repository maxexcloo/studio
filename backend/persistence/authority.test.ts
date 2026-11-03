import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateGalleryRows, migrateRuntime, planRuntimeMigration } from "./migration.ts";
import { readGalleryRows } from "./gallery-rows.ts";
import { closeRuntimeDatabase, readRuntimeDocument, runtimeDatabase } from "./runtime.ts";
import { DatabaseSync } from "node:sqlite";

test("Studio refuses a folder still on JSON; once migrated, sign-in and gallery edits persist across restarts", (t) => {
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
  // A data folder as JSON-era Studio left it: the accounts store and the gallery as files.
  run(
    `
    import {createLocalAccount} from './backend/account-store.js';
    await createLocalAccount({username:'migration.example',password:'fixture password for migration',role:'administrator'});
  `,
    earlier,
  );
  const legacyAccounts = JSON.stringify(readRuntimeDocument(earlier, "accounts"));
  const legacyGallery = JSON.stringify([
    { id: "kept", jobId: "kept-job", index: 0, type: "image", status: "pending" },
  ]);
  fs.writeFileSync(path.join(dataDir, "accounts.json"), legacyAccounts);
  fs.writeFileSync(path.join(dataDir, "gallery.json"), legacyGallery);
  assert.throws(() => run(`import './backend/gallery/store.js';`), /run migrate-runtime/);

  assert.equal(migrateRuntime(dataDir, { apply: true }).applied, true);
  assert.throws(() => run(`import './backend/gallery/store.js';`), /the gallery document/);
  assert.equal(migrateGalleryRows(dataDir, { apply: true }).applied, true);
  closeRuntimeDatabase(dataDir);
  run(`
    import assert from 'node:assert/strict';
    import {verifyLocalAccount,createAccountSession,accountSession} from './backend/account-store.js';
    import {gallery,setGallery,flushGalleryStrict} from './backend/gallery/store.js';
    import {runtimeDatabase} from './backend/persistence/runtime.ts';
    import {readGalleryRows} from './backend/persistence/gallery-rows.ts';
    const account=await verifyLocalAccount('migration.example','fixture password for migration');
    assert.ok(account?.userId);
    const session=createAccountSession(account.userId);
    assert.equal(accountSession(session.token).userId,account.userId);
    assert.equal(gallery[0].id,'kept');
    const db=runtimeDatabase(${JSON.stringify(dataDir)});
    db.exec('PRAGMA query_only=ON');
    setGallery([...gallery,{id:'after-migration',type:'image',status:'pending',createdAt:'2020-01-02T00:00:00Z'}]);
    await assert.rejects(flushGalleryStrict());
    assert.equal(readGalleryRows(db).length,1);
    db.exec('PRAGMA query_only=OFF');
    await flushGalleryStrict();
  `);
  run(`
    import assert from 'node:assert/strict';
    import {accountStoreSnapshot} from './backend/account-store.js';
    import {gallery} from './backend/gallery/store.js';
    assert.equal(accountStoreSnapshot().sessions,1);
    assert.equal(gallery.length,2);
    assert.ok(gallery.every(item=>item.status==='pending'));
  `);
  assert.equal(readGalleryRows(runtimeDatabase(dataDir)).length, 2);
  assert.equal(fs.readFileSync(path.join(dataDir, "accounts.json"), "utf8"), legacyAccounts);
  assert.equal(fs.readFileSync(path.join(dataDir, "gallery.json"), "utf8"), legacyGallery);
});

test("migration dry run reads an existing queue database without changing its schema or contents", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-dry-run-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, "studio.sqlite");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE existing_queue (id TEXT PRIMARY KEY); INSERT INTO existing_queue VALUES ('recorded')",
  );
  db.close();
  const original = fs.readFileSync(file);
  const names = fs.readdirSync(dataDir);
  assert.equal(planRuntimeMigration(dataDir).alreadyMigrated, false);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.deepEqual(fs.readdirSync(dataDir), names);
});
