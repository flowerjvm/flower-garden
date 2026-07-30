import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const projectRoot = new URL("../", import.meta.url);
let verdantProjectionModule;

async function loadVerdantProjection() {
  if (!verdantProjectionModule) {
    const source = await readFile(
      new URL("../web/projection/verdantSignalProjection.ts", import.meta.url),
      "utf8",
    );
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: "verdantSignalProjection.ts",
    }).outputText;
    verdantProjectionModule = import(
      `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
    );
  }
  return verdantProjectionModule;
}

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost/"), {
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

test("server-renders Verdant Signal Garden as the second playable world", async () => {
  const response = await render("/worlds/verdant-signal-garden");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Flower Garden · Verdant Signal Garden<\/title>/i,
  );
  assert.match(html, /Flower Garden/);
  assert.match(html, /Verdant Signal Garden/);
  assert.match(html, /Signal vs Timeout/);
  assert.match(html, /SIGNAL_THEN_TIMEOUT/);
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

test("three Verdant replays preserve the actual Signal and Timeout decisions", async () => {
  const scenarios = [
    {
      file: "verdant-signal-at-29s.trace.json",
      id: "signal-at-29s",
      observed: [true, false],
      winner: "SIGNAL",
      finalState: "SIGNALED",
      finalSequence: 27,
      evidenceRef:
        "VerdantRunCoordinatorTest.signalBeforeDeadlineSelectsYardMove",
    },
    {
      file: "verdant-timeout-then-late-signal.trace.json",
      id: "timeout-then-late-signal",
      observed: [false, true],
      winner: "TIMEOUT",
      finalState: "TIMED_OUT",
      finalSequence: 26,
      evidenceRef:
        "VerdantRunCoordinatorTest.timeoutBeforeSignalSelectsTimeoutAndLateSignalCannotReopenWait",
    },
    {
      file: "verdant-both-at-deadline.trace.json",
      id: "both-at-deadline",
      observed: [true, true],
      winner: "SIGNAL",
      finalState: "SIGNALED",
      finalSequence: 28,
      evidenceRef:
        "VerdantRunCoordinatorTest.sameTickUsesExplicitSignalFirstStepPolicyRegardlessOfInputCommandOrder",
    },
  ];

  for (const scenario of scenarios) {
    const fixture = JSON.parse(
      await readFile(
        new URL(`../contracts/fixtures/${scenario.file}`, import.meta.url),
        "utf8",
      ),
    );

    assert.equal(fixture.schemaVersion, "1.0.0");
    assert.equal(fixture.worldId, "verdant-signal-garden");
    assert.equal(fixture.missionId, "signal-vs-timeout");
    assert.equal(fixture.scenarioId, scenario.id);
    assert.equal(fixture.flowerVersion, "0.1.1");
    assert.equal(fixture.expectedOutcome.winner, scenario.winner);
    assert.equal(fixture.expectedOutcome.finalState, scenario.finalState);
    assert.equal(
      fixture.expectedOutcome.finalSequence,
      scenario.finalSequence,
    );
    assert.equal(fixture.events.at(-1).sequence, scenario.finalSequence);
    assert.deepEqual(
      fixture.events.map((event) => event.sequence),
      Array.from({ length: fixture.events.length }, (_, index) => index + 1),
    );
    assert.equal(
      new Set(fixture.events.map((event) => event.eventId)).size,
      fixture.events.length,
    );
    assert.ok(Array.isArray(fixture.evidence));
    assert.ok(
      fixture.evidence.some(
        (item) =>
          item.type === "SOURCE" &&
          item.ref === "VerdantFlowFactory.WaitForYardAssignmentStep.onTick",
      ),
    );
    assert.ok(
      fixture.evidence.some(
        (item) =>
          item.type === "TEST" && item.ref === scenario.evidenceRef,
      ),
    );
    assert.ok(
      fixture.events.every(
        (event) =>
          event.schemaVersion === "1.0.0" &&
          event.runId === fixture.runId &&
          /^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$/.test(event.kind) &&
          Array.isArray(event.evidence),
      ),
    );

    const decision = fixture.events.find(
      (event) => event.kind === "VERDANT.WAIT_DECIDED",
    );
    assert.ok(decision, `${scenario.id} must contain a decision event`);
    assert.deepEqual(
      [decision.payload.signalPresent, decision.payload.timedOut],
      scenario.observed,
    );
    assert.equal(decision.payload.checkPrecedence, "SIGNAL_THEN_TIMEOUT");
    assert.equal(decision.payload.winner, scenario.winner);
    assert.equal(decision.payload.returnedStepResult, "GOTO");
    assert.ok(
      fixture.events.some(
        (event) =>
          event.sequence > decision.sequence &&
          event.kind === "FLOWER.STEP_RESULT" &&
          event.payload.result === "GOTO",
      ),
    );
    assert.ok(
      fixture.events.some((event) => event.kind === "FLOWER.FLOW_FINISHED"),
    );
  }

  const both = JSON.parse(
    await readFile(
      new URL(
        "../contracts/fixtures/verdant-both-at-deadline.trace.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.ok(
    both.events.some(
      (event) =>
        event.kind === "VERDANT.TIMEOUT_REJECTED" &&
        event.payload.reason === "SIGNAL_PRECEDENCE",
    ),
  );

  const timeout = JSON.parse(
    await readFile(
      new URL(
        "../contracts/fixtures/verdant-timeout-then-late-signal.trace.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const lateSignalRequest = timeout.events.find(
    (event) =>
      event.kind === "GARDEN.SIGNAL_SEND_REQUESTED" &&
      event.payload.waitStepActive === false,
  );
  assert.ok(lateSignalRequest);
  assert.ok(
    timeout.events.some(
      (event) =>
        event.sequence > lateSignalRequest.sequence &&
        event.kind === "GARDEN.SIGNAL_IGNORED",
    ),
  );
  assert.ok(
    timeout.events.every(
      (event) =>
        event.sequence <= lateSignalRequest.sequence ||
        event.kind !== "FLOWER.SIGNAL_RECEIVED",
    ),
  );
});

test("Verdant projection follows exact runtime facts and ignores unknown semantics", async () => {
  const { projectVerdantSignal } = await loadVerdantProjection();
  const scenarios = [
    {
      file: "verdant-signal-at-29s.trace.json",
      winner: "SIGNAL",
      path: "yard-move",
    },
    {
      file: "verdant-timeout-then-late-signal.trace.json",
      winner: "TIMEOUT",
      path: "timed-out",
    },
    {
      file: "verdant-both-at-deadline.trace.json",
      winner: "SIGNAL",
      path: "yard-move",
    },
  ];

  for (const scenario of scenarios) {
    const fixture = JSON.parse(
      await readFile(
        new URL(`../contracts/fixtures/${scenario.file}`, import.meta.url),
        "utf8",
      ),
    );
    const projection = projectVerdantSignal(fixture.events);

    assert.equal(projection.phase, "FINISHED");
    assert.equal(projection.winner, scenario.winner);
    assert.equal(projection.selectedPath, scenario.path);
    assert.equal(projection.decisionStepResult, "GOTO");
    assert.equal(projection.decisionTargetStepId, scenario.path);
    assert.equal(projection.routeCommitted, true);
  }

  const both = JSON.parse(
    await readFile(
      new URL(
        "../contracts/fixtures/verdant-both-at-deadline.trace.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const beforeDecidingTick = projectVerdantSignal(both.events.slice(0, 14));
  assert.equal(beforeDecidingTick.clockMillis, 30_000);
  assert.equal(beforeDecidingTick.signalStatus, "SENT");
  assert.equal(beforeDecidingTick.timeoutStatus, "ARMED");
  assert.equal(beforeDecidingTick.winner, undefined);
  assert.equal(beforeDecidingTick.selectedPath, undefined);

  const waitPrefix = both.events.slice(0, 9);
  const unknown = {
    ...structuredClone(waitPrefix.at(-1)),
    eventId: `${both.runId}:future-event`,
    sequence: 10,
    logicalTimeMillis: 999_999,
    kind: "FUTURE.UNKNOWN",
    flow: {
      ...structuredClone(waitPrefix.at(-1).flow),
      state: "FINISHED",
      stepId: "yard-move",
    },
    payload: {
      winner: "TIMEOUT",
      selectedPath: "timed-out",
      afterPhase: "FINISHED",
    },
  };
  const unknownProjection = projectVerdantSignal([...waitPrefix, unknown]);
  assert.equal(unknownProjection.phase, "RUNNING");
  assert.equal(unknownProjection.currentStepId, "wait-for-yard-assignment");
  assert.equal(unknownProjection.winner, undefined);
  assert.equal(unknownProjection.selectedPath, undefined);
  assert.equal(unknownProjection.clockMillis, 999_999);
  assert.equal(unknownProjection.activeEvent.kind, "FUTURE.UNKNOWN");
});
