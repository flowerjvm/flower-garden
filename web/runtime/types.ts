export type TickPrediction = "STAY" | "DONE" | "NEXT_STEP";

export type RunMode = "LIVE_RUNTIME" | "RECORDED_REPLAY";

export type FirstBloomStepId =
  | "prepare-soil"
  | "wait-for-sunlight"
  | "grow-stem"
  | "bloom";

export type FirstBloomGardenState =
  | "EMPTY"
  | "SOIL_READY"
  | "SUNLIGHT_READY"
  | "STEM_GROWN"
  | "BLOOMED";

export interface FirstBloomBlueprint {
  schemaVersion: "1.0.0";
  workerId: "first-bloom-worker";
  flowType: "first-flow";
  stepIds: FirstBloomStepId[];
}

export type RunPhase =
  | "NOT_STARTED"
  | "READY"
  | "RUNNING"
  | "FINISHED"
  | "FAILED";

export interface TraceEvent {
  schemaVersion: "1.0.0";
  eventId: string;
  runId: string;
  sequence: number;
  logicalTimeMillis: number;
  type: string;
  source: string;
  flowId?: string;
  stepId?: string;
  summary: string;
  payload: Record<string, unknown>;
  evidence: EvidenceItem[];
}

export interface EvidenceItem {
  id: string;
  label: string;
  kind: "CONTRACT" | "SOURCE" | "TEST";
  description?: string;
  path?: string;
  url?: string;
  symbol?: string;
}

export interface FirstBloomRunOutcome {
  schemaVersion: "1.0.0";
  status: "PASSED" | "FAILED";
  finalState: FirstBloomGardenState;
  workerTicks: number;
  summary: string;
}

export interface NormalizedRun {
  runId: string;
  worldId: "first-bloom-meadow";
  missionId: "the-first-flow";
  runtimeVersion: string;
  events: TraceEvent[];
  evidence: EvidenceItem[];
  outcome?: FirstBloomRunOutcome;
  raw: unknown;
}

export interface TickCommand {
  schemaVersion: "1.0.0";
  commandId: string;
  runId: string;
  expectedSequence: number;
  kind: "TICK";
  payload: Record<string, never>;
}

export interface BloomEventCommand {
  schemaVersion: "1.0.0";
  commandId: string;
  runId: string;
  expectedSequence: number;
  kind: "PUBLISH_EVENT";
  payload: {
    type: "SUNLIGHT_GRANTED";
  };
}

export interface FirstBloomProjection {
  phase: RunPhase;
  currentStepId?: string;
  currentStepIndex: number;
  blueprintStepIds: FirstBloomStepId[];
  completedStepIds: string[];
  enteredStepIds: string[];
  lastStepResult?: string;
  lastExecutedStepId?: FirstBloomStepId;
  failedStepId?: FirstBloomStepId;
  failureCode?: string;
  failureMessage?: string;
  gardenState: FirstBloomGardenState;
  waitingForBloomEvent: boolean;
  bloomEventPublished: boolean;
  logicalTimeMillis: number;
  tickCount: number;
  flowerStage: 0 | 1 | 2 | 3;
  activeEvent?: TraceEvent;
}
