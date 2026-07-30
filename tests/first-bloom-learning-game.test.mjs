import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadLearningGame() {
  const source = await readFile(
    new URL(
      "../worlds/first-bloom-meadow/web/learningGame.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "learningGame.ts",
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

function normalizeFixtureEvent(event) {
  return {
    ...event,
    type: event.kind,
    flowId: event.flow
      ? `${event.flow.type}:${event.flow.key}`
      : undefined,
    stepId: event.flow?.stepId ?? undefined,
  };
}

function tickGroups(events) {
  const groups = [];
  let current = null;

  for (const event of events) {
    if (event.type === "GARDEN.TICK_REQUESTED") {
      current = [];
    }
    if (current) {
      current.push(event);
    }
    if (current && event.type === "GARDEN.TICK_COMPLETED") {
      groups.push(current);
      current = null;
    }
  }

  return groups;
}

test("each First Bloom evidence question is validated by its actual tick trace", async () => {
  const {
    FIRST_BLOOM_LESSON_BEATS,
    evaluateFirstBloomEvidenceAnswer,
  } = await loadLearningGame();
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../contracts/fixtures/first-bloom-the-first-flow.trace.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const groups = tickGroups(fixture.events.map(normalizeFixtureEvent));

  assert.equal(FIRST_BLOOM_LESSON_BEATS.length, 4);
  assert.equal(groups.length, 4);
  assert.ok(
    new Set(
      FIRST_BLOOM_LESSON_BEATS.map((beat) =>
        beat.evidenceChoices.findIndex(
          (choice) => choice.id === beat.correctEvidenceChoiceId,
        ),
      ),
    ).size > 1,
    "the correct evidence must not always occupy the same button",
  );

  FIRST_BLOOM_LESSON_BEATS.forEach((beat, index) => {
    const correct = evaluateFirstBloomEvidenceAnswer(
      beat,
      beat.correctEvidenceChoiceId,
      groups[index],
    );
    assert.equal(correct.traceSupportsLesson, true, beat.id);
    assert.equal(correct.correct, true, beat.id);

    for (const wrongChoice of beat.evidenceChoices.filter(
      (choice) => choice.id !== beat.correctEvidenceChoiceId,
    )) {
      const wrong = evaluateFirstBloomEvidenceAnswer(
        beat,
        wrongChoice.id,
        groups[index],
      );
      assert.equal(wrong.traceSupportsLesson, true, beat.id);
      assert.equal(wrong.correct, false, `${beat.id}:${wrongChoice.id}`);
    }
  });
});

test("a missing runtime fact cannot be turned into lesson credit", async () => {
  const {
    FIRST_BLOOM_LESSON_BEATS,
    evaluateFirstBloomEvidenceAnswer,
  } = await loadLearningGame();
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../contracts/fixtures/first-bloom-the-first-flow.trace.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const groups = tickGroups(fixture.events.map(normalizeFixtureEvent));
  const finalBeat = FIRST_BLOOM_LESSON_BEATS.at(-1);
  const withoutRuntimeFinish = groups.at(-1).filter(
    (event) => event.type !== "FLOWER.FLOW_FINISHED",
  );

  const result = evaluateFirstBloomEvidenceAnswer(
    finalBeat,
    finalBeat.correctEvidenceChoiceId,
    withoutRuntimeFinish,
  );

  assert.equal(result.traceSupportsLesson, false);
  assert.equal(result.correct, false);
});

test("a pending evidence review locks the next real Worker tick", async () => {
  const { canRequestFirstBloomTick } = await loadLearningGame();
  const ready = {
    hasRun: true,
    hasPrediction: true,
    reviewPending: false,
    busy: false,
    isPlaying: false,
    atLatestCursor: true,
    runtimePhase: "RUNNING",
    completedTickCount: 1,
  };

  assert.equal(canRequestFirstBloomTick(ready), true);
  assert.equal(
    canRequestFirstBloomTick({ ...ready, reviewPending: true }),
    false,
  );
  assert.equal(
    canRequestFirstBloomTick({ ...ready, hasPrediction: false }),
    false,
  );
  assert.equal(
    canRequestFirstBloomTick({ ...ready, atLatestCursor: false }),
    false,
  );
  assert.equal(
    canRequestFirstBloomTick({ ...ready, runtimePhase: "FINISHED" }),
    false,
  );
  assert.equal(
    canRequestFirstBloomTick({ ...ready, completedTickCount: 4 }),
    false,
  );
});

test("runtime FINISHED and LESSON CLEARED are separate conditions", async () => {
  const {
    FIRST_BLOOM_LESSON_BEATS,
    isFirstBloomLessonCleared,
  } = await loadLearningGame();
  const allMastered = FIRST_BLOOM_LESSON_BEATS.map((beat) => beat.id);

  assert.equal(isFirstBloomLessonCleared("RUNNING", allMastered), false);
  assert.equal(
    isFirstBloomLessonCleared("FINISHED", allMastered.slice(0, 3)),
    false,
  );
  assert.equal(isFirstBloomLessonCleared("FINISHED", allMastered), true);
});

test("the First Bloom prediction UI only offers real StepResult values", async () => {
  const component = await readFile(
    new URL(
      "../worlds/first-bloom-meadow/web/FirstBloomMeadow.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const predictionBlock = component.slice(
    component.indexOf("const PREDICTIONS"),
    component.indexOf("const STEP_COPY"),
  );

  assert.match(predictionBlock, /value: "STAY"/);
  assert.match(predictionBlock, /value: "DONE"/);
  assert.doesNotMatch(predictionBlock, /NEXT_STEP/);
  assert.match(component, /Worker Tick 관찰자/);
  assert.match(component, /RUNTIME FINISHED · LESSON NOT CLEARED/);
  assert.match(component, /pendingReview/);
  assert.match(component, /viewCursor !== availableCursor/);
  assert.match(component, /과거 Trace 관찰 중/);
  assert.match(component, /기록된 Worker tick 관찰/);
  assert.match(component, /canonical Trace의 다음 tick 구간만 재생합니다/);
});
