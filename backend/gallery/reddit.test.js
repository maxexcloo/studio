import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "studio-reddit-"));
process.env.STUDIO_DATA_DIR = temporary;
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const { importRedditPost, redditPostPath } = await import("./reddit.js");

const picture = (background) =>
  sharp({ create: { width: 24, height: 16, channels: 3, background } })
    .jpeg()
    .toBuffer();
const page = (title, media) => `<html><body>
  <h1 class="post_title">
    <a href="/r/pics/search?q=flair" class="post_flair"><span>OC</span></a>
    ${title}
  </h1>
  <!-- POST MEDIA -->
  ${media}
  <!-- POST BODY -->
  <div class="post_body"><a href="/img/in-a-comment.jpg">not the post's</a></div>
</body></html>`;

/** A stand-in for reddit.excloo.com: its pages and images by path, and every URL asked for. */
function fakeRedlib(routes) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    const found = routes[url.pathname + url.search];
    if (!found) return new Response("Not found", { status: 404 });
    return typeof found === "string"
      ? new Response(found, { headers: { "content-type": "text/html" } })
      : found instanceof Response
        ? found
        : new Response(found, { headers: { "content-type": "image/jpeg" } });
  };
  return { fetch, asked };
}

test("a post or gallery link of any Reddit host reads from Redlib", () => {
  for (const [link, route] of [
    ["https://www.reddit.com/r/pics/comments/abc123/a_title/", "/comments/abc123"],
    ["https://old.reddit.com/r/pics/comments/abc123/", "/comments/abc123"],
    ["https://redd.it/abc123", "/comments/abc123"],
    ["https://www.reddit.com/gallery/abc123", "/comments/abc123"],
    ["https://reddit.excloo.com/comments/abc123", "/comments/abc123"],
    ["https://www.reddit.com/r/pics/s/Share42", "/r/pics/s/Share42"],
  ])
    assert.equal(redditPostPath(link), route, link);
  assert.throws(() => redditPostPath("https://www.reddit.com/r/pics/"), /link to a Reddit post/);
});

test("a single-image post becomes one upload recording its link and title", async () => {
  const redlib = fakeRedlib({
    "/comments/one": page(
      "Glacier at dawn &amp; dusk [OC]",
      `<div class="post_media_content"><a href="/img/one.jpeg" class="post_media_image"><img src="/img/one.jpeg"/></a></div>`,
    ),
    "/img/one.jpeg": await picture("#335577"),
  });
  const result = await importRedditPost("https://www.reddit.com/r/pics/comments/one/x/", "acct", {
    fetch: redlib.fetch,
  });
  assert.equal(result.title, "Glacier at dawn & dusk [OC]");
  assert.deepEqual(result.failed, []);
  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.uploaded, true);
  assert.equal(item.ownerId, "acct");
  assert.equal(item.type, "image");
  assert.deepEqual(item.source, {
    url: "https://www.reddit.com/comments/one",
    title: "Glacier at dawn & dusk [OC]",
  });
  assert.ok(redlib.asked.every((url) => url.startsWith("https://reddit.excloo.com/")));
});

test("a gallery saves each image and lists the ones that aren't images", async () => {
  const redlib = fakeRedlib({
    "/comments/many": page(
      "Three views",
      `<div class="gallery">
        <figure><a href="/img/a.jpeg"><img src="/img/a.jpeg"/></a></figure>
        <figure><a href="/preview/pre/b.jpeg?width=2048&amp;s=sig"><img/></a></figure>
        <figure><a href="/img/c.gif"><img/></a></figure>
      </div>`,
    ),
    "/img/a.jpeg": await picture("#aa3322"),
    "/preview/pre/b.jpeg?width=2048&s=sig": await picture("#22aa33"),
    "/img/c.gif": new Response("GIF89a", { headers: { "content-type": "image/gif" } }),
  });
  const result = await importRedditPost("https://redd.it/many", "", { fetch: redlib.fetch });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.failed, [{ image: 3, error: "It isn’t a PNG, JPEG or WebP image." }]);
  assert.ok(!redlib.asked.some((url) => url.includes("in-a-comment")), "only the post's media");
});

test("a post without images says so", async () => {
  const redlib = fakeRedlib({ "/comments/text": page("Just words", "") });
  await assert.rejects(
    importRedditPost("https://reddit.com/comments/text", "", { fetch: redlib.fetch }),
    /has no images/,
  );
});

test("only Reddit links are taken, and nothing is fetched beyond Redlib", async () => {
  const redlib = fakeRedlib({
    "/comments/away": new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data" },
    }),
  });
  for (const link of [
    "https://example.com/r/pics/comments/abc/",
    "https://i.redd.it.example.com/comments/abc",
    "file:///etc/passwd",
  ])
    await assert.rejects(
      importRedditPost(link, "", { fetch: redlib.fetch }),
      /Only Reddit post links|link to a Reddit post/,
    );
  await assert.rejects(
    importRedditPost("https://redd.it/away", "", { fetch: redlib.fetch }),
    /somewhere else/,
  );
  assert.deepEqual(redlib.asked, ["https://reddit.excloo.com/comments/away"]);
});
