export type TickPrediction = "STAY" | "DONE" | "NEXT_STEP";

export type RunMode = "LIVE_RUNTIME" | "RECORDED_REPLAY";

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

export interface NormalizedRun {
  runId: string;
  worldId: string;
  missionId: string;
  runtimeVersion: string;
  events: TraceEvent[];
  evidence: EvidenceItem[];
  outcome?: {
    winner?: string;
    finalState?: string;
    predictionCorrect?: boolean;
    explanation?: string;
  };
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

export interface FirstBloomProjection {
  phase: RunPhase;
  currentStepId?: string;
  currentStepIndex: number;
  completedStepIds: string[];
  enteredStepIds: string[];
  lastStepResult?: string;
  logicalTimeMillis: number;
  tickCount: number;
  flowerStage: 0 | 1 | 2 | 3;
  activeEvent?: TraceEvent;
}
