import type {
  VerdantCommand,
  VerdantPrediction,
  VerdantProjection,
  VerdantScenarioId,
  VerdantTraceEvent,
} from "./types";

export type VerdantActionId =
  | "ADVANCE_29_SECONDS"
  | "ADVANCE_30_SECONDS"
  | "SEND_YARD_SIGNAL"
  | "WORKER_TICK";

export type VerdantEvidenceAnswerId =
  | "signal-directly-routes"
  | "worker-tick-evaluates"
  | "clock-directly-routes"
  | "late-signal-reopens"
  | "late-signal-is-ignored"
  | "late-signal-replaces-winner"
  | "flower-global-signal-priority"
  | "step-checks-signal-first"
  | "event-insertion-order-wins";

export interface VerdantActionDefinition {
  id: VerdantActionId;
  label: string;
  description: string;
}

export interface VerdantEvidenceOption {
  id: VerdantEvidenceAnswerId;
  label: string;
}

export interface VerdantEvidenceQuestion {
  prompt: string;
  options: readonly VerdantEvidenceOption[];
  correctAnswerId: VerdantEvidenceAnswerId;
  explanation: string;
  retryHint: string;
  requiredEventKinds: readonly string[];
}

export interface VerdantLearningChallenge {
  id: VerdantScenarioId;
  order: 1 | 2 | 3;
  shortLabel: string;
  title: string;
  briefing: string;
  objective: string;
  predictionPrompt: string;
  expectedPrediction: VerdantPrediction;
  unlockRequirement: VerdantScenarioId | null;
  /**
   * These are controls the player may press. They are deliberately not an
   * ordered command script: each press creates and sends one runtime command.
   */
  availableActionIds: readonly VerdantActionId[];
  evidenceQuestion: VerdantEvidenceQuestion;
}

export type VerdantObjectiveStatus = "IN_PROGRESS" | "PASSED" | "FAILED";

export interface VerdantObjectiveCheck {
  id: string;
  label: string;
  passed: boolean;
  evidenceEventKinds: readonly string[];
}

export interface VerdantChallengeEvaluation {
  challengeId: VerdantScenarioId;
  status: VerdantObjectiveStatus;
  terminal: boolean;
  checks: readonly VerdantObjectiveCheck[];
  summary: string;
}

export interface VerdantEvidenceGrade {
  challengeId: VerdantScenarioId;
  answerId: VerdantEvidenceAnswerId;
  correct: boolean;
  explanation: string;
}

export const VERDANT_ACTIONS: Readonly<
  Record<VerdantActionId, VerdantActionDefinition>
> = {
  ADVANCE_29_SECONDS: {
    id: "ADVANCE_29_SECONDS",
    label: "시간 +29초",
    description: "ManualClock을 29,000ms 전진시킵니다.",
  },
  ADVANCE_30_SECONDS: {
    id: "ADVANCE_30_SECONDS",
    label: "시간 +30초",
    description: "ManualClock을 deadline까지 30,000ms 전진시킵니다.",
  },
  SEND_YARD_SIGNAL: {
    id: "SEND_YARD_SIGNAL",
    label: "Yard Signal 보내기",
    description:
      "yard-assignment Signal을 보냅니다. Signal 자체는 경로를 결정하지 않습니다.",
  },
  WORKER_TICK: {
    id: "WORKER_TICK",
    label: "Worker.tickOnce()",
    description:
      "실제 Flower Worker가 현재 Step을 한 번 관찰하고 StepResult를 반환합니다.",
  },
} as const;

