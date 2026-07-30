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

async function readFixture(fileName) {
  return JSON.parse(
    await readFile(
      path.join(repositoryRoot, "contracts", "fixtures", fileName),
      "utf8",
    ),
  );
}

const learningGame = await importTypeScriptModule(
  "worlds/verdant-signal-garden/web/verdantLearningGame.ts",
);
const projectionModule = await importTypeScriptModule(
  "web/projection/verdantSignalProjection.ts",
);

const fixtures = {
  "signal-at-29s": await readFixture(
    "verdant-signal-at-29s.trace.json",
  ),
  "timeout-then-late-signal": await readFixture(
    "verdant-timeout-then-late-signal.trace.json",
  ),
  "both-at-deadline": await readFixture(
    "verdant-both-at-deadline.trace.json",
  ),
};

test("Verdant curriculum is sequential and exposes controls, not command macros", () => {
  const challenges = learningGame.VERDANT_LEARNING_CHALLENGES;

  assert.deepEqual(
    challenges.map((challenge) => challenge.id),
    [
      "signal-at-29s",
      "timeout-then-late-signal",
      "both-at-deadline",
    ],
  );
  assert.deepEqual(
    challenges.map((challenge) => challenge.unlockRequirement),
    [null, "signal-at-29s", "timeout-then-late-signal"],
  );

  for (const challenge of challenges) {
    assert.equal(Object.hasOwn(challenge, "commands"), false);
    assert.ok(challenge.availableActionIds.length >= 2);
    assert.ok(challenge.evidenceQuestion.options.length >= 2);
    assert.ok(
      challenge.evidenceQuestion.options.some(
        (option) =>
          option.id === challenge.evidenceQuestion.correctAnswerId,
      ),
    );
  }

  const correctAnswerPositions = challenges.map((challenge) =>
    challenge.evidenceQuestion.options.findIndex(
      (option) =>
        option.id === challenge.evidenceQuestion.correctAnswerId,
    ),
  );
  assert.ok(
    new Set(correctAnswerPositions).size > 1,
    "the correct answer must not occupy one predictable button position",
  );
});

test("each player control creates exactly one runtime command", () => {
  assert.deepEqual(
    learningGame.createVerdantCommand("ADVANCE_29_SECONDS"),
    { kind: "ADVANCE_TIME", payload: { millis: 29_000 } },
  );
  assert.deepEqual(
    learningGame.createVerdantCommand("ADVANCE_30_SECONDS"),
    { kind: "ADVANCE_TIME", payload: { millis: 30_000 } },
  );
  assert.deepEqual(
    learningGame.createVerdantCommand("SEND_YARD_SIGNAL"),
    {
      kind: "SEND_SIGNAL",
      payload: { name: "yard-assignment" },
    },
  );
  assert.deepEqual(learningGame.createVerdantCommand("WORKER_TICK"), {
    kind: "TICK",
    payload: {},
  });
});

for (const [challengeId, fixture] of Object.entries(fixtures)) {
  test(`${challengeId} passes only from its canonical runtime trace facts`, () => {
    const projection = projectionModule.projectVerdantSignal(
      fixture.events,
    );
    const evaluation = learningGame.evaluateVerdantChallenge(
      challengeId,
      projection,
      fixture.events,
    );

    assert.equal(projection.phase, "FINISHED");
    assert.equal(evaluation.status, "PASSED");
    assert.equal(evaluation.terminal, true);
    assert.ok(evaluation.checks.every((check) => check.passed));

    const question =
      learningGame.getVerdantLearningChallenge(
        challengeId,
      ).evidenceQuestion;
    for (const eventKind of question.requiredEventKinds) {
      assert.ok(
        fixture.events.some((event) => event.kind === eventKind),
        `${challengeId} should record ${eventKind}`,
      );
    }
  });
}

test("an unfinished trace stays in progress instead of inventing an outcome", () => {
  const fixture = fixtures["both-at-deadline"];
  const events = fixture.events.filter(
    (event) => event.sequence <= 17,
  );
  const projection = projectionModule.projectVerdantSignal(events);
  const evaluation = learningGame.evaluateVerdantChallenge(
    "both-at-deadline",
    projection,
    events,
  );

  assert.equal(projection.phase, "RUNNING");
  assert.equal(evaluation.status, "IN_PROGRESS");
  assert.equal(evaluation.terminal, false);
});

