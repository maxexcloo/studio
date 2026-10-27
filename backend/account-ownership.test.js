import assert from "node:assert/strict";
import test from "node:test";
import {
  accountOutputSubfolder,
  ownerIdForRequest,
  outputFilenameBelongsToRequest,
  outputSubfolderBelongsToRequest,
  recordBelongsToRequest,
  recordsForRequest,
} from "./account-ownership.js";

test("record ownership comes only from the authenticated server account", () => {
  const first = { ownerId: "account-a", id: "same-name" };
  const second = { ownerId: "account-b", id: "other" };
  const request = {
    studioAccount: { userId: "account-a", role: "user" },
    body: { ownerId: "account-b" },
  };
  assert.equal(ownerIdForRequest(request), "account-a");
  assert.equal(recordBelongsToRequest(first, request), true);
  assert.equal(recordBelongsToRequest(second, request), false);
  assert.deepEqual(recordsForRequest([first, second], request), [first]);
});

test("multi-user sessions do not inherit unowned legacy records", () => {
  const previous = process.env.STUDIO_MULTI_USER;
  process.env.STUDIO_MULTI_USER = "1";
  try {
    assert.equal(
      recordBelongsToRequest({ id: "old-record" }, { studioAccount: { userId: "new-account" } }),
      false,
    );
    assert.equal(
      recordBelongsToRequest(
        { ownerId: "new-account" },
        { studioAccount: { userId: "new-account" } },
      ),
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.STUDIO_MULTI_USER;
    else process.env.STUDIO_MULTI_USER = previous;
  }
});

test("account output paths are stable, server-derived and cannot overlap", () => {
  const first = accountOutputSubfolder("account-a");
  const second = accountOutputSubfolder("account-b");
  assert.match(first, /^studio\/accounts\/[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(
    outputSubfolderBelongsToRequest(`${first}/image_00001.png`, {
      studioAccount: { userId: "account-a" },
    }),
    true,
  );
  assert.equal(
    outputSubfolderBelongsToRequest(`${second}/image_00001.png`, {
      studioAccount: { userId: "account-a" },
    }),
    false,
  );
  assert.equal(
    outputSubfolderBelongsToRequest(first, { studioAccount: { userId: "account-a" } }),
    false,
  );
  assert.equal(
    outputFilenameBelongsToRequest("image_00001.png", first, {
      studioAccount: { userId: "account-a" },
    }),
    true,
  );
  assert.equal(
    outputFilenameBelongsToRequest("../account-b/image.png", first, {
      studioAccount: { userId: "account-a" },
    }),
    false,
  );
  assert.equal(
    outputFilenameBelongsToRequest("..\\account-b\\image.png", first, {
      studioAccount: { userId: "account-a" },
    }),
    false,
  );
});

test("an account's outputs go to and stay in its own folder", () => {
  const request = { studioAccount: { userId: "account-a", role: "user" } };
  const written = accountOutputSubfolder("account-a");
  assert.match(written, /^studio\/accounts\/[0-9a-f]{64}$/);
  assert.equal(outputSubfolderBelongsToRequest(`${written}/image.png`, request), true);
  assert.equal(outputFilenameBelongsToRequest("image.png", written, request), true);
  assert.equal(
    outputFilenameBelongsToRequest("image.png", accountOutputSubfolder("account-b"), request),
    false,
  );
});
