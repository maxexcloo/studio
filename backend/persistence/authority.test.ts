import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateRuntime, planRuntimeMigration } from "./migration.ts";
import { closeRuntimeDatabase, readRuntimeDocument } from "./runtime.ts";
import { DatabaseSync } from "node:sqlite";

test("account sign-in and gallery edits persist across migrated SQLite restarts, preserving legacy files", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-authority-"));
  t.after(() => {
    closeRuntimeDatabase(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const run = (source: string) =>
    execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        STUDIO_DATA_DIR: dataDir,
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
  run(`
    import {createLocalAccount} from './backend/account-store.js';
    import {setGallery,flushGalleryStrict} from './backend/gallery-store.js';
    await createLocalAccount({username:'migration.example',password:'fixture password for migration',role:'administrator'});
    setGallery([{id:'kept',jobId:'kept-job',index:0,type:'image',status:'pending',createdAt:'2020-01-01T00:00:00Z'}]);
    await flushGalleryStrict();
  `);
  const legacyAccounts = fs.readFileSync(path.join(dataDir, "accounts.json"), "utf8");
  const legacyGallery = fs.readFileSync(path.join(dataDir, "gallery.json"), "utf8");
  assert.equal(migrateRuntime(dataDir, { apply: true }).applied, true);
  run(`
    import assert from 'node:assert/strict';
    import {verifyLocalAccount,createAccountSession,accountSession} from './backend/account-store.js';
    import {gallery,setGallery,flushGalleryStrict} from './backend/gallery-store.js';
    import {runtimeDatabase,readRuntimeDocument} from './backend/persistence/runtime.ts';
    const account=await verifyLocalAccount('migration.example','fixture password for migration');
    assert.ok(account?.userId);
    const session=createAccountSession(account.userId);
    assert.equal(accountSession(session.token).userId,account.userId);
    assert.equal(gallery[0].id,'kept');
    const db=runtimeDatabase(${JSON.stringify(dataDir)});
    db.exec('PRAGMA query_only=ON');
    setGallery([...gallery,{id:'after-migration',type:'image',status:'pending',createdAt:'2020-01-02T00:00:00Z'}]);
    await assert.rejects(flushGalleryStrict());
    assert.equal(readRuntimeDocument(${JSON.stringify(dataDir)},'gallery').length,1);
    db.exec('PRAGMA query_only=OFF');
    await flushGalleryStrict();
  `);
  run(`
    import assert from 'node:assert/strict';
    import {accountStoreSnapshot} from './backend/account-store.js';
    import {gallery} from './backend/gallery-store.js';
    assert.equal(accountStoreSnapshot().sessions,1);
    assert.equal(gallery.length,2);
    assert.ok(gallery.every(item=>item.status==='pending'));
  `);
  assert.equal((readRuntimeDocument(dataDir, "gallery") as unknown[]).length, 2);
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
