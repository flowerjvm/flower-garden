import type {
  VerdantProjection,
  VerdantTraceEvent,
} from "../../worlds/verdant-signal-garden/web/types";

const VERDANT_STEPS = new Set([
  "wait-for-yard-assignment",
  "yard-move",
  "timed-out",
]);

function payloadString(
  event: VerdantTraceEvent,
  key: string,
): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function payloadNumber(
  event: VerdantTraceEvent,
  key: string,
): number | undefined {
  const value = event.payload[key];
  return Number.isFinite(value) ? (value as number) : undefined;
}

function payloadBoolean(
  event: VerdantTraceEvent,
  key: string,
): boolean | undefined {
  const value = event.payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function knownStepId(
  value: string | null | undefined,
): VerdantProjection["currentStepId"] {
  if (value && VERDANT_STEPS.has(value)) {
    return value as VerdantProjection["currentStepId"];
  }
  return undefined;
}

function setWinnerFromPayload(
  projection: VerdantProjection,
  event: VerdantTraceEvent,
) {
  const winner = payloadString(event, "winner");
  if (winner === "SIGNAL" || winner === "TIMEOUT") {
    projection.winner = winner;
  }
}

function setPathFromPayload(
  projection: VerdantProjection,
  event: VerdantTraceEvent,
) {
  const path = payloadString(event, "selectedPath");
  if (path === "yard-move" || path === "timed-out") {
    projection.selectedPath = path;
  }
}

function setStepResultFromPayload(
  projection: VerdantProjection,
  event: VerdantTraceEvent,
) {
  const result =
    payloadString(event, "returnedStepResult") ??
    payloadString(event, "result");
  if (result) projection.lastStepResult = result;

  const target =
    payloadString(event, "targetStepId") ??
    payloadString(event, "selectedPath");
  projection.lastTargetStepId = target;
}

function setDecisionFromPayload(
  projection: VerdantProjection,
  event: VerdantTraceEvent,
) {
  const result = payloadString(event, "returnedStepResult");
  const target = payloadString(event, "targetStepId");
  if (result) projection.decisionStepResult = result;
  if (target) projection.decisionTargetStepId = target;
}

function applyRuntimePhase(
  projection: VerdantProjection,
  value: string | undefined,
) {
  if (value === "READY") projection.phase = "READY";
  if (value === "RUNNING") projection.phase = "RUNNING";
  if (value === "FINISHED") projection.phase = "FINISHED";
  if (
    value === "FAILED" ||
    value === "CANCELLED" ||
    value === "CHECKPOINT_FAILED"
  ) {
    projection.phase = "FAILED";
  }
}

/**
 * Projects only facts explicitly recorded by the runtime.
 *
 * Unknown kinds are intentionally ignored. In particular, this function never
 * compares the clock with the deadline and never chooses a winning path.
 */
export function projectVerdantSignal(
  events: readonly VerdantTraceEvent[],
  cursor = events.length,
): VerdantProjection {
  const projection: VerdantProjection = {
    phase: "NOT_STARTED",
    clockMillis: 0,
    waitStatus: "IDLE",
    signalStatus: "IDLE",
    timeoutStatus: "IDLE",
    routeCommitted: false,
  };

  for (const event of events.slice(0, Math.max(0, cursor))) {
    projection.activeEvent = event;
    projection.clockMillis = event.logicalTimeMillis;

    switch (event.kind) {
      case "GARDEN.RUN_CREATED":
      case "GARDEN.FLOW_READY":
      case "FLOWER.FLOW_SUBMITTED":
        projection.phase = "READY";
        break;

      case "FLOWER.STEP_ENTERED": {
        projection.phase = "RUNNING";
        const stepId = knownStepId(event.flow?.stepId);
        if (stepId) projection.currentStepId = stepId;
        break;
      }

      case "VERDANT.WAIT_STARTED": {
        projection.phase = "RUNNING";
        projection.waitStatus = "WAITING";
        projection.currentStepId = "wait-for-yard-assignment";
        projection.timeoutStatus = "ARMED";

        const timeoutMillis = payloadNumber(event, "timeoutMillis");
        const deadlineMillis = payloadNumber(event, "deadlineMillis");
        const signalName = payloadString(event, "signalName");
        const checkPrecedence = payloadString(event, "checkPrecedence");
        if (timeoutMillis !== undefined) {
          projection.timeoutMillis = timeoutMillis;
        }
        if (deadlineMillis !== undefined) {
          projection.deadlineMillis = deadlineMillis;
        }
        if (signalName) projection.signalName = signalName;
        if (checkPrecedence) projection.checkPrecedence = checkPrecedence;
        break;
      }

      case "GARDEN.SIGNAL_SEND_REQUESTED":
        projection.signalStatus = "SENDING";
        break;

      case "FLOWER.SIGNAL_RECEIVED":
        projection.signalStatus = "RECEIVED";
        break;

      case "GARDEN.SIGNAL_SENT":
        projection.signalStatus = "SENT";
        break;

      case "GARDEN.SIGNAL_IGNORED":
        projection.signalStatus = "IGNORED";
        break;

      case "GARDEN.TIME_ADVANCED": {
        const deadlineMillis = payloadNumber(event, "deadlineMillis");
        if (deadlineMillis !== undefined) {
          projection.deadlineMillis = deadlineMillis;
        }
        break;
      }

      case "VERDANT.WAIT_EVALUATED": {
        const signalPresent = payloadBoolean(event, "signalPresent");
        const timedOut = payloadBoolean(event, "timedOut");
        if (signalPresent !== undefined) {
          projection.signalPresent = signalPresent;
          if (signalPresent) projection.signalStatus = "PRESENT";
        }
        if (timedOut !== undefined) {
          projection.timedOut = timedOut;
          if (timedOut) projection.timeoutStatus = "REACHED";
        }
        const checkPrecedence = payloadString(event, "checkPrecedence");
        if (checkPrecedence) projection.checkPrecedence = checkPrecedence;
        setWinnerFromPayload(projection, event);
        setPathFromPayload(projection, event);
        setStepResultFromPayload(projection, event);
        if (
          payloadString(event, "winner") === "SIGNAL" ||
          payloadString(event, "winner") === "TIMEOUT"
        ) {
          setDecisionFromPayload(projection, event);
        }
        break;
      }

      case "VERDANT.WAIT_DECIDED":
        projection.waitStatus = "DECIDED";
        setWinnerFromPayload(projection, event);
        setPathFromPayload(projection, event);
        setStepResultFromPayload(projection, event);
        setDecisionFromPayload(projection, event);
        if (projection.winner === "TIMEOUT") {
          projection.timeoutStatus = "SELECTED";
        }
        break;

      case "VERDANT.TIMEOUT_REJECTED":
        projection.timeoutStatus = "REJECTED";
        break;

      case "VERDANT.ROUTE_COMMITTED":
        projection.routeCommitted = true;
        setWinnerFromPayload(projection, event);
        setPathFromPayload(projection, event);
        break;

      case "FLOWER.STEP_RESULT":
        setStepResultFromPayload(projection, event);
        break;

      case "FLOWER.STEP_EXITED":
        if (event.flow?.stepId === "wait-for-yard-assignment") {
          projection.waitStatus = "EXITED";
        }
        break;

      case "GARDEN.TICK_COMPLETED": {
        applyRuntimePhase(
          projection,
          payloadString(event, "afterPhase"),
        );
        const nextStep = knownStepId(
          payloadString(event, "afterStepId"),
        );
        if (nextStep) projection.currentStepId = nextStep;
        break;
      }

      case "FLOWER.FLOW_FINISHED":
        projection.phase = "FINISHED";
        projection.currentStepId = undefined;
        break;

      case "FLOWER.FLOW_FAILED":
      case "FLOWER.FLOW_CANCELLED":
        projection.phase = "FAILED";
        break;
    }
  }

  return projection;
}
