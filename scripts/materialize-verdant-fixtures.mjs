import { mkdir, readFile, writeFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const generatedRoot = new URL(
  "../runtime/target/generated-fixtures/",
  import.meta.url,
);
const fixtureRoot = new URL("../contracts/fixtures/", import.meta.url);
const checkOnly = process.argv.includes("--check");

const scenarios = [
  {
    source: "verdant-signal-first.run-view.json",
    output: "verdant-signal-at-29s.trace.json",
    scenarioId: "signal-at-29s",
  },
  {
    source: "verdant-timeout-first.run-view.json",
    output: "verdant-timeout-then-late-signal.trace.json",
    scenarioId: "timeout-then-late-signal",
  },
  {
    source: "verdant-same-tick.run-view.json",
    output: "verdant-both-at-deadline.trace.json",
    scenarioId: "both-at-deadline",
  },
];

function assertCanonicalRun(run, source) {
  if (
    run.schemaVersion !== "1.0.0" ||
    run.worldId !== "verdant-signal-garden" ||
    run.missionId !== "signal-vs-timeout" ||
    run.flowerRuntimeVersion !== "0.1.1" ||
    run.phase !== "FINISHED" ||
    !Array.isArray(run.events) ||
    run.events.length === 0 ||
    !Array.isArray(run.evidence) ||
    !run.outcome
  ) {
    throw new Error(`${source} is not a completed canonical Verdant RunView.`);
  }

  run.events.forEach((event, index) => {
    if (event.runId !== run.runId || event.sequence !== index + 1) {
      throw new Error(`${source} has a non-contiguous or foreign trace event.`);
    }
  });
}

function canonicalizeObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeObjectKeys(value[key])]),
    );
  }
  return value;
}

await mkdir(fixtureRoot, { recursive: true });

for (const scenario of scenarios) {
  const run = JSON.parse(
    await readFile(new URL(scenario.source, generatedRoot), "utf8"),
  );
  assertCanonicalRun(run, scenario.source);

  const decision = [...run.events]
    .reverse()
    .find((event) => event.kind === "VERDANT.WAIT_DECIDED");
  const winner = decision?.payload?.winner;
  if (winner !== "SIGNAL" && winner !== "TIMEOUT") {
    throw new Error(`${scenario.source} has no supported decisive winner.`);
  }

  const bundle = {
    $schema: "../trace-bundle.schema.json",
    schemaVersion: "1.0.0",
    runId: run.runId,
    worldId: run.worldId,
    missionId: run.missionId,
    scenarioId: scenario.scenarioId,
    flowerVersion: run.flowerRuntimeVersion,
    flowDefinitionVersion: "verdant-signal-v1",
    projectionVersion: "verdant-signal-projection-v1",
    events: run.events.map((event) => ({
      ...event,
      payload: canonicalizeObjectKeys(event.payload),
    })),
    evidence: run.evidence,
    expectedOutcome: {
      finalSequence: run.events.at(-1).sequence,
      status: run.outcome.status,
      finalState: run.outcome.finalState,
      workerTicks: run.outcome.workerTicks,
      winner,
    },
  };

  const outputUrl = new URL(scenario.output, fixtureRoot);
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (checkOnly) {
    const checkedIn = await readFile(outputUrl, "utf8");
    if (checkedIn !== serialized) {
      throw new Error(
        `${scenario.output} differs from the actual generated Flower run.`,
      );
    }
  } else {
    await writeFile(outputUrl, serialized, "utf8");
  }
}

console.log(
  checkOnly
    ? `Verified ${scenarios.length} checked-in Verdant trace bundles against actual Flower runs.`
    : `Materialized ${scenarios.length} Verdant trace bundles under ${projectRoot.pathname}contracts/fixtures.`,
);
