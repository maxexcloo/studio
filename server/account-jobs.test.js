import assert from "node:assert/strict";
import test from "node:test";
import { accountOutstandingJobs, configuredAccountJobLimit, reserveAccountJob } from "./account-jobs.js";

test("outstanding job counts include only active work owned by that account", () => {
  const jobs = new Map([
    ["queued", { ownerId: "artist-a", status: "queued" }],
    ["running", { ownerId: "artist-a", status: "running" }],
    ["canceling", { ownerId: "artist-a", status: "canceling" }],
    ["done", { ownerId: "artist-a", status: "done" }],
    ["other", { ownerId: "artist-b", status: "running" }]
  ]);
  assert.equal(accountOutstandingJobs("artist-a", jobs), 3);
  assert.equal(accountOutstandingJobs("artist-b", jobs), 1);
});

test("job reservations enforce a per-account cap atomically and release once", () => {
  const jobs = new Map([["one", { ownerId: "artist-a", status: "running" }]]);
  const reservations = new Map();
  const first = reserveAccountJob("artist-a", jobs, reservations, 3);
  const second = reserveAccountJob("artist-a", jobs, reservations, 3);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(reserveAccountJob("artist-a", jobs, reservations, 3).accepted, false);
  assert.equal(reserveAccountJob("artist-b", jobs, reservations, 1).accepted, true);
  first.release();
  first.release();
  assert.equal(reservations.get("artist-a"), 1);
  second.release();
  assert.equal(reservations.has("artist-a"), false);
});

test("the account job cap defaults safely and accepts only positive integers", () => {
  assert.equal(configuredAccountJobLimit(undefined), 2);
  assert.equal(configuredAccountJobLimit("4"), 4);
  for (const value of ["0", "-1", "1.5", "many"]) assert.equal(configuredAccountJobLimit(value), 2);
});
