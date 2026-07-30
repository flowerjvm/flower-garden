import type { TraceEvent } from "../../../web/runtime/types";

export interface FirstBloomEvidenceChoice {
  id: string;
  label: string;
}

export interface FirstBloomLessonBeat {
  id: string;
  tick: number;
  focus: string;
  predictionPrompt: string;
  predictionContext: string;
  reviewTitle: string;
  evidenceQuestion: string;
  evidenceChoices: readonly FirstBloomEvidenceChoice[];
  correctEvidenceChoiceId: string;
  successCopy: string;
  retryHint: string;
}

export interface EvidenceAnswerResult {
  correct: boolean;
  traceSupportsLesson: boolean;
  message: string;
}

export const FIRST_BLOOM_LESSON_BEATS: readonly FirstBloomLessonBeat[] = [
  {
    id: "stay-keeps-current-step",
    tick: 1,
    focus: "STAY도 실제 실행 결과다",
    predictionPrompt: "첫 tick에서 prepare-soil은 끝날까요?",
    predictionContext:
      "Flow는 READY이고 prepare-soil이 처음 실행됩니다. Worker가 현재 Step을 딱 한 번 실행합니다.",
    reviewTitle: "왜 같은 Step에 머물렀을까요?",
    evidenceQuestion: "방금 돌아온 실제 Trace가 보여 준 이유를 고르세요.",
    evidenceChoices: [
      {
        id: "step-result-stay",
        label: "prepare-soil이 StepResult.STAY를 반환했다.",
      },
      {
        id: "animation-waited",
        label: "3D 꽃 애니메이션이 아직 끝나지 않았다.",
      },
      {
        id: "prediction-controlled-runtime",
        label: "내가 STAY를 예측해서 Runtime이 멈췄다.",
      },
    ],
    correctEvidenceChoiceId: "step-result-stay",
    successCopy:
      "정답입니다. STAY가 Flow를 현재 Step에 남겼고, 3D 세계는 그 결과를 뒤늦게 투영했습니다.",
    retryHint:
      "예측이나 애니메이션이 아니라 FLOWER.STEP_RESULT 이벤트의 result 값을 확인하세요.",
  },
  {
    id: "done-advances-without-entering-next-step",
    tick: 2,
    focus: "이동과 다음 Step 실행은 다른 tick이다",
    predictionPrompt: "두 번째 tick의 prepare-soil 결과는?",
    predictionContext:
      "첫 tick에서는 STAY였습니다. 같은 Step이 두 번째로 실행되며 완료 여부를 Flower에 반환합니다.",
    reviewTitle: "왜 grow-stem은 아직 실행되지 않았을까요?",
    evidenceQuestion:
      "currentStepId는 grow-stem으로 바뀌었지만 같은 tick에 STEP_ENTERED가 없는 이유를 고르세요.",
    evidenceChoices: [
      {
        id: "hidden-grow-stem",
        label: "grow-stem도 실행됐지만 Trace에서 숨겨졌다.",
      },
      {
        id: "one-current-step-per-tick",
        label:
          "한 Flow tick은 현재 Step 하나만 실행하며, DONE은 다음 Step 포인터만 옮긴다.",
      },
      {
        id: "slow-animation",
        label: "줄기 애니메이션이 느려서 실행이 늦게 보일 뿐이다.",
      },
    ],
    correctEvidenceChoiceId: "one-current-step-per-tick",
    successCopy:
      "정답입니다. prepare-soil의 DONE이 포인터를 옮겼고, grow-stem 진입은 다음 Worker tick의 일입니다.",
    retryHint:
      "이 tick 안에 prepare-soil의 DONE과 EXIT는 있지만 grow-stem의 STEP_ENTERED는 없는지 비교하세요.",
  },
  {
    id: "next-tick-enters-next-step",
    tick: 3,
    focus: "다음 tick이 다음 Step을 실행한다",
    predictionPrompt: "grow-stem이 처음 실행되는 tick의 결과는?",
    predictionContext:
      "이제 currentStepId가 grow-stem입니다. 이번 Worker tick에서 Flower가 이 Step에 실제로 진입합니다.",
    reviewTitle: "grow-stem이 실제로 실행됐다는 근거는?",
    evidenceQuestion: "같은 tick 안에서 확인할 수 있는 이벤트 조합을 고르세요.",
    evidenceChoices: [
      {
        id: "current-step-label-only",
        label: "화면의 현재 STEP 글자가 grow-stem으로 바뀌었다.",
      },
      {
        id: "previous-tick-done",
        label: "이전 tick에서 prepare-soil이 DONE을 반환했다.",
      },
      {
        id: "entered-and-returned-result",
        label:
          "FLOWER.STEP_ENTERED grow-stem과 FLOWER.STEP_RESULT DONE이 함께 기록됐다.",
      },
    ],
    correctEvidenceChoiceId: "entered-and-returned-result",
    successCopy:
      "정답입니다. 이전 tick은 포인터만 옮겼고, 이번 tick의 STEP_ENTERED와 STEP_RESULT가 실제 실행을 증명합니다.",
    retryHint:
      "화면 라벨이 아니라 이번 tick의 STEP_ENTERED와 STEP_RESULT 이벤트를 함께 찾으세요.",
  },
  {
    id: "last-done-finishes-flow",
    tick: 4,
    focus: "마지막 DONE이 Flow를 끝낸다",
    predictionPrompt: "마지막 bloom Step이 반환할 결과는?",
    predictionContext:
      "bloom은 Flow의 마지막 Step입니다. Worker가 한 번 더 실행하면 Flower가 최종 상태를 확정합니다.",
    reviewTitle: "Flow 완료를 증명하는 것은 무엇일까요?",
    evidenceQuestion: "꽃 그림이 아닌 Runtime의 완료 근거를 고르세요.",
    evidenceChoices: [
      {
        id: "flower-is-visible",
        label: "3D 세계에 꽃이 완전히 보인다.",
      },
      {
        id: "flow-finished-event",
        label:
          "bloom의 DONE 뒤 FLOWER.FLOW_FINISHED가 실제 Trace에 기록됐다.",
      },
      {
        id: "prediction-was-done",
        label: "플레이어가 DONE을 선택했다.",
      },
    ],
    correctEvidenceChoiceId: "flow-finished-event",
    successCopy:
      "정답입니다. 꽃은 투영 화면이고, bloom의 DONE과 FLOWER.FLOW_FINISHED가 완료의 근거입니다.",
    retryHint:
      "마지막 StepResult 뒤에 FlowerListener가 기록한 FLOWER.FLOW_FINISHED를 찾으세요.",
  },
] as const;