export const VERDANT_LEARNING_CHALLENGES: readonly VerdantLearningChallenge[] =
  [
    {
      id: "signal-at-29s",
      order: 1,
      shortLabel: "Signal 먼저",
      title: "마감 1초 전의 Signal",
      briefing:
        "컨테이너는 Yard Assignment를 기다리고 있습니다. 제한 시간은 30초입니다.",
      objective:
        "29초에 Signal을 전달한 뒤 Worker가 이를 관찰해 yard-move 경로를 확정하게 하세요.",
      predictionPrompt:
        "Signal이 도착한 뒤 다음 Worker tick은 어떤 경로를 선택할까요?",
      expectedPrediction: "SIGNAL",
      unlockRequirement: null,
      availableActionIds: [
        "ADVANCE_29_SECONDS",
        "SEND_YARD_SIGNAL",
        "WORKER_TICK",
      ],
      evidenceQuestion: {
        prompt: "Signal을 보낸 순간 Flow가 yard-move로 이동했나요?",
        options: [
          {
            id: "signal-directly-routes",
            label: "예. Signal 전송이 Flow를 직접 이동시켰다.",
          },
          {
            id: "worker-tick-evaluates",
            label:
              "아니요. 다음 Worker tick에서 Step이 Signal을 관찰하고 GOTO를 반환했다.",
          },
          {
            id: "clock-directly-routes",
            label: "아니요. ManualClock이 Flow를 직접 이동시켰다.",
          },
        ],
        correctAnswerId: "worker-tick-evaluates",
        explanation:
          "Signal은 기다리는 Step을 깨우는 입력입니다. 경로는 다음 Worker tick에서 Step이 기록한 GOTO 결과로 확정됩니다.",
        retryHint:
          "Signal 직후와 다음 Worker tick 직후의 Trace를 비교해 보세요. 경로를 처음 기록한 이벤트가 무엇인지 찾아야 합니다.",
        requiredEventKinds: [
          "GARDEN.SIGNAL_SENT",
          "VERDANT.WAIT_DECIDED",
          "FLOWER.STEP_RESULT",
        ],
      },
    },
    {
      id: "timeout-then-late-signal",
      order: 2,
      shortLabel: "Timeout 먼저",
      title: "종료된 Wait에 도착한 Signal",
      briefing:
        "30초 deadline에서 Worker가 Timeout 경로를 먼저 확정했습니다. 그 뒤 Signal을 보내 보세요.",
      objective:
        "timed-out 경로를 확정하고, 뒤늦은 Signal이 종료된 Wait를 다시 열지 못한다는 기록을 남기세요.",
      predictionPrompt:
        "Timeout으로 Wait가 종료된 뒤 도착한 Signal은 어떻게 처리될까요?",
      expectedPrediction: "TIMEOUT",
      unlockRequirement: "signal-at-29s",
      availableActionIds: [
        "ADVANCE_30_SECONDS",
        "SEND_YARD_SIGNAL",
        "WORKER_TICK",
      ],
      evidenceQuestion: {
        prompt: "Timeout 경로가 정해진 뒤 보낸 Signal은 무엇을 했나요?",
        options: [
          {
            id: "late-signal-is-ignored",
            label:
              "WAIT_STEP_NOT_ACTIVE로 무시되었고 확정된 경로를 바꾸지 못했다.",
          },
          {
            id: "late-signal-reopens",
            label: "종료된 Wait를 다시 열었다.",
          },
          {
            id: "late-signal-replaces-winner",
            label: "TIMEOUT 승자를 SIGNAL로 교체했다.",
          },
        ],
        correctAnswerId: "late-signal-is-ignored",
        explanation:
          "Wait가 이미 종료되었으므로 Signal은 GARDEN.SIGNAL_IGNORED로 기록됩니다. 확정된 timed-out 경로는 바뀌지 않습니다.",
        retryHint:
          "늦은 Signal 뒤에 FLOWER.SIGNAL_RECEIVED가 생겼는지, 아니면 GARDEN.SIGNAL_IGNORED가 생겼는지 확인하세요.",
        requiredEventKinds: [
          "VERDANT.WAIT_DECIDED",
          "GARDEN.SIGNAL_IGNORED",
          "VERDANT.ROUTE_COMMITTED",
        ],
      },
    },
    {
      id: "both-at-deadline",
      order: 3,
      shortLabel: "둘 다 true",
      title: "Deadline에서 만난 Signal과 Timeout",
      briefing:
        "시각은 정확히 30초이고 Signal도 도착했습니다. 다음 Worker tick에서 두 조건이 모두 true입니다.",
      objective:
        "두 조건을 같은 tick에서 관찰하고, 이 미션 Step의 SIGNAL_THEN_TIMEOUT 정책으로 yard-move를 확정하세요.",
      predictionPrompt:
        "signalPresent와 timedOut이 모두 true일 때 무엇이 승리할까요?",
      expectedPrediction: "BOTH",
      unlockRequirement: "timeout-then-late-signal",
      availableActionIds: [
        "ADVANCE_30_SECONDS",
        "SEND_YARD_SIGNAL",
        "WORKER_TICK",
      ],
      evidenceQuestion: {
        prompt: "Signal이 이긴 이유는 무엇인가요?",
        options: [
          {
            id: "flower-global-signal-priority",
            label: "Flower Runtime은 언제나 Signal을 Timeout보다 우선한다.",
          },
          {
            id: "event-insertion-order-wins",
            label: "같은 시각에는 먼저 삽입된 이벤트가 무조건 승리한다.",
          },
          {
            id: "step-checks-signal-first",
            label:
              "이 미션의 Wait Step이 SIGNAL_THEN_TIMEOUT 순서로 조건을 검사했다.",
          },
        ],
        correctAnswerId: "step-checks-signal-first",
        explanation:
          "이 결과는 Flower 전체의 숨은 우선순위가 아닙니다. 이 미션 Step이 명시한 SIGNAL_THEN_TIMEOUT 검사 순서의 결과입니다.",
        retryHint:
          "VERDANT.WAIT_DECIDED의 checkPrecedence를 확인하세요. Flower 전체 규칙인지 이 Step이 기록한 정책인지 구분해야 합니다.",
        requiredEventKinds: [
          "VERDANT.WAIT_EVALUATED",
          "VERDANT.WAIT_DECIDED",
          "VERDANT.TIMEOUT_REJECTED",
        ],
      },
    },
  ] as const;

