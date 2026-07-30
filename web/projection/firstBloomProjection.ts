import type {
  FirstBloomProjection,
  TraceEvent,
} from "../runtime/types";

export const FIRST_BLOOM_STEPS = [
  "prepare-soil",
  "grow-stem",
  "bloom",
] as const;

type FirstBloomStepId = (typeof FIRST_BLOOM_STEPS)[number];

function firstBloomStepId(value: string | undefined): FirstBloomStepId | undefined {
  return FIRST_BLOOM_STEPS.find((stepId) => stepId === value);
}

function setCurrentStep(
  projection: FirstBloomProjection,
  stepId: string | undefined,
) {
  const knownStepId = firstBloomStepId(stepId);
  projection.currentStepId = knownStepId;
  projection.currentStepIndex =
    knownStepId === undefined ? -1 : FIRST_BLOOM_STEPS.indexOf(knownStepId);
}

export function projectFirstBloom(
  events: TraceEvent[],
  cursor = events.length,
): FirstBloomProjection {
  const projection: FirstBloomProjection = {
    phase: "NOT_STARTED",
    currentStepIndex: -1,
    completedStepIds: [],
    enteredStepIds: [],
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
        if (result === "STAY" || result === "DONE") {
          projection.lastStepResult = result;
        }
        break;
      }

      case "FLOWER.STEP_EXITED": {
        const stepId = firstBloomStepId(event.stepId);
        if (
          stepId !== undefined &&
          !projection.completedStepIds.includes(stepId)
        ) {
          projection.completedStepIds.push(stepId);
        }
        projection.flowerStage = Math.min(
          3,
          projection.completedStepIds.length,
        ) as 0 | 1 | 2 | 3;
        break;
      }

      case "GARDEN.TICK_COMPLETED": {
        const phase = event.payload.afterPhase;
        if (phase === "READY" || phase === "RUNNING") {
          projection.phase = phase;
          const nextStep = event.payload.afterStepId;
          setCurrentStep(
            projection,
            typeof nextStep === "string" ? nextStep : undefined,
          );
        } else if (phase === "FINISHED") {
          projection.phase = "FINISHED";
          projection.currentStepId = undefined;
          projection.currentStepIndex = FIRST_BLOOM_STEPS.length;
        }
        break;
      }

      case "FLOWER.FLOW_FINISHED":
        projection.phase = "FINISHED";
        projection.currentStepId = undefined;
        projection.currentStepIndex = FIRST_BLOOM_STEPS.length;
        projection.flowerStage = 3;
        break;

      case "FLOWER.FLOW_FAILED":
      case "FLOWER.FLOW_CANCELLED":
        projection.phase = "FAILED";
        break;
    }
  }

  return projection;
}
