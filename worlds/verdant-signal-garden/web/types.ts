export const VERDANT_WORLD_ID = "verdant-signal-garden" as const;
export const VERDANT_MISSION_ID = "signal-vs-timeout" as const;
export const YARD_SIGNAL_NAME = "yard-assignment" as const;

export type VerdantPrediction = "SIGNAL" | "TIMEOUT" | "BOTH";

export type VerdantCommand =
  | {
      kind: "TICK";
      payload: Record<string, never>;
    }
  | {
      kind: "ADVANCE_TIME";
      payload: { millis: number };
    }
  | {
      kind: "SEND_SIGNAL";
      payload: { name: typeof YARD_SIGNAL_NAME };
    };

export interface VerdantEvidence {
  type: "CONTRACT" | "SOURCE" | "TEST";
  ref: string;
  label: string;
}

export interface VerdantFlowReference {
  type: string;
  key: string;
  state:
    | "CREATED"
    | "READY"
    | "RUNNING"
    | "FINISHED"
    | "FAILED"
    | "CANCELLED"
    | "CHECKPOINT_FAILED";
  stepId: string | null;
  stepNo: number;
}

export interface VerdantTraceEvent {
  schemaVersion: "1.0.0";
  eventId: string;
  runId: string;
  sequence: number;
  logicalTimeMillis: number;
  source:
    | "RUN_COORDINATOR"
    | "FLOWER_LISTENER"
    | "FLOWER_EVENT_BUS"
    | "FLOWER_STEP";
  kind: string;
  flow: VerdantFlowReference | null;
  payload: Record<string, unknown>;
  evidence: VerdantEvidence[];
}

export interface VerdantOutcome {
  schemaVersion?: "1.0.0";
  status?: string;
  finalState?: "SIGNALED" | "TIMED_OUT";
  workerTicks?: number;
  summary?: string;
}

export interface VerdantRunSnapshot {
  schemaVersion: "1.0.0";
  runId: string;
  worldId: typeof VERDANT_WORLD_ID;
  missionId: typeof VERDANT_MISSION_ID;
  flowerRuntimeVersion: string;
  phase: string;
  currentStepId: string | null;
  events: VerdantTraceEvent[];
  evidence: VerdantEvidence[];
  outcome: VerdantOutcome | null;
}

export interface VerdantRuntimeAdapter {
  createRun: () => Promise<VerdantRunSnapshot>;
  sendCommand: (
    runId: string,
    expectedSequence: number,
    command: VerdantCommand,
  ) => Promise<VerdantRunSnapshot>;
}

export type VerdantScenarioId =
  | "signal-at-29s"
  | "both-at-deadline"
  | "timeout-then-late-signal";

export interface VerdantScenario {
  id: VerdantScenarioId;
  shortLabel: string;
  title: string;
  timeline: string;
  question: string;
  commands: readonly VerdantCommand[];
}

export interface VerdantProjection {
  phase: "NOT_STARTED" | "READY" | "RUNNING" | "FINISHED" | "FAILED";
  currentStepId?: "wait-for-yard-assignment" | "yard-move" | "timed-out";
  clockMillis: number;
  deadlineMillis?: number;
  timeoutMillis?: number;
  signalName?: string;
  checkPrecedence?: string;
  waitStatus: "IDLE" | "WAITING" | "DECIDED" | "EXITED";
  signalStatus:
    | "IDLE"
    | "SENDING"
    | "RECEIVED"
    | "PRESENT"
    | "SENT"
    | "IGNORED";
  timeoutStatus: "IDLE" | "ARMED" | "REACHED" | "REJECTED" | "SELECTED";
  winner?: "SIGNAL" | "TIMEOUT";
  selectedPath?: "yard-move" | "timed-out";
  lastStepResult?: string;
  lastTargetStepId?: string;
  decisionStepResult?: string;
  decisionTargetStepId?: string;
  signalPresent?: boolean;
  timedOut?: boolean;
  routeCommitted: boolean;
  activeEvent?: VerdantTraceEvent;
}
