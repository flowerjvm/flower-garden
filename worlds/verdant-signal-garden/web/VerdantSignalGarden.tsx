"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { projectVerdantSignal } from "../../../web/projection/verdantSignalProjection";
import {
  createVerdantCommand,
  evaluateVerdantChallenge,
  gradeVerdantEvidenceAnswer,
  normalizeVerdantCompletedIds,
  VERDANT_LEARNING_CHALLENGES,
  type VerdantActionId,
  type VerdantEvidenceAnswerId,
} from "./verdantLearningGame";
import {
  defaultVerdantRuntimeAdapter,
  normalizeVerdantTraceBundle,
} from "./verdantRuntime";
import type { VerdantFocus } from "./VerdantSignalScene";
import type {
  VerdantEvidence,
  VerdantProjection,
  VerdantRunSnapshot,
  VerdantRuntimeAdapter,
  VerdantScenarioId,
  VerdantTraceEvent,
} from "./types";
import styles from "./VerdantSignalGarden.module.css";

const VerdantSignalScene = lazy(() =>
  import("./VerdantSignalScene").then((module) => ({
    default: module.VerdantSignalScene,
  })),
);

type RunMode = "LIVE_RUNTIME" | "RECORDED_REPLAY";
type BusyAction = "STARTING" | "COMMAND" | null;
type ConditionPrediction = "NONE" | "SIGNAL" | "TIMEOUT" | "BOTH";
type RoutePrediction = "STAY" | "SIGNAL" | "TIMEOUT";

interface Notice {
  tone: "error" | "replay";
  title: string;
  body: string;
}

interface PredictionReceipt {
  condition: ConditionPrediction;
  route: RoutePrediction;
  actualCondition: ConditionPrediction;
  actualRoute: RoutePrediction;
  correct: boolean;
}

interface CommandReceipt {
  id: number;
  label: string;
  sequenceFrom: number;
  sequenceTo: number;
  summary: string;
}

const COMPLETED_STORAGE_KEY =
  "flower-garden:verdant-signal-garden:cleared-challenges";

const ACTION_COPY: Record<
  VerdantActionId,
  { icon: string; label: string; description: string }
> = {
  WORKER_TICK: {
    icon: "▶",
    label: "Worker tick 1회",
    description: "현재 Step 하나를 실제로 실행",
  },
  ADVANCE_29_SECONDS: {
    icon: "+29",
    label: "시계 +29초",
    description: "ManualClock만 이동",
  },
  ADVANCE_30_SECONDS: {
    icon: "+30",
    label: "시계 +30초",
    description: "deadline까지 ManualClock 이동",
  },
  SEND_YARD_SIGNAL: {
    icon: "⌁",
    label: "Yard Signal 보내기",
    description: "활성 Wait에 Signal 전달",
  },
};

const CONDITION_OPTIONS: Array<{
  value: ConditionPrediction;
  label: string;
  description: string;
}> = [
  { value: "NONE", label: "NONE", description: "둘 다 false" },
  { value: "SIGNAL", label: "SIGNAL", description: "Signal만 true" },
  { value: "TIMEOUT", label: "TIMEOUT", description: "Timeout만 true" },
  { value: "BOTH", label: "BOTH", description: "둘 다 true" },
];

const ROUTE_OPTIONS: Array<{
  value: RoutePrediction;
  label: string;
  description: string;
}> = [
  { value: "STAY", label: "STAY", description: "Wait에 머문다" },
  { value: "SIGNAL", label: "GOTO yard", description: "초록 경로" },
  { value: "TIMEOUT", label: "GOTO timeout", description: "주황 경로" },
];

const EDUCATION_EVIDENCE: readonly VerdantEvidence[] = [
  {
    type: "CONTRACT",
    ref: "mission-policy:SIGNAL_THEN_TIMEOUT",
    label:
      "SIGNAL_THEN_TIMEOUT은 Flower 전체 규칙이 아니라 이 Wait Step이 명시한 정책입니다.",
  },
  {
    type: "CONTRACT",
    ref: "flower-app-guide:events-and-waits",
    label:
      "Signal은 전이 명령이 아닙니다. 다음 Worker tick에서 Step이 사실을 확인합니다.",
  },
  {
    type: "CONTRACT",
    ref: "trace-contract:sequence",
    label:
      "3D 장면은 sequence 순서의 runtime event만 투영하며 승자를 계산하지 않습니다.",
  },
];

const FOCUS_COPY: Record<
  VerdantFocus,
  { eyebrow: string; title: string; body: string }
> = {
  wait: {
    eyebrow: "WAIT STEP",
    title: "wait-for-yard-assignment",
    body:
      "Signal과 deadline은 경로를 직접 바꾸지 않습니다. Worker tick에서 이 Step이 두 사실을 읽고 StepResult를 반환합니다.",
  },
  signal: {
    eyebrow: "SIGNAL INPUT",
    title: "yard-assignment",
    body:
      "Signal을 보내도 Flow는 즉시 이동하지 않습니다. 활성 Wait가 받은 사실을 다음 Worker tick이 관찰합니다.",
  },
  timeout: {
    eyebrow: "MANUAL CLOCK",
    title: "30,000 ms deadline",
    body:
      "시계가 deadline에 도착해도 경로는 아직 정해지지 않습니다. Step이 다음 tick에서 timedOut을 관찰합니다.",
  },
  routes: {
    eyebrow: "STEPRESULT ROUTE",
    title: "yard-move / timed-out",
    body:
      "실제 trace에 기록된 GOTO와 ROUTE_COMMITTED만 문을 엽니다. 3D 장면은 경로를 선택하지 않습니다.",
  },
};