test("a real but different runtime outcome fails the selected objective", () => {
  const fixture = fixtures["both-at-deadline"];
  const projection = projectionModule.projectVerdantSignal(
    fixture.events,
  );
  const evaluation = learningGame.evaluateVerdantChallenge(
    "signal-at-29s",
    projection,
    fixture.events,
  );

  assert.equal(evaluation.status, "FAILED");
  assert.equal(evaluation.terminal, true);
  assert.ok(evaluation.checks.some((check) => !check.passed));
});

function rewriteMissionTime(fixture, fromMillis, toMillis) {
  return {
    ...fixture,
    events: fixture.events.map((event) => ({
      ...event,
      logicalTimeMillis:
        event.logicalTimeMillis === fromMillis
          ? toMillis
          : event.logicalTimeMillis,
      payload: Object.fromEntries(
        Object.entries(event.payload).map(([key, value]) => [
          key,
          value === fromMillis ? toMillis : value,
        ]),
      ),
    })),
  };
}

test("signal-at-29s fails when the same outcome is produced at zero seconds", () => {
  const altered = rewriteMissionTime(
    fixtures["signal-at-29s"],
    29_000,
    0,
  );
  const projection = projectionModule.projectVerdantSignal(
    altered.events,
  );
  const evaluation = learningGame.evaluateVerdantChallenge(
    "signal-at-29s",
    projection,
    altered.events,
  );

  assert.equal(projection.phase, "FINISHED");
  assert.equal(evaluation.status, "FAILED");
  assert.equal(
    evaluation.checks.find(
      (check) => check.id === "decision-at-29-seconds",
    )?.passed,
    false,
  );
});

for (const challengeId of [
  "timeout-then-late-signal",
  "both-at-deadline",
]) {
  test(`${challengeId} fails when the deadline decision happens at 60 seconds`, () => {
    const altered = rewriteMissionTime(
      fixtures[challengeId],
      30_000,
      60_000,
    );
    const projection = projectionModule.projectVerdantSignal(
      altered.events,
    );
    const evaluation = learningGame.evaluateVerdantChallenge(
      challengeId,
      projection,
      altered.events,
    );

    assert.equal(projection.phase, "FINISHED");
    assert.equal(evaluation.status, "FAILED");
    assert.ok(evaluation.checks.some((check) => !check.passed));
  });
}

test("FLOW_FINISHED does not clear a lesson without the correct evidence answer", () => {
  const fixture = fixtures["signal-at-29s"];
  const projection = projectionModule.projectVerdantSignal(
    fixture.events,
  );
  const evaluation = learningGame.evaluateVerdantChallenge(
    "signal-at-29s",
    projection,
    fixture.events,
  );

  assert.equal(evaluation.status, "PASSED");
  assert.equal(
    learningGame.isVerdantChallengeCleared(evaluation, null),
    false,
  );
  assert.equal(
    learningGame.isVerdantChallengeCleared(
      evaluation,
      "signal-directly-routes",
    ),
    false,
  );
  assert.equal(
    learningGame.isVerdantChallengeCleared(
      evaluation,
      "worker-tick-evaluates",
    ),
    true,
  );
  assert.equal(
    learningGame.gradeVerdantEvidenceAnswer(
      "signal-at-29s",
      "worker-tick-evaluates",
    ).correct,
    true,
  );

  const question = learningGame.getVerdantLearningChallenge(
    "signal-at-29s",
  ).evidenceQuestion;
  const wrongGrade = learningGame.gradeVerdantEvidenceAnswer(
    "signal-at-29s",
    "signal-directly-routes",
  );
  assert.equal(wrongGrade.correct, false);
  assert.equal(wrongGrade.explanation, question.retryHint);
  assert.notEqual(wrongGrade.explanation, question.explanation);
});

test("stored Verdant progress is unique, known, and curriculum ordered", () => {
  assert.deepEqual(
    learningGame.normalizeVerdantCompletedIds([
      "both-at-deadline",
      "signal-at-29s",
      "signal-at-29s",
      "unknown-level",
      null,
      "timeout-then-late-signal",
    ]),
    [
      "signal-at-29s",
      "timeout-then-late-signal",
      "both-at-deadline",
    ],
  );
  assert.deepEqual(learningGame.normalizeVerdantCompletedIds("broken"), []);
});
