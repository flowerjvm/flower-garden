import type {
  EvidenceItem,
  NormalizedRun,
  TickCommand,
  TraceEvent,
} from "./types";

const DEFAULT_RUNTIME_URL = "http://localhost:8080";
const FIRST_BLOOM_PATH = "/api/v1/worlds/first-bloom-meadow/runs";
const REQUEST_TIMEOUT_MS = 4_000;
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

function requireInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be an integer >= ${minimum}.`);
  }
  return value as number;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function runtimeBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_FLOWER_RUNTIME_URL?.trim();
  return (configured || DEFAULT_RUNTIME_URL).replace(/\/+$/, "");
}

function apiUrl(path: string): string {
  return `${runtimeBaseUrl()}${path}`;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(apiUrl(path), {
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
    window.clearTimeout(timeout);
  }
}

function normalizeEvidence(
  value: unknown,
  path: string,
  index: number,
): EvidenceItem {
  const item = requireRecord(value, path);
  const rawKind = requireString(item.kind ?? item.type, `${path}.type`);
  if (
    rawKind !== "CONTRACT" &&
    rawKind !== "SOURCE" &&
    rawKind !== "TEST"
  ) {
    throw new Error(`${path}.type has an unsupported value.`);
  }
  const reference = requireString(item.id ?? item.ref, `${path}.ref`);
  const label = requireString(item.label ?? item.title, `${path}.label`);

  return {
    id: `${reference}:${index}`,
    label,
    kind: rawKind,
    description: optionalString(item.description),
    path: optionalString(item.path ?? item.sourcePath ?? item.ref),
    url: optionalString(item.url),
    symbol: optionalString(item.symbol),
  };
}

function eventSummary(type: string, stepId: string | undefined): string {
  switch (type) {
    case "GARDEN.RUN_CREATED":
      return "실제 Engine과 수동 Worker가 준비되었습니다.";
    case "GARDEN.FLOW_READY":
      return "Flow가 READY 상태로 Worker 대기열에 들어갔습니다.";
    case "GARDEN.TICK_REQUESTED":
      return "Worker.tickOnce()를 한 번 요청했습니다.";
    case "GARDEN.TICK_COMPLETED":
      return "이번 Worker tick의 실제 실행이 끝났습니다.";
    case "FLOWER.FLOW_SUBMITTED":
      return "Flower가 Flow 제출을 관찰했습니다.";
    case "FLOWER.STEP_ENTERED":
      return `${stepId ?? "Step"}에 진입했습니다.`;
    case "FLOWER.STEP_RESULT":
      return `${stepId ?? "Step"}이 실제 StepResult를 반환했습니다.`;
    case "FLOWER.STEP_EXITED":
      return `${stepId ?? "Step"}을 완료하고 나왔습니다.`;
    case "FLOWER.FLOW_FINISHED":
      return "Flower가 Flow를 FINISHED로 확정했습니다.";
    case "FLOWER.FLOW_FAILED":
      return "Flower가 Flow 실패를 기록했습니다.";
    case "FLOWER.FLOW_CANCELLED":
      return "Flower가 Flow 취소를 기록했습니다.";
    default:
      return type.replaceAll(".", " · ").replaceAll("_", " ").toLowerCase();
  }
}

function normalizeEvent(
  value: unknown,
  index: number,
  expectedRunId: string,
): TraceEvent {
  const path = `events[${index}]`;
  const event = requireRecord(value, path);
  if (event.schemaVersion !== "1.0.0") {
    throw new Error(`${path}.schemaVersion must be 1.0.0.`);
  }
  const eventId = requireString(event.eventId, `${path}.eventId`);
  const runId = requireString(event.runId, `${path}.runId`);
  if (runId !== expectedRunId) {
    throw new Error(`${path}.runId does not match the run.`);
  }
  const sequence = requireInteger(event.sequence, `${path}.sequence`, 1);
  if (sequence !== index + 1) {
    throw new Error(
      `${path}.sequence must be contiguous; expected ${index + 1}.`,
    );
  }
  const logicalTimeMillis = requireInteger(
    event.logicalTimeMillis,
    `${path}.logicalTimeMillis`,
  );
  const source = requireString(event.source, `${path}.source`);
  if (!EVENT_SOURCES.has(source)) {
    throw new Error(`${path}.source has an unsupported value.`);
  }
  const type = requireString(event.kind, `${path}.kind`);
  if (!/^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$/.test(type)) {
    throw new Error(`${path}.kind is not a canonical event kind.`);
  }
  const payload = requireRecord(event.payload, `${path}.payload`);
  if (!Array.isArray(event.evidence)) {
    throw new Error(`${path}.evidence must be an array.`);
  }

  let flowId: string | undefined;
  let stepId: string | undefined;
  if (event.flow !== null) {
    const flow = requireRecord(event.flow, `${path}.flow`);
    requireString(flow.type, `${path}.flow.type`);
    flowId = requireString(flow.key, `${path}.flow.key`);
    const flowState = requireString(flow.state, `${path}.flow.state`);
    if (!FLOW_STATES.has(flowState)) {
      throw new Error(`${path}.flow.state has an unsupported value.`);
    }
    requireInteger(flow.stepNo, `${path}.flow.stepNo`);
    if (flow.stepId !== null) {
      stepId = requireString(flow.stepId, `${path}.flow.stepId`);
    }
  }

  return {
    schemaVersion: "1.0.0",
    eventId,
    runId,
    sequence,
    logicalTimeMillis,
    type,
    source,
    flowId,
    stepId,
    summary: eventSummary(type, stepId),
    payload,
    evidence: event.evidence.map((item, evidenceIndex) =>
      normalizeEvidence(item, `${path}.evidence[${evidenceIndex}]`, evidenceIndex),
    ),
  };
}

function normalizeRunEvidence(value: unknown): EvidenceItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("evidence must be an array.");
  }
  return value.map((item, index) =>
    normalizeEvidence(item, `evidence[${index}]`, index),
  );
}

export function normalizeRunResponse(value: unknown): NormalizedRun {
  const response = requireRecord(value, "response");
  if (response.schemaVersion !== "1.0.0") {
    throw new Error("response.schemaVersion must be 1.0.0.");
  }
  const runId = requireString(response.runId, "response.runId");
  const worldId = requireString(response.worldId, "response.worldId");
  const missionId = requireString(response.missionId, "response.missionId");
  const runtimeVersion = requireString(
    response.flowerRuntimeVersion ?? response.flowerVersion,
    "response.flowerRuntimeVersion",
  );
  if (!Array.isArray(response.events)) {
    throw new Error("response.events must be an array.");
  }
  const events = response.events.map((event, index) =>
    normalizeEvent(event, index, runId),
  );
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("response.events contains duplicate eventId values.");
  }

  const rawOutcome =
    response.outcome === null || response.outcome === undefined
      ? response.expectedOutcome
      : response.outcome;
  const outcome = rawOutcome === undefined ? undefined : requireRecord(rawOutcome, "outcome");

  return {
    runId,
    worldId,
    missionId,
    runtimeVersion,
    events,
    evidence: normalizeRunEvidence(response.evidence),
    outcome: outcome
      ? {
          winner: optionalString(outcome.winner),
          finalState: optionalString(outcome.finalState ?? outcome.status),
          predictionCorrect:
            typeof outcome.predictionCorrect === "boolean"
              ? outcome.predictionCorrect
              : undefined,
          explanation: optionalString(outcome.explanation ?? outcome.summary),
        }
      : undefined,
    raw: value,
  };
}

export async function createFirstBloomRun(): Promise<NormalizedRun> {
  const response = await postJson(FIRST_BLOOM_PATH, {
    worldId: "first-bloom-meadow",
    missionId: "the-first-flow",
  });
  return normalizeRunResponse(response);
}

export async function tickFirstBloomRun(
  runId: string,
  expectedSequence: number,
): Promise<NormalizedRun> {
  const command: TickCommand = {
    schemaVersion: "1.0.0",
    commandId: crypto.randomUUID(),
    runId,
    expectedSequence,
    kind: "TICK",
    payload: {},
  };
  const response = await postJson(
    `/api/v1/runs/${encodeURIComponent(runId)}/commands`,
    command,
  );
  return normalizeRunResponse(response);
}