export interface VerdantSignalGardenProps {
  runtime?: VerdantRuntimeAdapter;
  recordedBundles?: Partial<Record<VerdantScenarioId, unknown>>;
  homeHref?: string;
  previousHref?: string;
  nextHref?: string;
  className?: string;
}

function joinClasses(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

function lastSequence(run: VerdantRunSnapshot): number {
  return run.events.at(-1)?.sequence ?? 0;
}

function acceptCumulativeTrace(
  previous: readonly VerdantTraceEvent[],
  incoming: readonly VerdantTraceEvent[],
  runId: string,
): VerdantTraceEvent[] {
  if (incoming.length < previous.length) {
    throw new Error("Runtime trace cannot shrink.");
  }
  for (let index = 0; index < incoming.length; index += 1) {
    if (incoming[index].runId !== runId) {
      throw new Error("Runtime returned events from a different run.");
    }
    if (
      index < previous.length &&
      JSON.stringify(incoming[index]) !== JSON.stringify(previous[index])
    ) {
      throw new Error("The immutable trace prefix changed.");
    }
  }
  return [...incoming];
}

function formatMillis(value: number): string {
  const totalSeconds = Math.floor(value / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = value % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}.${String(millis).padStart(3, "0")}`;
}

function eventSummary(event: VerdantTraceEvent): string {
  switch (event.kind) {
    case "GARDEN.RUN_CREATED":
      return "실제 Engine과 수동 Worker 실행이 생성되었습니다.";
    case "GARDEN.FLOW_READY":
      return "Flow가 READY 상태로 첫 Worker tick을 기다립니다.";
    case "GARDEN.TICK_REQUESTED":
      return "Worker.tickOnce()를 정확히 한 번 요청했습니다.";
    case "GARDEN.TICK_COMPLETED":
      return "한 번의 Worker tick 경계가 닫혔습니다.";
    case "FLOWER.FLOW_SUBMITTED":
      return "Flower가 제출된 Flow를 관찰했습니다.";
    case "FLOWER.STEP_ENTERED":
      return `${event.flow?.stepId ?? "Step"}에 진입했습니다.`;
    case "FLOWER.STEP_RESULT":
      return `${event.flow?.stepId ?? "Step"}이 ${String(
        event.payload.result ?? "StepResult",
      )}를 반환했습니다.`;
    case "FLOWER.STEP_EXITED":
      return `${event.flow?.stepId ?? "Step"}이 종료되었습니다.`;
    case "FLOWER.FLOW_FINISHED":
      return "Flower가 Flow를 FINISHED로 확정했습니다.";
    case "FLOWER.FLOW_FAILED":
      return "Flower가 Flow 실패를 기록했습니다.";
    case "FLOWER.FLOW_CANCELLED":
      return "Flower가 Flow 취소를 기록했습니다.";
    case "VERDANT.WAIT_STARTED":
      return "Wait가 Signal 이름과 30초 deadline을 등록했습니다.";
    case "VERDANT.WAIT_EVALUATED":
      return `Wait가 signalPresent=${String(
        event.payload.signalPresent,
      )}, timedOut=${String(event.payload.timedOut)}를 관찰했습니다.`;
    case "VERDANT.WAIT_DECIDED":
      return `앱 정책이 승자 ${String(event.payload.winner)}와 경로 ${String(
        event.payload.selectedPath,
      )}를 결정했습니다.`;
    case "VERDANT.TIMEOUT_REJECTED":
      return "둘 다 true인 tick에서 이 Step의 Signal 우선 정책이 Timeout을 거절했습니다.";
    case "VERDANT.ROUTE_COMMITTED":
      return `Flower가 ${String(event.payload.selectedPath)} 경로를 확정했습니다.`;
    case "GARDEN.TIME_ADVANCE_REQUESTED":
      return "ManualClock 이동을 요청했습니다.";
    case "GARDEN.TIME_ADVANCED":
      return `ManualClock이 ${formatMillis(event.logicalTimeMillis)}가 되었습니다.`;
    case "GARDEN.SIGNAL_SEND_REQUESTED":
      return "yard-assignment Signal 전달을 요청했습니다.";
    case "FLOWER.SIGNAL_RECEIVED":
      return "활성 Wait가 Signal을 수신했습니다.";
    case "GARDEN.SIGNAL_SENT":
      return "Signal 전달이 완료되었습니다. Flow는 아직 Wait입니다.";
    case "GARDEN.SIGNAL_IGNORED":
      return "이미 종료된 Wait이므로 늦은 Signal이 무시되었습니다.";
    default:
      return "이 이벤트는 기록되지만 Verdant 장면 상태를 변경하지 않습니다.";
  }
}

function runtimeLabel(mode: RunMode | null): string {
  if (mode === "LIVE_RUNTIME") return "LIVE · 실제 Flower Runtime";
  if (mode === "RECORDED_REPLAY") return "REPLAY · 관찰 전용";
  return "Runtime 연결 전";
}

function observedCondition(
  event: VerdantTraceEvent,
): ConditionPrediction {
  const signal = event.payload.signalPresent === true;
  const timeout = event.payload.timedOut === true;
  if (signal && timeout) return "BOTH";
  if (signal) return "SIGNAL";
  if (timeout) return "TIMEOUT";
  return "NONE";
}

function observedRoute(event: VerdantTraceEvent): RoutePrediction {
  if (event.payload.winner === "SIGNAL") return "SIGNAL";
  if (event.payload.winner === "TIMEOUT") return "TIMEOUT";
  return "STAY";
}

function causalFeedback(
  actionId: VerdantActionId,
  delta: readonly VerdantTraceEvent[],
  projection: VerdantProjection,
): string {
  if (delta.some((event) => event.kind === "GARDEN.SIGNAL_IGNORED")) {
    return "Signal은 전송됐지만 Wait가 이미 끝나 있어 무시됐습니다. 종료된 Wait는 다시 열리지 않습니다.";
  }
  if (actionId === "SEND_YARD_SIGNAL") {
    return "Signal이 활성 Wait에 도착했습니다. 아직 경로는 바뀌지 않았습니다. 다음 Worker tick에서 Step이 확인합니다.";
  }
  if (
    actionId === "ADVANCE_29_SECONDS" ||
    actionId === "ADVANCE_30_SECONDS"
  ) {
    return `시계만 ${formatMillis(projection.clockMillis)}로 이동했습니다. Timeout 경로는 아직 선택되지 않았습니다.`;
  }
  if (delta.some((event) => event.kind === "VERDANT.WAIT_STARTED")) {
    return "Wait Step이 시작됐습니다. 이제 시간과 Signal을 직접 조작한 뒤 다음 tick을 예측하세요.";
  }
  if (delta.some((event) => event.kind === "VERDANT.ROUTE_COMMITTED")) {
    return "선택된 경로 Step이 이번 tick에 실행됐고 실제 Runtime이 Flow를 FINISHED로 확정했습니다.";
  }
  if (delta.some((event) => event.kind === "VERDANT.WAIT_DECIDED")) {
    return `Wait Step이 ${projection.decisionStepResult ?? "GOTO"} → ${
      projection.decisionTargetStepId ?? "후속 Step"
    }을 반환했습니다. 경로 Step은 아직 실행되지 않았으므로 tick이 한 번 더 필요합니다.`;
  }
  if (delta.some((event) => event.kind === "VERDANT.WAIT_EVALUATED")) {
    return "두 조건이 아직 경로를 결정하지 못해 StepResult.STAY가 기록됐습니다. Wait는 계속 활성 상태입니다.";
  }
  return "실제 Runtime 응답을 받았고 새 trace 구간만 3D 세계에 반영했습니다.";
}

function readStoredProgress(): VerdantScenarioId[] {
  try {
    const raw = globalThis.localStorage?.getItem(COMPLETED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeVerdantCompletedIds(parsed);
  } catch {
    return [];
  }
}

export function VerdantSignalGarden({
  runtime = defaultVerdantRuntimeAdapter,
  recordedBundles,
  homeHref = "/",
  previousHref = "/worlds/first-bloom-meadow",
  nextHref,
  className,
}: VerdantSignalGardenProps) {
  const [scenarioId, setScenarioId] =
    useState<VerdantScenarioId>("signal-at-29s");
  const [completedIds, setCompletedIds] = useState<VerdantScenarioId[]>([]);
  const [conditionPrediction, setConditionPrediction] =
    useState<ConditionPrediction | null>(null);
  const [routePrediction, setRoutePrediction] =
    useState<RoutePrediction | null>(null);
  const [lastPrediction, setLastPrediction] =
    useState<PredictionReceipt | null>(null);
  const [predictionAttempts, setPredictionAttempts] = useState({
    correct: 0,
    total: 0,
  });
  const [evidenceAnswerId, setEvidenceAnswerId] =
    useState<VerdantEvidenceAnswerId | null>(null);
  const [evidenceFeedback, setEvidenceFeedback] = useState<string | null>(
    null,
  );
  const [run, setRun] = useState<VerdantRunSnapshot | null>(null);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [events, setEvents] = useState<VerdantTraceEvent[]>([]);
  const [availableCursor, setAvailableCursor] = useState(0);
  const [viewCursor, setViewCursor] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focus, setFocus] = useState<VerdantFocus>("wait");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [commandHistory, setCommandHistory] = useState<CommandReceipt[]>(
    [],
  );

  const challenge =
    VERDANT_LEARNING_CHALLENGES.find((item) => item.id === scenarioId) ??
    VERDANT_LEARNING_CHALLENGES[0];
  const challengeIndex = VERDANT_LEARNING_CHALLENGES.findIndex(
    (item) => item.id === scenarioId,
  );
  const projection = useMemo(
    () => projectVerdantSignal(events, viewCursor),
    [events, viewCursor],
  );
  const finalProjection = useMemo(
    () => projectVerdantSignal(events, availableCursor),
    [availableCursor, events],
  );
  const evaluation = useMemo(
    () =>
      evaluateVerdantChallenge(
        scenarioId,
        finalProjection,
        events.slice(0, availableCursor),
      ),
    [availableCursor, events, finalProjection, scenarioId],
  );
  const waitStarted = events
    .slice(0, availableCursor)
    .some((event) => event.kind === "VERDANT.WAIT_STARTED");
  const terminal =
    finalProjection.phase === "FINISHED" ||
    finalProjection.phase === "FAILED";
  const lessonCleared = completedIds.includes(scenarioId);
  const isPlaying = autoPlay && viewCursor < availableCursor;
  const replayComplete =
    mode === "RECORDED_REPLAY" &&
    availableCursor > 0 &&
    viewCursor >= availableCursor;

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setCompletedIds(readStoredProgress()),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timeout = window.setTimeout(
      () =>
        setViewCursor((current) =>
          Math.min(current + 1, availableCursor),
        ),
      reducedMotion ? 0 : 120,
    );
    return () => window.clearTimeout(timeout);
  }, [availableCursor, isPlaying, reducedMotion, viewCursor]);

  function isChallengeUnlocked(index: number): boolean {
    if (index === 0) return true;
    return VERDANT_LEARNING_CHALLENGES.slice(0, index).every((item) =>
      completedIds.includes(item.id),
    );
  }

  function persistCompleted(next: VerdantScenarioId[]) {
    setCompletedIds(next);
    try {
      globalThis.localStorage?.setItem(
        COMPLETED_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      // Progress still remains valid for this browser session.
    }
  }

  async function startRun() {
    if (busyAction) return;
    setBusyAction("STARTING");
    setNotice(null);
    setLastFeedback(null);

    try {
      const nextRun = await runtime.createRun();
      setRun(nextRun);
      setMode("LIVE_RUNTIME");
      setEvents([...nextRun.events]);
      setAvailableCursor(nextRun.events.length);
      setViewCursor(nextRun.events.length);
      setFocus("wait");
      setLastFeedback(
        "Flow가 READY입니다. 먼저 Worker tick을 한 번 눌러 Wait Step을 시작하세요.",
      );
    } catch {
      const bundle = recordedBundles?.[scenarioId];
      if (bundle === undefined) {
        setNotice({
          tone: "error",
          title: "Flower Runtime에 연결하지 못했습니다",
          body:
            "PLAY.cmd를 실행한 창을 닫지 말고 다시 시도해 주세요. 브라우저가 결과를 대신 계산하지 않습니다.",
        });
      } else {
        try {
          const recordedRun = normalizeVerdantTraceBundle(
            bundle,
            scenarioId,
          );
          setRun(recordedRun);
          setMode("RECORDED_REPLAY");
          setEvents([...recordedRun.events]);
          setAvailableCursor(0);
          setViewCursor(0);
          setNotice({
            tone: "replay",
            title: "Runtime이 없어 관찰 전용 기록을 열었습니다",
            body:
              "이 기록은 실제 Runtime에서 생성됐지만 조작하거나 미션을 통과할 수 없습니다. PLAY.cmd로 Runtime을 켜면 직접 플레이할 수 있습니다.",
          });
        } catch {
          setNotice({
            tone: "error",
            title: "기록을 검증하지 못했습니다",
            body:
              "Canonical trace가 엄격한 runtime 계약과 일치하지 않아 재생을 중단했습니다.",
          });
        }
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function issueOneCommand(actionId: VerdantActionId) {
    if (
      !run ||
      mode !== "LIVE_RUNTIME" ||
      busyAction ||
      terminal ||
      !canIssueAction(actionId)
    ) {
      return;
    }

    setBusyAction("COMMAND");
    setNotice(null);
    const beforeCount = events.length;
    const beforeSequence = lastSequence(run);

    try {
      const nextRun = await runtime.sendCommand(
        run.runId,
        beforeSequence,
        createVerdantCommand(actionId),
      );
      const acceptedEvents = acceptCumulativeTrace(
        events,
        nextRun.events,
        run.runId,
      );
      const delta = acceptedEvents.slice(beforeCount);
      const nextProjection = projectVerdantSignal(
        acceptedEvents,
        acceptedEvents.length,
      );
      const summary = causalFeedback(actionId, delta, nextProjection);

      setRun(nextRun);
      setEvents(acceptedEvents);
      setAvailableCursor(acceptedEvents.length);
      setViewCursor(acceptedEvents.length);
      setAutoPlay(false);
      setLastFeedback(summary);
      setCommandHistory((history) => [
        ...history,
        {
          id: history.length + 1,
          label: ACTION_COPY[actionId].label,
          sequenceFrom: beforeSequence + 1,
          sequenceTo: acceptedEvents.at(-1)?.sequence ?? beforeSequence,
          summary,
        },
      ]);

      if (actionId === "WORKER_TICK") {
        const evaluated = [...delta]
          .reverse()
          .find((event) => event.kind === "VERDANT.WAIT_EVALUATED");
        if (
          evaluated &&
          conditionPrediction !== null &&
          routePrediction !== null
        ) {
          const actualCondition = observedCondition(evaluated);
          const actualRoute = observedRoute(evaluated);
          const correct =
            actualCondition === conditionPrediction &&
            actualRoute === routePrediction;
          setLastPrediction({
            condition: conditionPrediction,
            route: routePrediction,
            actualCondition,
            actualRoute,
            correct,
          });
          setPredictionAttempts((score) => ({
            correct: score.correct + (correct ? 1 : 0),
            total: score.total + 1,
          }));
          setConditionPrediction(null);
          setRoutePrediction(null);
        }
      }
    } catch {
      setNotice({
        tone: "error",
        title: "명령을 실행하지 못했습니다",
        body:
          "성공한 trace prefix는 그대로 보존했습니다. Runtime 창이 실행 중인지 확인한 뒤 새 실행으로 다시 시도해 주세요.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function canIssueAction(actionId: VerdantActionId): boolean {
    if (
      !run ||
      mode !== "LIVE_RUNTIME" ||
      busyAction !== null ||
      terminal ||
      isPlaying ||
      viewCursor !== availableCursor ||
      !challenge.availableActionIds.includes(actionId)
    ) {
      return false;
    }
    if (!waitStarted) return actionId === "WORKER_TICK";
    if (
      actionId === "ADVANCE_29_SECONDS" ||
      actionId === "ADVANCE_30_SECONDS"
    ) {
      return finalProjection.waitStatus === "WAITING";
    }
    if (
      actionId === "WORKER_TICK" &&
      finalProjection.waitStatus === "WAITING"
    ) {
      return (
        conditionPrediction !== null && routePrediction !== null
      );
    }
    return true;
  }

  function resetRun(nextScenarioId = scenarioId) {
    setScenarioId(nextScenarioId);
    setConditionPrediction(null);
    setRoutePrediction(null);
    setLastPrediction(null);
    setPredictionAttempts({ correct: 0, total: 0 });
    setEvidenceAnswerId(null);
    setEvidenceFeedback(null);
    setRun(null);
    setMode(null);
    setEvents([]);
    setAvailableCursor(0);
    setViewCursor(0);
    setAutoPlay(false);
    setBusyAction(null);
    setNotice(null);
    setFocus("wait");
    setEvidenceOpen(false);
    setLastFeedback(null);
    setCommandHistory([]);
  }

  function selectScenario(nextScenarioId: VerdantScenarioId) {
    const index = VERDANT_LEARNING_CHALLENGES.findIndex(
      (item) => item.id === nextScenarioId,
    );
    if (run || !isChallengeUnlocked(index)) return;
    setScenarioId(nextScenarioId);
    setNotice(null);
  }

  function answerEvidence(answerId: VerdantEvidenceAnswerId) {
    setEvidenceAnswerId(answerId);
    const result = gradeVerdantEvidenceAnswer(scenarioId, answerId);
    setEvidenceFeedback(result.explanation);
    if (!result.correct || evaluation.status !== "PASSED") return;

    const next = completedIds.includes(scenarioId)
      ? completedIds
      : [...completedIds, scenarioId];
    persistCompleted(next);
  }

  function openRecordedReplay() {
    if (mode !== "RECORDED_REPLAY") return;
    setAvailableCursor(events.length);
    if (reducedMotion) {
      setViewCursor(events.length);
    } else {
      setViewCursor(0);
      setAutoPlay(true);
    }
  }

  function scrubTo(cursor: number) {
    setAutoPlay(false);
    setViewCursor(Math.max(0, Math.min(cursor, availableCursor)));
  }

  function togglePlayback() {
    if (viewCursor >= availableCursor) {
      setViewCursor(0);
      setAutoPlay(true);
      return;
    }
    setAutoPlay((playing) => !playing);
  }

  const activeEvent = projection.activeEvent;
  const visibleEvents = events.slice(0, viewCursor);
  const evidence = [
    ...(activeEvent?.evidence ?? []),
    ...(run?.evidence ?? []),
    ...EDUCATION_EVIDENCE,
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.ref === item.ref) === index,
  );
  const focusCopy = FOCUS_COPY[focus];
  const conceptActive = [
    projection.signalStatus !== "IDLE",
    projection.timeoutStatus !== "IDLE",
    projection.waitStatus !== "IDLE",
    Boolean(projection.lastStepResult),
    projection.routeCommitted,
  ];
  const nextChallenge = VERDANT_LEARNING_CHALLENGES[challengeIndex + 1];

  return (
    <main
      className={joinClasses(styles.shell, className)}
      aria-labelledby="verdant-mission-title"
    >
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href={homeHref}
          aria-label="Flower Garden 월드 선택"
        >
          <span className={styles.brandMark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>Flower Garden</strong>
            <small>실행하며 배우는 Flower microworld</small>
          </span>
        </Link>
        <div
          className={joinClasses(
            styles.runtimeBadge,
            mode === "LIVE_RUNTIME" && styles.live,
            mode === "RECORDED_REPLAY" && styles.replay,
          )}
          role="status"
        >
          <i aria-hidden="true" />
          <span>{runtimeLabel(mode)}</span>
          {run && <small>v{run.flowerRuntimeVersion}</small>}
        </div>
      </header>

      <nav className={styles.crumbs} aria-label="현재 학습 위치">
        <Link href={previousHref}>01 First Bloom Meadow</Link>
        <span aria-hidden="true">/</span>
        <strong>02 Verdant Signal Garden</strong>
        <span aria-hidden="true">/</span>
        <span>Signal vs Timeout</span>
      </nav>

      <section className={styles.conceptRibbon} aria-label="이번 미션의 실행 계약">
        {[
          ["Signal", "사실 전달"],
          ["Timeout", "deadline 조건"],
          ["Wait Step", "두 사실 관찰"],
          [
            "StepResult",
            projection.decisionStepResult ??
              projection.lastStepResult ??
              "STAY / GOTO",
          ],
          ["Route", projection.selectedPath ?? "아직 없음"],
        ].map(([term, description], index) => (
          <div
            key={term}
            className={joinClasses(
              styles.conceptNode,
              conceptActive[index] && styles.active,
            )}
          >
            <span>{term}</span>
            <small>{description}</small>
          </div>
        ))}
      </section>

      {notice && (
        <div
          className={joinClasses(
            styles.notice,
            notice.tone === "replay" && styles.replayNotice,
          )}
          role="status"
        >
          <strong>{notice.title}</strong>
          <span>{notice.body}</span>
        </div>
      )}

      <section className={styles.workspace}>
        <aside className={styles.missionPanel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>MISSION 02</p>
              <h1 id="verdant-mission-title">Signal vs Timeout</h1>
            </div>
            <span className={styles.difficulty}>직접 조작</span>
          </div>

          <p className={styles.missionIntro}>
            당신은 실제 Flower Worker를 한 번씩 움직입니다. 시간과 Signal을
            조작하고, 다음 tick의 조건과 StepResult를 맞힌 뒤 trace로
            이유를 증명하세요.
          </p>

          <div className={styles.ruleCallout}>
            <strong>게임의 한 가지 규칙</strong>
            <p>
              버튼 하나는 Runtime 명령 하나만 보냅니다. 3D 세계는 응답
              trace가 돌아온 뒤에만 바뀝니다.{" "}
              <code>SIGNAL_THEN_TIMEOUT</code>은 이 미션 Step의 정책입니다.
            </p>
          </div>

          <div className={styles.curriculumProgress}>
            <span>
              학습 진행
              <strong>
                {completedIds.length}/{VERDANT_LEARNING_CHALLENGES.length}
              </strong>
            </span>
            <div aria-hidden="true">
              <i
                style={{
                  width: `${
                    (completedIds.length /
                      VERDANT_LEARNING_CHALLENGES.length) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>

          {!run ? (
            <>
              <fieldset className={styles.scenarioPicker}>
                <legend>도전 과제 선택</legend>
                {VERDANT_LEARNING_CHALLENGES.map((item, index) => {
                  const unlocked = isChallengeUnlocked(index);
                  const complete = completedIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={joinClasses(
                        styles.scenarioCard,
                        scenarioId === item.id && styles.selected,
                        !unlocked && styles.locked,
                        complete && styles.complete,
                      )}
                      onClick={() => selectScenario(item.id)}
                      disabled={!unlocked}
                      aria-pressed={scenarioId === item.id}
                    >
                      <span>
                        {complete ? "✓" : unlocked ? index + 1 : "🔒"}
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {complete
                            ? "계약 확인 완료"
                            : unlocked
                              ? item.briefing
                              : "이전 도전을 먼저 완료하세요"}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </fieldset>
              <div className={styles.scenarioBrief}>
                <small>이번 목표</small>
                <strong>{challenge.title}</strong>
                <p>{challenge.objective}</p>
              </div>
              <button
                className={styles.primaryAction}
                type="button"
                onClick={startRun}
                disabled={busyAction !== null}
              >
                {busyAction === "STARTING"
                  ? "실제 Runtime에 연결하는 중…"
                  : "새 실제 실행 만들기"}
              </button>
              <p className={styles.controlGuard}>
                시작해도 자동으로 진행되지 않습니다. 첫 Worker tick부터
                당신이 직접 누릅니다.
              </p>
            </>
          ) : mode === "RECORDED_REPLAY" ? (
            <div className={styles.replayLesson}>
              <p className={styles.eyebrow}>OBSERVE ONLY</p>
              <h2>이 기록은 플레이가 아닙니다</h2>
              <p>
                실제 Runtime에서 만든 정답 trace를 관찰할 수 있지만 학습
                완료로 기록되지는 않습니다.
              </p>
              <button
                className={styles.tickAction}
                type="button"
                onClick={openRecordedReplay}
                disabled={isPlaying || replayComplete}
              >
                <span aria-hidden="true">▶</span>
                <span>
                  <strong>
                    {isPlaying
                      ? "기록 재생 중…"
                      : replayComplete
                        ? "관찰 완료"
                        : "기록된 실행 관찰"}
                  </strong>
                  <small>canonical trace cursor만 이동</small>
                </span>
              </button>
              <button
                type="button"
                className={styles.textAction}
                onClick={() => resetRun()}
              >
                Runtime 연결 다시 시도
              </button>
            </div>
          ) : terminal ? (
            evaluation.status === "PASSED" ? (
              lessonCleared ? (
                <div className={joinClasses(styles.resultCard, styles.correct)}>
                  <p className={styles.eyebrow}>LESSON CLEARED</p>
                  <h2>Runtime 완료 + 근거 확인 완료</h2>
                  <p>{evaluation.summary}</p>
                  <p className={styles.contractResult}>
                    Flower가 기록한 실행 결과와 당신이 고른 근거가 모두
                    일치합니다.
                  </p>
                  {nextChallenge ? (
                    <button
                      className={styles.secondaryAction}
                      type="button"
                      onClick={() => resetRun(nextChallenge.id)}
                    >
                      다음 도전 열기
                    </button>
                  ) : (
                    <button
                      className={styles.secondaryAction}
                      type="button"
                      onClick={() => resetRun()}
                    >
                      자유롭게 다시 실험
                    </button>
                  )}
                </div>
              ) : (
                <div className={styles.proofCard}>
                  <p className={styles.eyebrow}>
                    RUNTIME FINISHED · LESSON NOT YET CLEARED
                  </p>
                  <h2>마지막으로 근거를 고르세요</h2>
                  <p>{challenge.evidenceQuestion.prompt}</p>
                  <div className={styles.proofOptions}>
                    {challenge.evidenceQuestion.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={joinClasses(
                          styles.proofOption,
                          evidenceAnswerId === option.id && styles.selected,
                        )}
                        onClick={() => answerEvidence(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {evidenceFeedback && (
                    <p
                      className={joinClasses(
                        styles.proofFeedback,
                        evidenceAnswerId &&
                          gradeVerdantEvidenceAnswer(
                            scenarioId,
                            evidenceAnswerId,
                          ).correct
                          ? styles.correct
                          : styles.incorrect,
                      )}
                      role="status"
                    >
                      {evidenceFeedback}
                    </p>
                  )}
                </div>
              )
            ) : (
              <div className={joinClasses(styles.resultCard, styles.failed)}>
                <p className={styles.eyebrow}>MISSION FAILED</p>
                <h2>Flow는 끝났지만 목표 경로가 아닙니다</h2>
                <p>{evaluation.summary}</p>
                <ul className={styles.checkList}>
                  {evaluation.checks.map((check) => (
                    <li
                      key={check.id}
                      className={check.passed ? styles.pass : styles.fail}
                    >
                      <span>{check.passed ? "✓" : "×"}</span>
                      {check.label}
                    </li>
                  ))}
                </ul>
                <button
                  className={styles.secondaryAction}
                  type="button"
                  onClick={() => resetRun()}
                >
                  같은 도전 다시 시작
                </button>
              </div>
            )
          ) : (
            <>
              <div className={styles.activeScenario}>
                <span>
                  도전 {challengeIndex + 1}/
                  {VERDANT_LEARNING_CHALLENGES.length}
                </span>
                <strong>{challenge.title}</strong>
                <small>{challenge.objective}</small>
              </div>

              {!waitStarted ? (
                <div className={styles.nextInstruction}>
                  <span>1</span>
                  <p>
                    <strong>먼저 Wait Step을 시작하세요.</strong>
                    지금은 Flow가 READY입니다. Worker tick 한 번이 현재 Step을
                    실행합니다.
                  </p>
                </div>
              ) : finalProjection.waitStatus === "WAITING" ? (
                <div className={styles.predictionWorkbench}>
                  <p className={styles.eyebrow}>BEFORE THE NEXT TICK</p>
                  <h2>다음 tick을 먼저 예측하세요</h2>
                  <fieldset className={styles.compactPrediction}>
                    <legend>① Step이 관찰할 조건</legend>
                    <div>
                      {CONDITION_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            conditionPrediction === option.value
                              ? styles.selected
                              : undefined
                          }
                          onClick={() =>
                            setConditionPrediction(option.value)
                          }
                          aria-pressed={
                            conditionPrediction === option.value
                          }
                        >
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className={styles.compactPrediction}>
                    <legend>② StepResult / 경로</legend>
                    <div>
                      {ROUTE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            routePrediction === option.value
                              ? styles.selected
                              : undefined
                          }
                          onClick={() => setRoutePrediction(option.value)}
                          aria-pressed={routePrediction === option.value}
                        >
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <p className={styles.predictionHint}>
                    두 답을 고르기 전에는 Worker tick이 잠깁니다. Signal과
                    시계는 계속 조작해 예측을 바꿀 수 있습니다.
                  </p>
                </div>
              ) : (
                <div className={styles.nextInstruction}>
                  <span>2</span>
                  <p>
                    <strong>경로는 선택됐지만 아직 실행 전입니다.</strong>
                    {scenarioId === "timeout-then-late-signal"
                      ? " 늦은 Signal을 보내 무시되는지 확인한 뒤 마지막 tick을 누르세요."
                      : " Worker tick을 한 번 더 눌러 선택된 경로 Step을 실행하세요."}
                  </p>
                </div>
              )}

              {lastPrediction && (
                <div
                  className={joinClasses(
                    styles.predictionReceipt,
                    lastPrediction.correct
                      ? styles.correct
                      : styles.incorrect,
                  )}
                  role="status"
                >
                  <strong>
                    {lastPrediction.correct
                      ? "예측 일치"
                      : "예측과 실제 trace가 다릅니다"}
                  </strong>
                  <span>
                    예상 {lastPrediction.condition} /{" "}
                    {lastPrediction.route} → 실제{" "}
                    {lastPrediction.actualCondition} /{" "}
                    {lastPrediction.actualRoute}
                  </span>
                </div>
              )}

              <section
                className={styles.actionConsole}
                aria-label="실제 Runtime 명령"
              >
                <div>
                  <p className={styles.eyebrow}>YOUR CONTROLS</p>
                  <span>
                    예측 {predictionAttempts.correct}/
                    {predictionAttempts.total}
                  </span>
                </div>
                {viewCursor !== availableCursor && (
                  <p className={styles.controlGuard} role="status">
                    과거 Trace를 보는 동안 명령이 잠깁니다. cursor를 최신
                    이벤트로 이동해야 다음 명령을 실행할 수 있습니다.
                  </p>
                )}
                <div className={styles.actionGrid}>
                  {challenge.availableActionIds.map((actionId) => {
                    const copy = ACTION_COPY[actionId];
                    return (
                      <button
                        key={actionId}
                        type="button"
                        className={joinClasses(
                          styles.actionButton,
                          actionId === "WORKER_TICK" &&
                            styles.workerAction,
                        )}
                        onClick={() => issueOneCommand(actionId)}
                        disabled={!canIssueAction(actionId)}
                      >
                        <span aria-hidden="true">{copy.icon}</span>
                        <span>
                          <strong>{copy.label}</strong>
                          <small>{copy.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {lastFeedback && (
                <div className={styles.causalFeedback} aria-live="polite">
                  <span>방금 일어난 일</span>
                  <p>{lastFeedback}</p>
                </div>
              )}

              {commandHistory.length > 0 && (
                <ol className={styles.commandHistory}>
                  {commandHistory.slice(-4).map((receipt) => (
                    <li key={receipt.id}>
                      <span>{receipt.id}</span>
                      <p>
                        <strong>{receipt.label}</strong>
                        <small>
                          trace {receipt.sequenceFrom}–
                          {receipt.sequenceTo}
                        </small>
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              <button
                type="button"
                className={styles.textAction}
                onClick={() => resetRun()}
                disabled={busyAction !== null}
              >
                이 실행 포기하고 다시 시작
              </button>
            </>
          )}
        </aside>

        <section className={styles.worldStage} aria-label="Verdant Signal Garden 3D 투영">
          <Suspense
            fallback={
              <div className={styles.worldLoading} role="status">
                <span aria-hidden="true" />
                <p>Verdant Garden을 불러오는 중…</p>
              </div>
            }
          >
            <VerdantSignalScene
              projection={projection}
              reducedMotion={reducedMotion}
              focus={focus}
              onFocus={setFocus}
            />
          </Suspense>

          <div className={styles.stageStatus}>
            <i
              className={styles[`phase${projection.phase}`]}
              aria-hidden="true"
            />
            <span>
              <small>FLOW STATE</small>
              <strong>{projection.phase}</strong>
            </span>
            <b aria-hidden="true" />
            <span>
              <small>MANUAL CLOCK</small>
              <strong>{formatMillis(projection.clockMillis)}</strong>
            </span>
          </div>

          <div
            className={joinClasses(
              styles.sourceStamp,
              mode === "RECORDED_REPLAY" && styles.replay,
            )}
          >
            {mode === "RECORDED_REPLAY"
              ? "RECORDED PROJECTION"
              : mode === "LIVE_RUNTIME"
                ? "LIVE PROJECTION"
                : "AWAITING TRACE"}
          </div>

          <div className={styles.focusTabs} role="group" aria-label="장면 설명 선택">
            {(
              [
                ["wait", "Wait"],
                ["signal", "Signal"],
                ["timeout", "Clock"],
                ["routes", "Routes"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={focus === value ? styles.selected : undefined}
                onClick={() => setFocus(value)}
                aria-pressed={focus === value}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.inspector}>
            <p>{focusCopy.eyebrow}</p>
            <strong>{focusCopy.title}</strong>
            <span>{focusCopy.body}</span>
          </div>

          <p className={styles.accessibleWorldState} aria-live="polite">
            Flow {projection.phase}. 현재 Step{" "}
            {projection.currentStepId ?? "없음"}. 시간{" "}
            {formatMillis(projection.clockMillis)}. Signal{" "}
            {projection.signalStatus}. Timeout {projection.timeoutStatus}. 승자{" "}
            {projection.winner ?? "아직 없음"}.
          </p>
        </section>

        <aside className={styles.tracePanel}>
          <div className={styles.traceHeading}>
            <div>
              <p className={styles.eyebrow}>RUNTIME TRACE</p>
              <h2>{evidenceOpen ? "근거" : "실행 기록"}</h2>
            </div>
            <button
              type="button"
              onClick={() => setEvidenceOpen((open) => !open)}
              aria-pressed={evidenceOpen}
            >
              {evidenceOpen ? "Trace 보기" : `근거 ${evidence.length}`}
            </button>
          </div>

          {evidenceOpen ? (
            <div className={styles.evidenceList}>
              <p>
                설명은 현재 이벤트가 가리키는 계약·소스·테스트를 우선합니다.
              </p>
              {evidence.map((item) => (
                <article key={item.ref} className={styles.evidenceCard}>
                  <span>{item.type}</span>
                  <h3>{item.label}</h3>
                  <code>{item.ref}</code>
                </article>
              ))}
            </div>
          ) : (
            <ol className={styles.traceList}>
              {visibleEvents.length === 0 ? (
                <li className={styles.traceEmpty}>
                  새 실행을 만들면 runtime event가 sequence 순서로
                  나타납니다.
                </li>
              ) : (
                visibleEvents.map((event, index) => (
                  <li
                    key={event.eventId}
                    className={
                      viewCursor === index + 1 ? styles.activeTrace : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() => scrubTo(index + 1)}
                      aria-label={`sequence ${event.sequence}: ${event.kind}`}
                    >
                      <span className={styles.traceSequence}>
                        {event.sequence}
                      </span>
                      <span className={styles.traceBody}>
                        <small>
                          {formatMillis(event.logicalTimeMillis)} · {event.source}
                        </small>
                        <strong>{event.kind}</strong>
                        <span>{eventSummary(event)}</span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ol>
          )}
        </aside>
      </section>

      <section className={styles.transport} aria-label="Trace 재생 제어">
        <button
          type="button"
          onClick={() => scrubTo(viewCursor - 1)}
          disabled={viewCursor <= 0}
          aria-label="이전 이벤트"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={togglePlayback}
          disabled={availableCursor === 0}
          aria-label={isPlaying ? "재생 일시정지" : "Trace 재생"}
        >
          {isPlaying ? "Ⅱ" : "▶"}
        </button>
        <div className={styles.scrubber}>
          <span>
            TRACE CURSOR
            <strong>
              {viewCursor} / {availableCursor}
            </strong>
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(availableCursor, 1)}
            value={viewCursor}
            onChange={(event) => scrubTo(Number(event.target.value))}
            disabled={availableCursor === 0}
            aria-label="Trace cursor"
          />
        </div>
        <button
          type="button"
          onClick={() => scrubTo(viewCursor + 1)}
          disabled={viewCursor >= availableCursor}
          aria-label="다음 이벤트"
        >
          ›
        </button>
        <div className={styles.activeSummary}>
          <span>SEQ {activeEvent?.sequence ?? "—"}</span>
          <p>
            {activeEvent
              ? eventSummary(activeEvent)
              : "아직 투영할 runtime event가 없습니다."}
          </p>
        </div>
      </section>

      <nav className={styles.worldNav} aria-label="Flower Garden 월드">
        <Link href={previousHref}>
          <span>01</span>
          <span>
            <small>이전 월드</small>
            <strong>First Bloom Meadow</strong>
          </span>
        </Link>
        <div className={styles.currentWorld}>
          <span>02</span>
          <span>
            <small>현재 월드</small>
            <strong>Verdant Signal Garden</strong>
          </span>
          <b>PLAYING</b>
        </div>
        {nextHref ? (
          <Link href={nextHref}>
            <span>03</span>
            <span>
              <small>다음 월드</small>
              <strong>Checkpoint Hollow</strong>
            </span>
          </Link>
        ) : (
          <div className={styles.lockedWorld} aria-disabled="true">
            <span>03</span>
            <span>
              <small>준비 중</small>
              <strong>다음 월드</strong>
            </span>
            <b>LOCKED</b>
          </div>
        )}
      </nav>
    </main>
  );
}
