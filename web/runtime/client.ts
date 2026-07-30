import type {
  BloomEventCommand,
  EvidenceItem,
  FirstBloomBlueprint,
  FirstBloomGardenState,
  FirstBloomRunOutcome,
  NormalizedRun,
  TickCommand,
  TraceEvent,
} from "./types";

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:8080";
const FIRST_BLOOM_PATH = "/api/v1/worlds/first-bloom-meadow/runs";
const FIRST_BLOOM_WORLD_ID = "first-bloom-meadow";
const FIRST_BLOOM_MISSION_ID = "the-first-flow";
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
const FIRST_BLOOM_GARDEN_STATES = new Set<FirstBloomGardenState>([
  "EMPTY",
  "SOIL_READY",
  "SUNLIGHT_READY",
  "STEM_GROWN",
  "BLOOMED",
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

function requireExactKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new Error(
      `${path} must contain exactly ${sortedExpectedKeys.join(", ")}.`,
    );
  }
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
      let detail = "";
      try {
        const errorBody = requireRecord(
          await response.json(),
          "runtime error",
        );
        detail = optionalString(errorBody.message) ?? "";
      } catch {
        // Keep the stable HTTP fallback when the gateway did not return JSON.
      }
      throw new Error(
        detail ||
          `Flower Runtime responded with HTTP ${response.status}.`,
      );
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
    case "GARDEN.BLUEPRINT_ACCEPTED":
      return "조립한 Flow가 실제 Flower Runtime에 만들어졌습니다.";
    case "GARDEN.TICK_REQUESTED":
      return "Worker.tickOnce()를 한 번 요청했습니다.";
    case "GARDEN.TICK_COMPLETED":
      return "이번 Worker tick의 실제 실행이 끝났습니다.";
    case "GARDEN.BLOOM_EVENT_PUBLISHED":
      return "플레이어가 실제 Bloom 이벤트를 발행했습니다.";
    case "FIRST_BLOOM.SUNLIGHT_WAITING":
      return "이 Step은 햇빛 Bloom 이벤트를 기다리고 있습니다.";
    case "FIRST_BLOOM.SUNLIGHT_ACCEPTED":
      return "Flower Step이 Bloom 이벤트 뒤 저장된 햇빛 상태를 확인했습니다.";
    case "GARDEN.PLOT_UPDATED":
      return "실제 Step 실행 결과로 정원 상태가 바뀌었습니다.";
    case "GARDEN.MISSION_BLOCKED":
      return `${stepId ?? "Step"}의 선행 조건이 없어 Flow가 멈췄습니다.`;
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

function normalizeFirstBloomOutcome(
  value: unknown,
): FirstBloomRunOutcome | undefined {
  if (value === null || value === undefined) return undefined;

  const outcome = requireRecord(value, "response.outcome");
  requireExactKeys(
    outcome,
    [
      "schemaVersion",
      "status",
      "finalState",
      "workerTicks",
      "summary",
    ],
    "response.outcome",
  );
  if (outcome.schemaVersion !== "1.0.0") {
    throw new Error("response.outcome.schemaVersion must be 1.0.0.");
  }

  const status = requireString(
    outcome.status,
    "response.outcome.status",
  );
  if (status !== "PASSED" && status !== "FAILED") {
    throw new Error(
      "response.outcome.status must be PASSED or FAILED.",
    );
  }

  const finalState = requireString(
    outcome.finalState,
    "response.outcome.finalState",
  );
  if (
    !FIRST_BLOOM_GARDEN_STATES.has(
      finalState as FirstBloomGardenState,
    )
  ) {
    throw new Error(
      "response.outcome.finalState is not a First Bloom garden state.",
    );
  }

  return {
    schemaVersion: "1.0.0",
    status,
    finalState: finalState as FirstBloomGardenState,
    workerTicks: requireInteger(
      outcome.workerTicks,
      "response.outcome.workerTicks",
    ),
    summary: requireString(
      outcome.summary,
      "response.outcome.summary",
    ),
  };
}

export function normalizeRunResponse(value: unknown): NormalizedRun {
  const response = requireRecord(value, "response");
  if (response.schemaVersion !== "1.0.0") {
    throw new Error("response.schemaVersion must be 1.0.0.");
  }
  const runId = requireString(response.runId, "response.runId");
  if (response.worldId !== FIRST_BLOOM_WORLD_ID) {
    throw new Error(
      `response.worldId must be ${FIRST_BLOOM_WORLD_ID}.`,
    );
  }
  if (response.missionId !== FIRST_BLOOM_MISSION_ID) {
    throw new Error(
      `response.missionId must be ${FIRST_BLOOM_MISSION_ID}.`,
    );
  }
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

  return {
    runId,
    worldId: FIRST_BLOOM_WORLD_ID,
    missionId: FIRST_BLOOM_MISSION_ID,
    runtimeVersion,
    events,
    evidence: normalizeRunEvidence(response.evidence),
    outcome: normalizeFirstBloomOutcome(response.outcome),
    raw: value,
  };
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]))
    );
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          sameJsonValue(left[key], right[key]),
      )
    );
  }
  return false;
}

