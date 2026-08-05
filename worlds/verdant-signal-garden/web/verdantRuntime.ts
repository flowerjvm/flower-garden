import {
  VERDANT_MISSION_ID,
  VERDANT_WORLD_ID,
  type VerdantEvidence,
  type VerdantFlowReference,
  type VerdantOutcome,
  type VerdantRunSnapshot,
  type VerdantRuntimeAdapter,
  type VerdantScenarioId,
  type VerdantTraceEvent,
} from "./types";

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:8080";
const CREATE_RUN_PATH = "/api/v1/worlds/verdant-signal-garden/runs";
const REQUEST_TIMEOUT_MILLIS = 5_000;
const EVENT_KIND_PATTERN = /^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$/;
const EVENT_SOURCES = new Set([
  "RUN_COORDINATOR",
  "FLOWER_LISTENER",
  "FLOWER_EVENT_BUS",
  "FLOWER_STEP",
]);
const FLOW_STATES = new Set([
  "CREATED",
  "READY",
  "RUNNING",
  "FINISHED",
  "FAILED",
  "CANCELLED",
  "CHECKPOINT_FAILED",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, path);
}

function requireInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be an integer >= ${minimum}.`);
  }
  return value as number;
}

function normalizeEvidence(value: unknown, path: string): VerdantEvidence {
  const evidence = requireRecord(value, path);
  const type = requireString(evidence.type, `${path}.type`);
  if (type !== "CONTRACT" && type !== "SOURCE" && type !== "TEST") {
    throw new Error(`${path}.type is not supported.`);
  }
  return {
    type,
    ref: requireString(evidence.ref, `${path}.ref`),
    label: requireString(evidence.label, `${path}.label`),
  };
}

function normalizeFlow(
  value: unknown,
  path: string,
): VerdantFlowReference | null {
  if (value === null) return null;
  const flow = requireRecord(value, path);
  const state = requireString(flow.state, `${path}.state`);
  if (!FLOW_STATES.has(state)) {
    throw new Error(`${path}.state is not supported.`);
  }
  const stepId =
    flow.stepId === null
      ? null
      : requireString(flow.stepId, `${path}.stepId`);

  return {
    type: requireString(flow.type, `${path}.type`),
    key: requireString(flow.key, `${path}.key`),
    state: state as VerdantFlowReference["state"],
    stepId,
    stepNo: requireInteger(flow.stepNo, `${path}.stepNo`),
  };
}

function normalizeEvent(
  value: unknown,
  index: number,
  expectedRunId: string,
): VerdantTraceEvent {
  const path = `response.events[${index}]`;
  const event = requireRecord(value, path);
  if (event.schemaVersion !== "1.0.0") {
    throw new Error(`${path}.schemaVersion must be 1.0.0.`);
  }
  const runId = requireString(event.runId, `${path}.runId`);
  if (runId !== expectedRunId) {
    throw new Error(`${path}.runId does not match this run.`);
  }
  const sequence = requireInteger(event.sequence, `${path}.sequence`, 1);
  if (sequence !== index + 1) {
    throw new Error(
      `${path}.sequence must be contiguous; expected ${index + 1}.`,
    );
  }
  const source = requireString(event.source, `${path}.source`);
  if (!EVENT_SOURCES.has(source)) {
    throw new Error(`${path}.source is not supported.`);
  }
  const kind = requireString(event.kind, `${path}.kind`);
  if (!EVENT_KIND_PATTERN.test(kind)) {
    throw new Error(`${path}.kind is not canonical.`);
  }
  const payload = requireRecord(event.payload, `${path}.payload`);
  if (!Array.isArray(event.evidence)) {
    throw new Error(`${path}.evidence must be an array.`);
  }

  return {
    schemaVersion: "1.0.0",
    eventId: requireString(event.eventId, `${path}.eventId`),
    runId,
    sequence,
    logicalTimeMillis: requireInteger(
      event.logicalTimeMillis,
      `${path}.logicalTimeMillis`,
    ),
    source: source as VerdantTraceEvent["source"],
    kind,
    flow: normalizeFlow(event.flow, `${path}.flow`),
    payload,
    evidence: event.evidence.map((item, evidenceIndex) =>
      normalizeEvidence(item, `${path}.evidence[${evidenceIndex}]`),
    ),
  };
}

function normalizeOutcome(value: unknown): VerdantOutcome | null {
  if (value === null || value === undefined) return null;
  const outcome = requireRecord(value, "response.outcome");
  const finalState = optionalString(
    outcome.finalState,
    "response.outcome.finalState",
  );
  if (
    finalState !== undefined &&
    finalState !== "SIGNALED" &&
    finalState !== "TIMED_OUT"
  ) {
    throw new Error("response.outcome.finalState is not supported.");
  }

  return {
    schemaVersion:
      outcome.schemaVersion === undefined
        ? undefined
        : outcome.schemaVersion === "1.0.0"
          ? "1.0.0"
          : (() => {
              throw new Error(
                "response.outcome.schemaVersion must be 1.0.0.",
              );
            })(),
    status: optionalString(outcome.status, "response.outcome.status"),
    finalState,
    workerTicks:
      outcome.workerTicks === undefined
        ? undefined
        : requireInteger(
            outcome.workerTicks,
            "response.outcome.workerTicks",
          ),
    summary: optionalString(outcome.summary, "response.outcome.summary"),
  };
}

export function normalizeVerdantRun(value: unknown): VerdantRunSnapshot {
  const response = requireRecord(value, "response");
  if (response.schemaVersion !== "1.0.0") {
    throw new Error("response.schemaVersion must be 1.0.0.");
  }
  const runId = requireString(response.runId, "response.runId");
  if (response.worldId !== VERDANT_WORLD_ID) {
    throw new Error(`response.worldId must be ${VERDANT_WORLD_ID}.`);
  }
  if (response.missionId !== VERDANT_MISSION_ID) {
    throw new Error(`response.missionId must be ${VERDANT_MISSION_ID}.`);
  }
  if (!Array.isArray(response.events)) {
    throw new Error("response.events must be an array.");
  }
  if (!Array.isArray(response.evidence)) {
    throw new Error("response.evidence must be an array.");
  }
  const events = response.events.map((event, index) =>
    normalizeEvent(event, index, runId),
  );
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("response.events contains duplicate event ids.");
  }

  return {
    schemaVersion: "1.0.0",
    runId,
    worldId: VERDANT_WORLD_ID,
    missionId: VERDANT_MISSION_ID,
    flowerRuntimeVersion: requireString(
      response.flowerRuntimeVersion,
      "response.flowerRuntimeVersion",
    ),
    phase: requireString(response.phase, "response.phase"),
    currentStepId:
      response.currentStepId === null
        ? null
        : requireString(response.currentStepId, "response.currentStepId"),
    events,
    evidence: response.evidence.map((item, index) =>
      normalizeEvidence(item, `response.evidence[${index}]`),
    ),
    outcome: normalizeOutcome(response.outcome),
  };
}

/**
 * Converts a checked-in trace bundle into the same immutable snapshot shape
 * used by the live adapter. Phase and current Step come from the final recorded
 * Flow reference; no workflow decision is recomputed in the browser.
 */
export function normalizeVerdantTraceBundle(
  value: unknown,
  expectedScenarioId: VerdantScenarioId,
): VerdantRunSnapshot {
  const bundle = requireRecord(value, "traceBundle");
  if (bundle.schemaVersion !== "1.0.0") {
    throw new Error("traceBundle.schemaVersion must be 1.0.0.");
  }
  if (!Array.isArray(bundle.events) || bundle.events.length === 0) {
    throw new Error("traceBundle.events must be a non-empty array.");
  }
  if (bundle.scenarioId !== expectedScenarioId) {
    throw new Error(
      `traceBundle.scenarioId must be ${expectedScenarioId}.`,
    );
  }
  if (bundle.flowerVersion !== "0.1.2") {
    throw new Error("traceBundle.flowerVersion must be 0.1.2.");
  }
  if (bundle.flowDefinitionVersion !== "verdant-signal-v1") {
    throw new Error(
      "traceBundle.flowDefinitionVersion must be verdant-signal-v1.",
    );
  }
  if (bundle.projectionVersion !== "verdant-signal-projection-v1") {
    throw new Error(
      "traceBundle.projectionVersion must be verdant-signal-projection-v1.",
    );
  }
  const finalEvent = requireRecord(
    bundle.events.at(-1),
    "traceBundle.events[last]",
  );
  const finalFlow =
    finalEvent.flow === null
      ? null
      : requireRecord(finalEvent.flow, "traceBundle.events[last].flow");
  const expectedOutcome = requireRecord(
    bundle.expectedOutcome,
    "traceBundle.expectedOutcome",
  );
  const finalSequence = requireInteger(
    expectedOutcome.finalSequence,
    "traceBundle.expectedOutcome.finalSequence",
    1,
  );
  const lastEventSequence = requireInteger(
    finalEvent.sequence,
    "traceBundle.events[last].sequence",
    1,
  );
  if (finalSequence !== lastEventSequence) {
    throw new Error(
      "traceBundle.expectedOutcome.finalSequence does not match the trace.",
    );
  }

  const decisionEvent = [...bundle.events]
    .reverse()
    .map((event) => requireRecord(event, "traceBundle.events[]"))
    .find((event) => event.kind === "VERDANT.WAIT_DECIDED");
  const routeEvent = [...bundle.events]
    .reverse()
    .map((event) => requireRecord(event, "traceBundle.events[]"))
    .find((event) => event.kind === "VERDANT.ROUTE_COMMITTED");
  if (!decisionEvent || !routeEvent) {
    throw new Error(
      "traceBundle must contain WAIT_DECIDED and ROUTE_COMMITTED.",
    );
  }
  const decisionPayload = requireRecord(
    decisionEvent.payload,
    "traceBundle.WAIT_DECIDED.payload",
  );
  const routePayload = requireRecord(
    routeEvent.payload,
    "traceBundle.ROUTE_COMMITTED.payload",
  );
  const outcomeWinner = requireString(
    expectedOutcome.winner,
    "traceBundle.expectedOutcome.winner",
  );
  const decisionWinner = requireString(
    decisionPayload.winner,
    "traceBundle.WAIT_DECIDED.payload.winner",
  );
  if (
    (outcomeWinner !== "SIGNAL" && outcomeWinner !== "TIMEOUT") ||
    decisionWinner !== outcomeWinner ||
    routePayload.winner !== outcomeWinner
  ) {
    throw new Error(
      "traceBundle winner fields do not agree with WAIT_DECIDED.",
    );
  }
  const finalState = requireString(
    expectedOutcome.finalState,
    "traceBundle.expectedOutcome.finalState",
  );
  if (
    (finalState !== "SIGNALED" && finalState !== "TIMED_OUT") ||
    routePayload.resultingState !== finalState
  ) {
    throw new Error(
      "traceBundle finalState does not match ROUTE_COMMITTED.",
    );
  }
  if (decisionPayload.selectedPath !== routePayload.selectedPath) {
    throw new Error(
      "traceBundle selectedPath changed between decision and commit.",
    );
  }
  const accumulatedEvidence: unknown[] = [];
  const seenEvidenceRefs = new Set<string>();
  const addEvidence = (rawEvidence: unknown, path: string) => {
    const evidence = requireRecord(rawEvidence, path);
    const ref = requireString(evidence.ref, `${path}.ref`);
    if (!seenEvidenceRefs.has(ref)) {
      seenEvidenceRefs.add(ref);
      accumulatedEvidence.push(evidence);
    }
  };
  if (bundle.evidence !== undefined) {
    if (!Array.isArray(bundle.evidence)) {
      throw new Error("traceBundle.evidence must be an array.");
    }
    bundle.evidence.forEach((rawEvidence, index) =>
      addEvidence(rawEvidence, `traceBundle.evidence[${index}]`),
    );
  }
  for (const rawEvent of bundle.events) {
    const event = requireRecord(rawEvent, "traceBundle.events[]");
    if (!Array.isArray(event.evidence)) continue;
    event.evidence.forEach((rawEvidence, index) =>
      addEvidence(
        rawEvidence,
        `traceBundle.events[].evidence[${index}]`,
      ),
    );
  }

  return normalizeVerdantRun({
    schemaVersion: "1.0.0",
    runId: bundle.runId,
    worldId: bundle.worldId,
    missionId: bundle.missionId,
    flowerRuntimeVersion: bundle.flowerVersion,
    phase: finalFlow?.state ?? "READY",
    currentStepId: finalFlow?.stepId ?? null,
    events: bundle.events,
    evidence: accumulatedEvidence,
    outcome: {
      schemaVersion: "1.0.0",
      status: expectedOutcome.status,
      finalState: expectedOutcome.finalState,
      workerTicks: expectedOutcome.workerTicks,
      summary: expectedOutcome.summary,
    },
  });
}

function runtimeBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_FLOWER_RUNTIME_URL?.trim();
  return (configured || DEFAULT_RUNTIME_URL).replace(/\/+$/, "");
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MILLIS,
  );

  try {
    const response = await fetch(`${runtimeBaseUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Flower Runtime responded with HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function commandId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("This browser cannot create an idempotent command id.");
  }
  return globalThis.crypto.randomUUID();
}

export const defaultVerdantRuntimeAdapter: VerdantRuntimeAdapter = {
  async createRun() {
    return normalizeVerdantRun(await postJson(CREATE_RUN_PATH, {}));
  },

  async sendCommand(runId, expectedSequence, command) {
    return normalizeVerdantRun(
      await postJson(`/api/v1/runs/${encodeURIComponent(runId)}/commands`, {
        schemaVersion: "1.0.0",
        commandId: commandId(),
        runId,
        expectedSequence,
        kind: command.kind,
        payload: command.payload,
      }),
    );
  },
};