export function getVerdantLearningChallenge(
  challengeId: VerdantScenarioId,
): VerdantLearningChallenge {
  const challenge = VERDANT_LEARNING_CHALLENGES.find(
    (candidate) => candidate.id === challengeId,
  );
  if (!challenge) {
    throw new Error(`Unknown Verdant challenge: ${challengeId}`);
  }
  return challenge;
}

/**
 * Keeps browser progress bounded to known curriculum ids, removes duplicates,
 * and restores the canonical lesson order.
 */
export function normalizeVerdantCompletedIds(
  value: unknown,
): VerdantScenarioId[] {
  if (!Array.isArray(value)) return [];

  const known = new Set(
    VERDANT_LEARNING_CHALLENGES.map((challenge) => challenge.id),
  );
  const selected = new Set<VerdantScenarioId>();

  for (const item of value) {
    if (
      typeof item === "string" &&
      known.has(item as VerdantScenarioId)
    ) {
      selected.add(item as VerdantScenarioId);
    }
  }

  return VERDANT_LEARNING_CHALLENGES.map(
    (challenge) => challenge.id,
  ).filter((challengeId) => selected.has(challengeId));
}

/**
 * Builds exactly one command for one player action. The learning layer never
 * owns an ordered command macro; the runtime receives each command separately.
 */
export function createVerdantCommand(
  actionId: VerdantActionId,
): VerdantCommand {
  switch (actionId) {
    case "ADVANCE_29_SECONDS":
      return { kind: "ADVANCE_TIME", payload: { millis: 29_000 } };
    case "ADVANCE_30_SECONDS":
      return { kind: "ADVANCE_TIME", payload: { millis: 30_000 } };
    case "SEND_YARD_SIGNAL":
      return {
        kind: "SEND_SIGNAL",
        payload: { name: "yard-assignment" },
      };
    case "WORKER_TICK":
      return { kind: "TICK", payload: {} };
  }
}

function hasEvent(
  events: readonly VerdantTraceEvent[],
  kind: string,
  predicate?: (event: VerdantTraceEvent) => boolean,
): boolean {
  return events.some(
    (event) => event.kind === kind && (!predicate || predicate(event)),
  );
}

function eventPayloadIs(
  event: VerdantTraceEvent,
  key: string,
  expected: unknown,
): boolean {
  return event.payload[key] === expected;
}

function check(
  id: string,
  label: string,
  passed: boolean,
  ...evidenceEventKinds: string[]
): VerdantObjectiveCheck {
  return { id, label, passed, evidenceEventKinds };
}

function commonRouteCheck(
  projection: VerdantProjection,
): VerdantObjectiveCheck {
  return check(
    "route-committed",
    "실제 Runtime이 후속 경로를 확정했다.",
    projection.routeCommitted &&
      hasKnownRoute(projection) &&
      projection.phase === "FINISHED",
    "VERDANT.ROUTE_COMMITTED",
    "FLOWER.FLOW_FINISHED",
  );
}

function hasKnownRoute(projection: VerdantProjection): boolean {
  return (
    projection.selectedPath === "yard-move" ||
    projection.selectedPath === "timed-out"
  );
}