function rawTraceEvents(
  run: NormalizedRun,
  path: string,
): readonly unknown[] {
  const raw = requireRecord(run.raw, `${path}.raw`);
  if (!Array.isArray(raw.events)) {
    throw new Error(`${path}.raw.events must be an array.`);
  }
  if (raw.events.length !== run.events.length) {
    throw new Error(
      `${path}.raw.events no longer matches its normalized trace.`,
    );
  }
  return raw.events;
}

/**
 * Accepts one cumulative First Bloom response only when it extends the exact
 * JSON-value prefix already shown to the player.
 */
export function acceptFirstBloomCumulativeRun(
  previous: NormalizedRun | null | undefined,
  incoming: NormalizedRun,
): NormalizedRun {
  if (
    incoming.worldId !== FIRST_BLOOM_WORLD_ID ||
    incoming.missionId !== FIRST_BLOOM_MISSION_ID
  ) {
    throw new Error(
      "Incoming response does not belong to First Bloom Meadow.",
    );
  }
  const incomingRawEvents = rawTraceEvents(incoming, "incoming");
  if (previous === null || previous === undefined) {
    return incoming;
  }
  if (
    previous.worldId !== FIRST_BLOOM_WORLD_ID ||
    previous.missionId !== FIRST_BLOOM_MISSION_ID
  ) {
    throw new Error(
      "Previous response does not belong to First Bloom Meadow.",
    );
  }
  if (incoming.runId !== previous.runId) {
    throw new Error(
      "Runtime returned a cumulative response for a different run.",
    );
  }
  if (incoming.events.length < previous.events.length) {
    throw new Error("Runtime trace cannot shrink.");
  }

  const previousRawEvents = rawTraceEvents(previous, "previous");
  for (let index = 0; index < previousRawEvents.length; index += 1) {
    if (!sameJsonValue(previousRawEvents[index], incomingRawEvents[index])) {
      throw new Error("The immutable runtime trace prefix changed.");
    }
  }
  return incoming;
}

export async function createFirstBloomRun(
  blueprint: FirstBloomBlueprint,
): Promise<NormalizedRun> {
  const response = await postJson(FIRST_BLOOM_PATH, blueprint);
  return normalizeRunResponse(response);
}

export async function publishFirstBloomEvent(
  runId: string,
  expectedSequence: number,
): Promise<NormalizedRun> {
  const command: BloomEventCommand = {
    schemaVersion: "1.0.0",
    commandId: crypto.randomUUID(),
    runId,
    expectedSequence,
    kind: "PUBLISH_EVENT",
    payload: { type: "SUNLIGHT_GRANTED" },
  };
  const response = await postJson(
    `/api/v1/runs/${encodeURIComponent(runId)}/commands`,
    command,
  );
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