function hasStepResult(
  events: readonly TraceEvent[],
  stepId: string,
  result: string,
): boolean {
  return events.some(
    (event) =>
      event.type === "FLOWER.STEP_RESULT" &&
      event.stepId === stepId &&
      event.payload.result === result,
  );
}

function hasStepEntered(
  events: readonly TraceEvent[],
  stepId: string,
): boolean {
  return events.some(
    (event) =>
      event.type === "FLOWER.STEP_ENTERED" && event.stepId === stepId,
  );
}

function traceSupportsBeat(
  beatId: string,
  events: readonly TraceEvent[],
): boolean {
  switch (beatId) {
    case "stay-keeps-current-step":
      return hasStepResult(events, "prepare-soil", "STAY");

    case "done-advances-without-entering-next-step":
      return (
        hasStepResult(events, "prepare-soil", "DONE") &&
        !hasStepEntered(events, "grow-stem") &&
        events.some(
          (event) =>
            event.type === "GARDEN.TICK_COMPLETED" &&
            event.payload.afterStepId === "grow-stem",
        )
      );

    case "next-tick-enters-next-step":
      return (
        hasStepEntered(events, "grow-stem") &&
        hasStepResult(events, "grow-stem", "DONE")
      );

    case "last-done-finishes-flow":
      return (
        hasStepResult(events, "bloom", "DONE") &&
        events.some((event) => event.type === "FLOWER.FLOW_FINISHED")
      );

    default:
      return false;
  }
}

export function evaluateFirstBloomEvidenceAnswer(
  beat: FirstBloomLessonBeat,
  choiceId: string,
  tickEvents: readonly TraceEvent[],
): EvidenceAnswerResult {
  const supported = traceSupportsBeat(beat.id, tickEvents);
  if (!supported) {
    return {
      correct: false,
      traceSupportsLesson: false,
      message:
        "이번 실제 Trace가 이 학습 계약의 예상 근거와 일치하지 않습니다. 결과를 추측하지 말고 Runtime Trace를 확인하세요.",
    };
  }

  if (choiceId === beat.correctEvidenceChoiceId) {
    return {
      correct: true,
      traceSupportsLesson: true,
      message: beat.successCopy,
    };
  }

  return {
    correct: false,
    traceSupportsLesson: true,
    message: beat.retryHint,
  };
}

export function canRequestFirstBloomTick(input: {
  hasRun: boolean;
  hasPrediction: boolean;
  reviewPending: boolean;
  busy: boolean;
  isPlaying: boolean;
  atLatestCursor: boolean;
  runtimePhase: string;
  completedTickCount: number;
}): boolean {
  return (
    input.hasRun &&
    input.hasPrediction &&
    !input.reviewPending &&
    !input.busy &&
    !input.isPlaying &&
    input.atLatestCursor &&
    input.runtimePhase !== "FINISHED" &&
    input.runtimePhase !== "FAILED" &&
    input.completedTickCount < FIRST_BLOOM_LESSON_BEATS.length
  );
}

export function isFirstBloomLessonCleared(
  runtimePhase: string,
  masteredBeatIds: readonly string[],
): boolean {
  return (
    runtimePhase === "FINISHED" &&
    FIRST_BLOOM_LESSON_BEATS.every((beat) =>
      masteredBeatIds.includes(beat.id),
    )
  );
}