function evaluateSignalAt29Seconds(
  projection: VerdantProjection,
  events: readonly VerdantTraceEvent[],
): readonly VerdantObjectiveCheck[] {
  return [
    commonRouteCheck(projection),
    check(
      "decision-at-29-seconds",
      "ManualClock 29초에서 Signal을 보내고 결정 tick을 실행했다.",
      hasEvent(
        events,
        "GARDEN.TIME_ADVANCED",
        (event) =>
          event.logicalTimeMillis === 29_000 &&
          eventPayloadIs(event, "afterMillis", 29_000),
      ) &&
        hasEvent(
          events,
          "GARDEN.SIGNAL_SENT",
          (event) => event.logicalTimeMillis === 29_000,
        ) &&
        hasEvent(
          events,
          "VERDANT.WAIT_DECIDED",
          (event) =>
            event.logicalTimeMillis === 29_000 &&
            eventPayloadIs(event, "elapsedMillis", 29_000),
        ),
      "GARDEN.TIME_ADVANCED",
      "GARDEN.SIGNAL_SENT",
      "VERDANT.WAIT_DECIDED",
    ),
    check(
      "signal-observed-before-timeout",
      "Worker가 Signal=true, Timeout=false를 관찰했다.",
      projection.signalPresent === true &&
        projection.timedOut === false &&
        hasEvent(
          events,
          "VERDANT.WAIT_DECIDED",
          (event) =>
            eventPayloadIs(event, "signalPresent", true) &&
            eventPayloadIs(event, "timedOut", false),
        ),
      "VERDANT.WAIT_DECIDED",
    ),
    check(
      "yard-move-selected",
      "Runtime이 SIGNAL 승자와 yard-move 경로를 기록했다.",
      projection.winner === "SIGNAL" &&
        projection.selectedPath === "yard-move" &&
        hasEvent(events, "GARDEN.SIGNAL_SENT") &&
        hasEvent(
          events,
          "VERDANT.ROUTE_COMMITTED",
          (event) =>
            eventPayloadIs(event, "winner", "SIGNAL") &&
            eventPayloadIs(event, "selectedPath", "yard-move"),
        ),
      "GARDEN.SIGNAL_SENT",
      "VERDANT.ROUTE_COMMITTED",
    ),
  ];
}

function evaluateTimeoutThenLateSignal(
  projection: VerdantProjection,
  events: readonly VerdantTraceEvent[],
): readonly VerdantObjectiveCheck[] {
  return [
    commonRouteCheck(projection),
    check(
      "decision-at-deadline",
      "ManualClock 30초 deadline에서 Timeout 결정 tick을 실행했다.",
      hasEvent(
        events,
        "GARDEN.TIME_ADVANCED",
        (event) =>
          event.logicalTimeMillis === 30_000 &&
          eventPayloadIs(event, "afterMillis", 30_000),
      ) &&
        hasEvent(
          events,
          "VERDANT.WAIT_DECIDED",
          (event) =>
            event.logicalTimeMillis === 30_000 &&
            eventPayloadIs(event, "elapsedMillis", 30_000),
        ),
      "GARDEN.TIME_ADVANCED",
      "VERDANT.WAIT_DECIDED",
    ),
    check(
      "timeout-selected",
      "Worker가 Timeout=true를 관찰하고 timed-out 경로를 선택했다.",
      projection.signalPresent === false &&
        projection.timedOut === true &&
        projection.winner === "TIMEOUT" &&
        projection.selectedPath === "timed-out" &&
        hasEvent(
          events,
          "VERDANT.WAIT_DECIDED",
          (event) =>
            eventPayloadIs(event, "winner", "TIMEOUT") &&
            eventPayloadIs(event, "selectedPath", "timed-out"),
        ),
      "VERDANT.WAIT_DECIDED",
    ),
    check(
      "late-signal-ignored",
      "종료된 Wait에 도착한 Signal이 무시되었다.",
      projection.signalStatus === "IGNORED" &&
        hasEvent(
          events,
          "GARDEN.SIGNAL_IGNORED",
          (event) =>
            eventPayloadIs(event, "reason", "WAIT_STEP_NOT_ACTIVE") &&
            eventPayloadIs(event, "deliveredToWait", false),
        ),
      "GARDEN.SIGNAL_IGNORED",
    ),
    check(
      "timeout-route-still-committed",
      "늦은 Signal 뒤에도 Runtime의 확정 경로는 timed-out이다.",
      hasEvent(
        events,
        "VERDANT.ROUTE_COMMITTED",
        (event) =>
          eventPayloadIs(event, "winner", "TIMEOUT") &&
          eventPayloadIs(event, "selectedPath", "timed-out"),
      ),
      "VERDANT.ROUTE_COMMITTED",
    ),
  ];
}

