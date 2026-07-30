import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Flower Garden learning shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Flower Garden · First Bloom Meadow<\/title>/i);
  assert.match(html, /Flower Garden/);
  assert.match(html, /First Bloom Meadow/);
  assert.match(html, /The First Flow/);
  assert.match(html, /RUNTIME TRACE/);
  assert.match(html, /Engine/);
  assert.match(html, /Worker/);
  assert.match(html, /StepResult/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("removes starter preview code and declares the 3D world dependencies", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /FirstBloomMeadow/);
  assert.match(layout, /Flower Garden · First Bloom Meadow/);
  assert.match(layout, /<html lang="ko">/);
  assert.match(packageJson, /"@react-three\/fiber"/);
  assert.match(packageJson, /"three"/);
  assert.match(packageJson, /"cross-env"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page + layout, /_sites-preview|codex-preview/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(
    access(new URL("../public/_sites-preview", projectRoot)),
  );
});

test("canonical replay is a contiguous trace from four real Worker ticks", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../contracts/fixtures/first-bloom-the-first-flow.trace.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(fixture.schemaVersion, "1.0.0");
  assert.equal(fixture.worldId, "first-bloom-meadow");
  assert.equal(fixture.missionId, "the-first-flow");
  assert.equal(fixture.flowerVersion, "0.1.1");
  assert.deepEqual(
    fixture.events.map((event) => event.sequence),
    Array.from({ length: fixture.events.length }, (_, index) => index + 1),
  );
  assert.ok(
    fixture.events.every(
      (event) =>
        event.schemaVersion === "1.0.0" &&
        event.runId === fixture.runId &&
        Array.isArray(event.evidence),
    ),
  );

  const requested = fixture.events.filter(
    (event) => event.kind === "GARDEN.TICK_REQUESTED",
  );
  const completed = fixture.events.filter(
    (event) => event.kind === "GARDEN.TICK_COMPLETED",
  );
  const stepResults = fixture.events
    .filter((event) => event.kind === "FLOWER.STEP_RESULT")
    .map((event) => [event.flow.stepId, event.payload.result]);

  assert.equal(requested.length, 4);
  assert.equal(completed.length, 4);
  assert.deepEqual(stepResults, [
    ["prepare-soil", "STAY"],
    ["prepare-soil", "DONE"],
    ["grow-stem", "DONE"],
    ["bloom", "DONE"],
  ]);
  assert.equal(fixture.events.at(-1).sequence, 22);
  assert.ok(
    fixture.events.some((event) => event.kind === "FLOWER.FLOW_FINISHED"),
  );
});
