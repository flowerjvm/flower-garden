import type {
  FirstBloomProjection,
  FirstBloomStepId,
  TraceEvent,
} from "../runtime/types";

export const FIRST_BLOOM_STEPS = [
  "prepare-soil",
  "wait-for-sunlight",
  "grow-stem",
  "bloom",
] as const;

const GARDEN_STAGE: Record<
  FirstBloomProjection["gardenState"],
  FirstBloomProjection["flowerStage"]
> = {
  EMPTY: 0,
  SOIL_READY: 1,
  SUNLIGHT_READY: 1,
  STEM_GROWN: 2,
  BLOOMED: 3,
};

function firstBloomStepId(
  value: unknown,
): FirstBloomStepId | undefined {
  return typeof value === "string"
    ? FIRST_BLOOM_STEPS.find((stepId) => stepId === value)
    : undefined;
}

function blueprintFromPayload(value: unknown): FirstBloomStepId[] {
  if (
    !Array.isArray(value) ||
    value.length !== FIRST_BLOOM_STEPS.length
  ) {
    throw new Error(
      "GARDEN.BLUEPRINT_ACCEPTED payload.stepIds must contain exactly four Step ids.",
    );
  }
  const stepIds = value.map((value, index) => {
    const stepId = firstBloomStepId(value);
    if (stepId === undefined) {
      throw new Error(
        `GARDEN.BLUEPRINT_ACCEPTED payload.stepIds[${index}] is not a known First Bloom Step id.`,
      );
    }
    return stepId;
  });
  if (new Set(stepIds).size !== FIRST_BLOOM_STEPS.length) {
    throw new Error(
      "GARDEN.BLUEPRINT_ACCEPTED payload.stepIds must contain four unique Step ids.",
    );
  }
  return stepIds;
}

function setCurrentStep(
  projection: FirstBloomProjection,
  stepId: unknown,
) {
  const knownStepId = firstBloomStepId(stepId);
  projection.currentStepId = knownStepId;
  projection.currentStepIndex =
    knownStepId === undefined
      ? -1
      : projection.blueprintStepIds.indexOf(knownStepId);
}

function setGardenState(
  projection: FirstBloomProjection,
  value: unknown,
) {
  if (
    value === "EMPTY" ||
    value === "SOIL_READY" ||
    value === "SUNLIGHT_READY" ||
    value === "STEM_GROWN" ||
    value === "BLOOMED"
  ) {
    projection.gardenState = value;
    projection.flowerStage = GARDEN_STAGE[value];
    return;
  }
  throw new Error(
    "GARDEN.PLOT_UPDATED payload.gardenState is not a valid First Bloom garden state.",
  );
}

/**
 * Reduces only facts emitted by the JVM Runtime. Step order, mission success,
 * failure, and garden progress are never inferred from the player's draft.
 */
export function projectFirstBloom(
  events: TraceEvent[],
  cursor = events.length,
): FirstBloomProjection {
  const projection: FirstBloomProjection = {
    phase: "NOT_STARTED",
    currentStepIndex: -1,
    blueprintStepIds: [],
    completedStepIds: [],
    enteredStepIds: [],
    gardenState: "EMPTY",
    waitingForBloomEvent: false,
    bloomEventPublished: false,
    logicalTimeMillis: 0,
    tickCount: 0,
    flowerStage: 0,
  };

  for (const event of events.slice(0, Math.max(0, cursor))) {
    projection.activeEvent = event;
    projection.logicalTimeMillis = Math.max(
      projection.logicalTimeMillis,
      event.logicalTimeMillis,
    );

    switch (event.type) {
      case "GARDEN.BLUEPRINT_ACCEPTED": {
        projection.blueprintStepIds = blueprintFromPayload(
          event.payload.stepIds,
        );
        break;
      }

      case "GARDEN.FLOW_READY":
      case "FLOWER.FLOW_SUBMITTED":
        projection.phase = "READY";
        break;

      case "GARDEN.TICK_REQUESTED":
        projection.tickCount += 1;
        break;

      case "FLOWER.STEP_ENTERED": {
        const stepId = firstBloomStepId(event.stepId);
        if (stepId !== undefined) {
          projection.phase = "RUNNING";
          setCurrentStep(projection, stepId);
          if (!projection.enteredStepIds.includes(stepId)) {
            projection.enteredStepIds.push(stepId);
          }
        }
        break;
      }

      case "FLOWER.STEP_RESULT": {
        const result = event.payload.result;
        if (
          result === "STAY" ||
          result === "DONE" ||
          result === "FAIL"
        ) {
          projection.lastStepResult = result;
          projection.lastExecutedStepId = firstBloomStepId(event.stepId);
        }
        break;
      }

      case "GARDEN.PLOT_UPDATED":
        setGardenState(
          projection,
          event.payload.gardenState,
        );
        break;

      case "FIRST_BLOOM.SUNLIGHT_WAITING":
        projection.waitingForBloomEvent = true;
        break;

      case "GARDEN.BLOOM_EVENT_PUBLISHED":
        projection.bloomEventPublished = true;
        break;

      case "FIRST_BLOOM.SUNLIGHT_ACCEPTED":
        projection.waitingForBloomEvent = false;
        break;

      case "GARDEN.MISSION_BLOCKED":
        projection.failedStepId = firstBloomStepId(
          event.payload.stepId ?? event.stepId,
        );
        if (typeof event.payload.code === "string") {
          projection.failureCode = event.payload.code;
        }
        if (typeof event.payload.message === "string") {
          projection.failureMessage = event.payload.message;
        }
        break;

      case "FLOWER.STEP_EXITED": {
        const stepId = firstBloomStepId(event.stepId);
        if (
          stepId !== undefined &&
          projection.lastStepResult === "DONE" &&
          projection.lastExecutedStepId === stepId &&
          !projection.completedStepIds.includes(stepId)
        ) {
          projection.completedStepIds.push(stepId);
        }

        break;
      }

      case "GARDEN.TICK_COMPLETED": {
        const phase = event.payload.afterPhase;
        if (phase === "READY" || phase === "RUNNING") {
          projection.phase = phase;
          setCurrentStep(projection, event.payload.afterStepId);
        } else if (phase === "FINISHED") {
          projection.phase = "FINISHED";
          projection.currentStepId = undefined;
          projection.currentStepIndex = projection.blueprintStepIds.length;
        } else if (phase === "FAILED") {
          projection.phase = "FAILED";
          projection.currentStepId = undefined;
          projection.currentStepIndex = -1;
        }
        break;
      }

      case "FLOWER.FLOW_FINISHED":
        projection.phase = "FINISHED";
        projection.currentStepId = undefined;
        projection.currentStepIndex = projection.blueprintStepIds.length;
        break;

      case "FLOWER.FLOW_FAILED":
      case "FLOWER.FLOW_CANCELLED":
        projection.phase = "FAILED";
        projection.currentStepId = undefined;
        projection.currentStepIndex = -1;
        break;
    }
  }

  return projection;
}