function evaluateBothAtDeadline(
  projection: VerdantProjection,
  events: readonly VerdantTraceEvent[],
): readonly VerdantObjectiveCheck[] {
  return [
    commonRouteCheck(projection),
    check(
      "both-evaluated-at-deadline",
      "두 조건을 ManualClock 30초의 같은 결정 tick에서 평가했다.",
      hasEvent(
        events,
        "GARDEN.TIME_ADVANCED",
        (event) =>
          event.logicalTimeMillis === 30_000 &&
          eventPayloadIs(event, "afterMillis", 30_000),
      ) &&
        hasEvent(
          events,
          "VERDANT.WAIT_EVALUATED",
          (event) =>
            event.logicalTimeMillis === 30_000 &&
            eventPayloadIs(event, "elapsedMillis", 30_000) &&
            eventPayloadIs(event, "signalPresent", true) &&
            eventPayloadIs(event, "timedOut", true),
        ),
      "GARDEN.TIME_ADVANCED",
      "VERDANT.WAIT_EVALUATED",
    ),
    check(
      "both-predicates-observed",
      "같은 Worker tick에서 Signal과 Timeout 조건이 모두 true였다.",
      projection.signalPresent === true &&
        projection.timedOut === true &&
        hasEvent(
          events,
          "VERDANT.WAIT_EVALUATED",
          (event) =>
            eventPayloadIs(event, "signalPresent", true) &&
            eventPayloadIs(event, "timedOut", true),
        ),
      "VERDANT.WAIT_EVALUATED",
    ),
    check(
      "mission-policy-recorded",
      "Runtime trace가 이 Step의 SIGNAL_THEN_TIMEOUT 정책을 기록했다.",
      projection.checkPrecedence === "SIGNAL_THEN_TIMEOUT" &&
        hasEvent(
          events,
          "VERDANT.WAIT_DECIDED",
          (event) =>
            eventPayloadIs(
              event,
              "checkPrecedence",
              "SIGNAL_THEN_TIMEOUT",
            ) && eventPayloadIs(event, "winner", "SIGNAL"),
        ),
      "VERDANT.WAIT_DECIDED",
    ),
    check(
      "timeout-rejected",
      "Signal 경로가 선택되어 Timeout 후보가 명시적으로 거절되었다.",
      projection.winner === "SIGNAL" &&
        projection.selectedPath === "yard-move" &&
        projection.timeoutStatus === "REJECTED" &&
        hasEvent(
          events,
          "VERDANT.TIMEOUT_REJECTED",
          (event) =>
            eventPayloadIs(event, "reason", "SIGNAL_PRECEDENCE") &&
            eventPayloadIs(event, "winner", "SIGNAL"),
        ),
      "VERDANT.TIMEOUT_REJECTED",
      "VERDANT.ROUTE_COMMITTED",
    ),
  ];
}

/**
 * Judges the learning objective from facts already recorded by Flower and its
 * World Projection. It does not compare clocks, choose a winner, or simulate a
 * transition.
 */
export function evaluateVerdantChallenge(
  challengeId: VerdantScenarioId,
  projection: VerdantProjection,
  events: readonly VerdantTraceEvent[],
): VerdantChallengeEvaluation {
  const checks =
    challengeId === "signal-at-29s"
      ? evaluateSignalAt29Seconds(projection, events)
      : challengeId === "timeout-then-late-signal"
        ? evaluateTimeoutThenLateSignal(projection, events)
        : evaluateBothAtDeadline(projection, events);

  const terminal =
    projection.phase === "FINISHED" || projection.phase === "FAILED";
  const passed = checks.every((candidate) => candidate.passed);
  const status: VerdantObjectiveStatus = !terminal
    ? "IN_PROGRESS"
    : passed
      ? "PASSED"
      : "FAILED";

  return {
    challengeId,
    status,
    terminal,
    checks,
    summary:
      status === "IN_PROGRESS"
        ? "아직 Runtime이 후속 경로를 확정하지 않았습니다."
        : status === "PASSED"
          ? "실제 Runtime trace가 이번 레벨의 목표를 증명했습니다."
          : "Runtime 실행은 끝났지만 이번 레벨의 목표와 다른 결과가 기록되었습니다.",
  };
}

export function gradeVerdantEvidenceAnswer(
  challengeId: VerdantScenarioId,
  answerId: VerdantEvidenceAnswerId,
): VerdantEvidenceGrade {
  const question = getVerdantLearningChallenge(challengeId).evidenceQuestion;
  return {
    challengeId,
    answerId,
    correct: answerId === question.correctAnswerId,
    explanation:
      answerId === question.correctAnswerId
        ? question.explanation
        : question.retryHint,
  };
}

/**
 * A finished Flower run is not by itself a cleared lesson. The trace-derived
 * objective and the player's evidence answer must both pass.
 */
export function isVerdantChallengeCleared(
  evaluation: VerdantChallengeEvaluation,
  answerId: VerdantEvidenceAnswerId | null | undefined,
): boolean {
  return (
    evaluation.status === "PASSED" &&
    answerId !== null &&
    answerId !== undefined &&
    gradeVerdantEvidenceAnswer(evaluation.challengeId, answerId).correct
  );
}
