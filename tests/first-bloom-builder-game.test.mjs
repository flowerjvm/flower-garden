import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function importTypeScriptModule(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const source = await readFile(absolutePath, "utf8");
  const result = ts.transpileModule(source, {
    fileName: absolutePath,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    errors.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
    [],
  );

  const sourceUrl = pathToFileURL(absolutePath).href;
  const encoded = Buffer.from(
    `${result.outputText}\n//# sourceURL=${sourceUrl}`,
  ).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const builder = await importTypeScriptModule(
  "worlds/first-bloom-meadow/web/builderGame.ts",
);
const projectionModule = await importTypeScriptModule(
  "web/projection/firstBloomProjection.ts",
);
const clientModule = await importTypeScriptModule(
  "web/runtime/client.ts",
);

function runtimeTraceEvent(
  sequence,
  {
    runId = "run",
    kind = "GARDEN.RUN_CREATED",
    payload = {},
    flow = null,
  } = {},
) {
  return {
    schemaVersion: "1.0.0",
    eventId: `${runId}:${sequence}`,
    runId,
    sequence,
    logicalTimeMillis: 0,
    source: "RUN_COORDINATOR",
    kind,
    flow,
    payload,
    evidence: [],
  };
}

function runtimeRun({
  runId = "run",
  worldId = "first-bloom-meadow",
  missionId = "the-first-flow",
  events = [runtimeTraceEvent(1, { runId })],
  outcome = null,
} = {}) {
  return {
    schemaVersion: "1.0.0",
    runId,
    worldId,
    missionId,
    flowerRuntimeVersion: "0.1.2",
    phase: "READY",
    currentStepId: null,
    events,
    evidence: [],
    outcome,
  };
}

function assemble(stepIds) {
  let draft = builder.createEmptyFirstBloomDraft();
  draft = builder.placeFirstBloomPart(draft, "worker");
  draft = builder.placeFirstBloomPart(draft, "flow");
  for (const stepId of stepIds) {
    draft = builder.placeFirstBloomPart(draft, stepId);
  }
  return draft;
}

test("the builder requires Worker, Flow, and four unique Step parts", () => {
  const empty = builder.createEmptyFirstBloomDraft();
  assert.deepEqual(empty.stepSlots, [null, null, null, null]);
  assert.equal(builder.checkFirstBloomDraft(empty).ready, false);
  assert.equal(builder.checkFirstBloomDraft(empty).totalCount, 6);

  const complete = assemble([
    "prepare-soil",
    "wait-for-sunlight",
    "grow-stem",
    "bloom",
  ]);
  assert.equal(builder.checkFirstBloomDraft(complete).ready, true);
  assert.equal(builder.checkFirstBloomDraft(complete).placedCount, 6);

  const duplicate = builder.placeFirstBloomPart(
    complete,
    "prepare-soil",
  );
  assert.deepEqual(duplicate, complete);
});

test("the browser serializes any complete order without judging the winner", () => {
  const experimentalOrder = [
    "bloom",
    "prepare-soil",
    "grow-stem",
    "wait-for-sunlight",
  ];
  const draft = assemble(experimentalOrder);
  const blueprint = builder.createFirstBloomBlueprint(draft);

  assert.equal(builder.checkFirstBloomDraft(draft).ready, true);
  assert.deepEqual(blueprint, {
    schemaVersion: "1.0.0",
    workerId: "first-bloom-worker",
    flowType: "first-flow",
    stepIds: experimentalOrder,
  });
});

test("blindly clicking the Step palette does not reveal the successful dependency order", () => {
  const paletteOrder = builder.FIRST_BLOOM_PARTS
    .filter((part) => part.kind === "STEP")
    .map((part) => part.id);

  assert.deepEqual(paletteOrder, [
    "bloom",
    "grow-stem",
    "prepare-soil",
    "wait-for-sunlight",
  ]);
  assert.notDeepEqual(paletteOrder, builder.FIRST_BLOOM_STEP_IDS);
  assert.deepEqual(
    builder.createFirstBloomBlueprint(assemble(paletteOrder)).stepIds,
    paletteOrder,
  );
});

test("Step blocks can move and return to the palette without hidden state", () => {
  const original = assemble([
    "prepare-soil",
    "wait-for-sunlight",
    "grow-stem",
    "bloom",
  ]);
  const moved = builder.moveFirstBloomStep(original, 0, 2);
  assert.deepEqual(moved.stepSlots, [
    "grow-stem",
    "wait-for-sunlight",
    "prepare-soil",
    "bloom",
  ]);

  const removed = builder.removeFirstBloomPart(
    moved,
    "wait-for-sunlight",
  );
  assert.deepEqual(removed.stepSlots, [
    "grow-stem",
    null,
    "prepare-soil",
    "bloom",
  ]);
  assert.equal(builder.checkFirstBloomDraft(removed).ready, false);
});

test("First Bloom accepts only an immutable extension of one run trace", () => {
  const originalEvents = [
    runtimeTraceEvent(1),
    runtimeTraceEvent(2, {
      kind: "GARDEN.FLOW_READY",
      flow: {
        type: "first-flow",
        key: "run",
        state: "READY",
        stepId: "prepare-soil",
        stepNo: 0,
      },
    }),
  ];
  const previous = clientModule.normalizeRunResponse(
    runtimeRun({ events: structuredClone(originalEvents) }),
  );
  const extended = clientModule.normalizeRunResponse(
    runtimeRun({
      events: [
        ...structuredClone(originalEvents),
        runtimeTraceEvent(3, { kind: "GARDEN.TICK_REQUESTED" }),
      ],
    }),
  );

  assert.equal(
    clientModule.acceptFirstBloomCumulativeRun(null, previous),
    previous,
  );
  assert.equal(
    clientModule.acceptFirstBloomCumulativeRun(previous, extended),
    extended,
  );

  const changedPrefixResponse = runtimeRun({
    events: structuredClone(originalEvents),
  });
  changedPrefixResponse.events[1].flow.stepNo = 99;
  const changedPrefix =
    clientModule.normalizeRunResponse(changedPrefixResponse);
  assert.throws(
    () =>
      clientModule.acceptFirstBloomCumulativeRun(
        previous,
        changedPrefix,
      ),
    /immutable runtime trace prefix changed/,
  );

  const shrunk = clientModule.normalizeRunResponse(
    runtimeRun({ events: [structuredClone(originalEvents[0])] }),
  );
  assert.throws(
    () =>
      clientModule.acceptFirstBloomCumulativeRun(previous, shrunk),
    /trace cannot shrink/,
  );

  const otherRunEvents = originalEvents.map((event) => ({
    ...structuredClone(event),
    eventId: `other-run:${event.sequence}`,
    runId: "other-run",
    flow:
      event.flow === null
        ? null
        : { ...structuredClone(event.flow), key: "other-run" },
  }));
  const otherRun = clientModule.normalizeRunResponse(
    runtimeRun({
      runId: "other-run",
      events: otherRunEvents,
    }),
  );
  assert.throws(
    () =>
      clientModule.acceptFirstBloomCumulativeRun(previous, otherRun),
    /different run/,
  );
});

test("First Bloom rejects a response for another world or mission", () => {
  assert.throws(
    () =>
      clientModule.normalizeRunResponse(
        runtimeRun({ worldId: "verdant-signal-garden" }),
      ),
    /response\.worldId must be first-bloom-meadow/,
  );
  assert.throws(
    () =>
      clientModule.normalizeRunResponse(
        runtimeRun({ missionId: "another-mission" }),
      ),
    /response\.missionId must be the-first-flow/,
  );
});

test("First Bloom normalizes the complete JVM RunView outcome", () => {
  const validOutcome = {
    schemaVersion: "1.0.0",
    status: "PASSED",
    finalState: "BLOOMED",
    workerTicks: 5,
    summary: "The assembled Flower Flow bloomed.",
  };
  const normalized = clientModule.normalizeRunResponse(
    runtimeRun({ outcome: validOutcome }),
  );
  assert.deepEqual(normalized.outcome, validOutcome);

  const invalidOutcomes = [
    {},
    { ...validOutcome, schemaVersion: "0.9.0" },
    { ...validOutcome, status: "COMPLETED" },
    { ...validOutcome, finalState: "SIGNALED" },
    { ...validOutcome, workerTicks: -1 },
    { ...validOutcome, workerTicks: 1.5 },
    { ...validOutcome, summary: "" },
    { ...validOutcome, extra: true },
  ];
  for (const outcome of invalidOutcomes) {
    assert.throws(() =>
      clientModule.normalizeRunResponse(runtimeRun({ outcome })),
    );
  }
});

function traceEvent(sequence, type, payload = {}, stepId) {
  return {
    schemaVersion: "1.0.0",
    eventId: `run:${sequence}`,
    runId: "run",
    sequence,
    logicalTimeMillis: 0,
    type,
    source: "RUN_COORDINATOR",
    flowId: stepId ? "first-flow:run" : undefined,
    stepId,
    summary: type,
    payload,
    evidence: [],
  };
}

test("World Projection does not invent a blueprint or garden progress", () => {
  const readyOnly = projectionModule.projectFirstBloom([
    traceEvent(1, "GARDEN.FLOW_READY"),
  ]);
  assert.deepEqual(readyOnly.blueprintStepIds, []);
  assert.equal(readyOnly.gardenState, "EMPTY");
  assert.equal(readyOnly.flowerStage, 0);

  const exitedOnly = projectionModule.projectFirstBloom([
    traceEvent(
      1,
      "GARDEN.BLUEPRINT_ACCEPTED",
      {
        stepIds: [
          "bloom",
          "prepare-soil",
          "wait-for-sunlight",
          "grow-stem",
        ],
      },
    ),
    traceEvent(
      2,
      "FLOWER.STEP_RESULT",
      { result: "DONE" },
      "prepare-soil",
    ),
    traceEvent(3, "FLOWER.STEP_EXITED", {}, "prepare-soil"),
  ]);
  assert.deepEqual(exitedOnly.blueprintStepIds, [
    "bloom",
    "prepare-soil",
    "wait-for-sunlight",
    "grow-stem",
  ]);
  assert.equal(exitedOnly.gardenState, "EMPTY");
  assert.equal(exitedOnly.flowerStage, 0);
});

test("World Projection rejects malformed authoritative blueprint events", () => {
  const invalidStepLists = [
    undefined,
    [
      "prepare-soil",
      "wait-for-sunlight",
      "grow-stem",
    ],
    [
      "prepare-soil",
      "wait-for-sunlight",
      "grow-stem",
      "grow-stem",
    ],
    [
      "prepare-soil",
      "wait-for-sunlight",
      "grow-stem",
      "run-arbitrary-code",
    ],
  ];

  for (const stepIds of invalidStepLists) {
    assert.throws(
      () =>
        projectionModule.projectFirstBloom([
          traceEvent(
            1,
            "GARDEN.BLUEPRINT_ACCEPTED",
            stepIds === undefined ? {} : { stepIds },
          ),
        ]),
      /GARDEN\.BLUEPRINT_ACCEPTED payload\.stepIds/,
    );
  }
});

test("World Projection rejects malformed authoritative garden state", () => {
  for (const payload of [
    {},
    { gardenState: "SIGNALED" },
    { gardenState: 2 },
  ]) {
    assert.throws(
      () =>
        projectionModule.projectFirstBloom([
          traceEvent(1, "GARDEN.PLOT_UPDATED", payload),
        ]),
      /GARDEN\.PLOT_UPDATED payload\.gardenState/,
    );
  }
});

test("only actual runtime state and Bloom event facts change the 3D projection", () => {
  const events = [
    traceEvent(
      1,
      "GARDEN.BLUEPRINT_ACCEPTED",
      {
        stepIds: [
          "prepare-soil",
          "wait-for-sunlight",
          "grow-stem",
          "bloom",
        ],
      },
    ),
    traceEvent(
      2,
      "GARDEN.PLOT_UPDATED",
      { gardenState: "SOIL_READY" },
      "prepare-soil",
    ),
    traceEvent(
      3,
      "FIRST_BLOOM.SUNLIGHT_WAITING",
      {},
      "wait-for-sunlight",
    ),
    traceEvent(4, "GARDEN.BLOOM_EVENT_PUBLISHED", {
      eventType: "SUNLIGHT_GRANTED",
    }),
  ];
  const published = projectionModule.projectFirstBloom(events);
  assert.equal(published.gardenState, "SOIL_READY");
  assert.equal(published.waitingForBloomEvent, true);
  assert.equal(published.bloomEventPublished, true);

  const accepted = projectionModule.projectFirstBloom([
    ...events,
    traceEvent(
      5,
      "FIRST_BLOOM.SUNLIGHT_ACCEPTED",
      {},
      "wait-for-sunlight",
    ),
  ]);
  assert.equal(accepted.gardenState, "SOIL_READY");
  assert.equal(accepted.waitingForBloomEvent, false);

  const updated = projectionModule.projectFirstBloom([
    ...events,
    traceEvent(
      5,
      "FIRST_BLOOM.SUNLIGHT_ACCEPTED",
      {},
      "wait-for-sunlight",
    ),
    traceEvent(
      6,
      "GARDEN.PLOT_UPDATED",
      { gardenState: "SUNLIGHT_READY" },
      "wait-for-sunlight",
    ),
  ]);
  assert.equal(updated.gardenState, "SUNLIGHT_READY");
});

test("a failed real Step never becomes a completed flower", () => {
  const failed = projectionModule.projectFirstBloom([
    traceEvent(
      1,
      "GARDEN.BLUEPRINT_ACCEPTED",
      {
        stepIds: [
          "grow-stem",
          "prepare-soil",
          "wait-for-sunlight",
          "bloom",
        ],
      },
    ),
    traceEvent(
      2,
      "FLOWER.STEP_RESULT",
      { result: "FAIL" },
      "grow-stem",
    ),
    traceEvent(
      3,
      "GARDEN.MISSION_BLOCKED",
      {
        stepId: "grow-stem",
        code: "SOIL_NOT_READY",
        message: "prepared soil is required",
      },
      "grow-stem",
    ),
    traceEvent(4, "FLOWER.FLOW_FAILED", {}, "grow-stem"),
  ]);

  assert.equal(failed.phase, "FAILED");
  assert.equal(failed.gardenState, "EMPTY");
  assert.equal(failed.flowerStage, 0);
  assert.equal(failed.failedStepId, "grow-stem");
});

test("First Bloom is a compact builder with interactive camera and Bloom input", async () => {
  const [component, scene, styles, client] = await Promise.all([
    readFile(
      path.join(
        repositoryRoot,
        "worlds/first-bloom-meadow/web/FirstBloomMeadow.tsx",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        repositoryRoot,
        "worlds/first-bloom-meadow/web/FirstBloomScene.tsx",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        repositoryRoot,
        "worlds/first-bloom-meadow/web/FirstBloomBuilder.module.css",
      ),
      "utf8",
    ),
    readFile(
      path.join(repositoryRoot, "web/runtime/client.ts"),
      "utf8",
    ),
  ]);

  assert.match(component, /FLOW BUILDER/);
  assert.match(component, /꽃 한 송이 피우기/);
  assert.match(component, /이벤트 보내기/);
  assert.match(component, /createFirstBloomBlueprint/);
  assert.match(component, /acceptFirstBloomCumulativeRun/);
  assert.match(component, /rawFromIndex !== ""/);
  assert.match(component, /eventNeeded \? \(/);
  assert.match(component, /☀ 햇빛 보내기/);
  assert.match(component, /mobileCameraEnabled/);
  assert.match(component, /\(!terminal && !runtimeError\)/);
  assert.doesNotMatch(component, /진실의 기록|PendingReview|PREDICTIONS/);
  assert.match(scene, /OrbitControls/);
  assert.match(scene, /enableRotate = true/);
  assert.match(scene, /enableZoom = true/);
  assert.match(scene, /enablePan = true/);
  assert.match(scene, /controls\.enabled = enabled/);
  assert.match(scene, /TerrainBatch/);
  assert.doesNotMatch(scene, /meshLambertMaterial vertexColors/);
  assert.match(styles, /touch-action: pan-y/);
  assert.match(styles, /\.cameraActive/);
  assert.match(styles, /first-bloom-builder-canvas\) canvas/);
  assert.match(styles, /touch-action: pan-y !important/);
  assert.match(client, /kind: "PUBLISH_EVENT"/);
  assert.match(client, /type: "SUNLIGHT_GRANTED"/);
});
