"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { projectVerdantSignal } from "../../../web/projection/verdantSignalProjection";
import {
  defaultVerdantRuntimeAdapter,
  normalizeVerdantTraceBundle,
} from "./verdantRuntime";
import type { VerdantFocus } from "./VerdantSignalScene";
import {
  YARD_SIGNAL_NAME,
  type VerdantCommand,
  type VerdantEvidence,
  type VerdantPrediction,
  type VerdantProjection,
  type VerdantRunSnapshot,
  type VerdantRuntimeAdapter,
  type VerdantScenario,
  type VerdantScenarioId,
  type VerdantTraceEvent,
} from "./types";
import styles from "./VerdantSignalGarden.module.css";

const VerdantSignalScene = lazy(() =>
  import("./VerdantSignalScene").then((module) => ({
    default: module.VerdantSignalScene,
  })),
);

const TICK: VerdantCommand = { kind: "TICK", payload: {} };
const SEND_YARD_SIGNAL: VerdantCommand = {
  kind: "SEND_SIGNAL",
  payload: { name: YARD_SIGNAL_NAME },
};

export const VERDANT_SCENARIOS: readonly VerdantScenario[] = [
  {
    id: "signal-at-29s",
    shortLabel: "29초 Signal",
    title: "마감 1초 전의 종",
    timeline: "00:29 Signal → 다음 Worker tick",
    question: "다음 tick에서 Signal 조건만 관찰될까요?",
    commands: [
      { kind: "ADVANCE_TIME", payload: { millis: 29_000 } },
      SEND_YARD_SIGNAL,
      TICK,
      TICK,
    ],
  },
  {
    id: "timeout-then-late-signal",
    shortLabel: "Timeout 먼저",
    title: "종료된 Wait에 늦은 Signal",
    timeline: "00:30 → Worker tick → Signal → 경로 tick",
    question: "Timeout이 경로를 확정한 뒤 Signal은 어떻게 될까요?",
    commands: [
      { kind: "ADVANCE_TIME", payload: { millis: 30_000 } },
      TICK,
      SEND_YARD_SIGNAL,
      TICK,
    ],
  },
  {
    id: "both-at-deadline",
    shortLabel: "30초에 둘 다",
    title: "두 predicate의 교집합",
    timeline: "00:30 + Signal → 같은 Worker tick",
    question: "두 조건이 모두 true라면 Step은 무엇부터 검사할까요?",
    commands: [
      { kind: "ADVANCE_TIME", payload: { millis: 30_000 } },
      SEND_YARD_SIGNAL,
      TICK,
      TICK,
    ],
  },
] as const;

const PREDICTIONS: Array<{
  value: VerdantPrediction;
  label: string;
  description: string;
}> = [
  {
    value: "SIGNAL",
    label: "SIGNAL",
    description: "signalPresent만 true",
  },
  {
    value: "TIMEOUT",
    label: "TIMEOUT",
    description: "timedOut만 true",
  },
  {
    value: "BOTH",
    label: "BOTH",
    description: "두 predicate가 모두 true",
  },
];

const EDUCATION_EVIDENCE: readonly VerdantEvidence[] = [
  {
    type: "CONTRACT",
    ref: "mission-policy:SIGNAL_THEN_TIMEOUT",
    label:
      "SIGNAL_THEN_TIMEOUT은 Flower 전체 규칙이 아니라 이 Wait Step의 명시적 앱 정책입니다.",
  },
  {
    type: "CONTRACT",
    ref: "flower-app-guide:events-and-waits",
    label:
      "Signal은 전이 명령이 아니라 깨우기 힌트이며, Step이 다음 tick에서 사실을 확인합니다.",
  },
  {
    type: "CONTRACT",
    ref: "trace-contract:sequence",
    label:
      "3D 장면은 sequence 순서의 runtime event만 투영하며 별도의 승자를 계산하지 않습니다.",
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
      "Signal과 deadline을 직접 기다리며 멈추지 않습니다. Worker가 tick할 때 두 조건을 읽고 실제 StepResult를 반환합니다.",
  },
  signal: {
    eyebrow: "SIGNAL INPUT",
    title: "yard-assignment",
    body:
      "Signal은 Flow를 직접 이동시키지 않습니다. 활성 Wait에 도착하면 다음 tick에서 확인할 사실이 됩니다.",
  },
  timeout: {
    eyebrow: "MANUAL CLOCK",
    title: "30,000 ms deadline",
    body:
      "Timeout은 대기열의 가상 이벤트가 아닙니다. Step이 현재 시각과 deadline 상태를 다음 tick에서 관찰합니다.",
  },
  routes: {
    eyebrow: "STEPRESULT ROUTE",
    title: "yard-move / timed-out",
    body:
      "오직 runtime이 기록한 GOTO와 committed route만 문을 밝힙니다. 장면은 경로를 선택하지 않습니다.",
  },
};

type RunMode = "LIVE_RUNTIME" | "RECORDED_REPLAY";
type BusyAction = "STARTING" | "EXECUTING" | null;

interface Notice {
  tone: "error" | "replay";
  title: string;
  body: string;
}

export interface VerdantSignalGardenProps {
  runtime?: VerdantRuntimeAdapter;
  recordedBundles?: Partial<Record<VerdantScenarioId, unknown>>;
  backHref?: string;
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

function replayWaitCursor(events: readonly VerdantTraceEvent[]): number {
  let waitStarted = false;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].kind === "VERDANT.WAIT_STARTED") waitStarted = true;
    if (waitStarted && events[index].kind === "GARDEN.TICK_COMPLETED") {
      return index + 1;
    }
  }
  throw new Error("Recorded trace does not contain the initial Wait tick.");
}

function observationFromProjection(
  projection: VerdantProjection,
): VerdantPrediction | undefined {
  if (projection.signalPresent === true && projection.timedOut === true) {
    return "BOTH";
  }
  if (projection.signalPresent === true && projection.timedOut === false) {
    return "SIGNAL";
  }
  if (projection.signalPresent === false && projection.timedOut === true) {
    return "TIMEOUT";
  }
  return undefined;
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
      return "Flow가 Worker의 READY 대기열에 들어갔습니다.";
    case "GARDEN.TICK_REQUESTED":
      return "Worker.tickOnce()를 한 번 요청했습니다.";
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
      return "둘 다 true인 tick에서 Signal 우선 정책이 Timeout을 거절했습니다.";
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
      return "Signal 전달이 완료되었습니다.";
    case "GARDEN.SIGNAL_IGNORED":
      return "이미 종료된 Wait이므로 늦은 Signal이 무시되었습니다.";
    default:
      return "이 이벤트는 기록되지만 Verdant 장면 상태를 변경하지 않습니다.";
  }
}

function runtimeLabel(mode: RunMode | null): string {
  if (mode === "LIVE_RUNTIME") return "LIVE · 실제 Flower Runtime";
  if (mode === "RECORDED_REPLAY") return "REPLAY · canonical runtime trace";
  return "Runtime 연결 전";
}

function scenarioById(id: VerdantScenarioId): VerdantScenario {
  return (
    VERDANT_SCENARIOS.find((scenario) => scenario.id === id) ??
    VERDANT_SCENARIOS[0]
  );
}

export function VerdantSignalGarden({
  runtime = defaultVerdantRuntimeAdapter,
  recordedBundles,
  backHref = "/",
  nextHref,
  className,
}: VerdantSignalGardenProps) {
  const [scenarioId, setScenarioId] =
    useState<VerdantScenarioId>("signal-at-29s");
  const [prediction, setPrediction] = useState<VerdantPrediction | null>(null);
  const [run, setRun] = useState<VerdantRunSnapshot | null>(null);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [events, setEvents] = useState<VerdantTraceEvent[]>([]);
  const [availableCursor, setAvailableCursor] = useState(0);
  const [viewCursor, setViewCursor] = useState(0);
  const [waitCursor, setWaitCursor] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [scenarioExecuted, setScenarioExecuted] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [commandProgress, setCommandProgress] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focus, setFocus] = useState<VerdantFocus>("wait");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const scenario = scenarioById(scenarioId);
  const projection = useMemo(
    () => projectVerdantSignal(events, viewCursor),
    [events, viewCursor],
  );
  const finalProjection = useMemo(
    () => projectVerdantSignal(events, availableCursor),
    [availableCursor, events],
  );
  const isPlaying = autoPlay && viewCursor < availableCursor;
  const playbackComplete =
    scenarioExecuted && viewCursor >= availableCursor;
  const observedCondition = playbackComplete
    ? observationFromProjection(finalProjection)
    : undefined;
  const predictionCorrect =
    observedCondition !== undefined && observedCondition === prediction;

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
      reducedMotion ? 0 : 150,
    );
    return () => window.clearTimeout(timeout);
  }, [availableCursor, isPlaying, reducedMotion, viewCursor]);

  async function startWait() {
    if (busyAction) return;
    setBusyAction("STARTING");
    setNotice(null);
    setCommandProgress(0);

    try {
      let nextRun = await runtime.createRun();
      const createdEvents = [...nextRun.events];
      nextRun = await runtime.sendCommand(
        nextRun.runId,
        lastSequence(nextRun),
        TICK,
      );
      acceptCumulativeTrace(createdEvents, nextRun.events, nextRun.runId);

      setRun(nextRun);
      setMode("LIVE_RUNTIME");
      setEvents([...nextRun.events]);
      setAvailableCursor(nextRun.events.length);
      setViewCursor(nextRun.events.length);
      setWaitCursor(nextRun.events.length);
      setScenarioExecuted(false);
      setPrediction(null);
      setFocus("wait");
    } catch {
      const bundle = recordedBundles?.[scenarioId];
      if (bundle === undefined) {
        setNotice({
          tone: "error",
          title: "Flower Runtime에 연결하지 못했습니다",
          body:
            "이 미션은 브라우저가 결과를 대신 계산하지 않습니다. 로컬 Runtime을 실행한 뒤 다시 시도해 주세요.",
        });
      } else {
        try {
          const recordedRun = normalizeVerdantTraceBundle(
            bundle,
            scenarioId,
          );
          const initialCursor = replayWaitCursor(recordedRun.events);
          setRun(recordedRun);
          setMode("RECORDED_REPLAY");
          setEvents([...recordedRun.events]);
          setAvailableCursor(initialCursor);
          setViewCursor(initialCursor);
          setWaitCursor(initialCursor);
          setScenarioExecuted(false);
          setPrediction(null);
          setFocus("wait");
          setNotice({
            tone: "replay",
            title: "Canonical 기록 재생 모드",
            body:
              "실행 결과를 새로 계산하지 않고, 실제 Runtime에서 미리 기록한 불변 trace의 cursor만 이동합니다.",
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

  async function executeScenario() {
    if (!run || !prediction || busyAction || scenarioExecuted) return;
    setBusyAction("EXECUTING");
    setNotice(
      mode === "RECORDED_REPLAY"
        ? notice
        : null,
    );
    setCommandProgress(0);

    if (mode === "RECORDED_REPLAY") {
      setScenarioExecuted(true);
      setAvailableCursor(events.length);
      if (reducedMotion) {
        setViewCursor(events.length);
      } else {
        setViewCursor(waitCursor);
        setAutoPlay(true);
      }
      setBusyAction(null);
      return;
    }

    let nextRun = run;
    let acceptedEvents = [...events];
    try {
      for (let index = 0; index < scenario.commands.length; index += 1) {
        nextRun = await runtime.sendCommand(
          nextRun.runId,
          lastSequence(nextRun),
          scenario.commands[index],
        );
        acceptedEvents = acceptCumulativeTrace(
          acceptedEvents,
          nextRun.events,
          run.runId,
        );
        setCommandProgress(index + 1);
      }

      setRun(nextRun);
      setEvents(acceptedEvents);
      setAvailableCursor(acceptedEvents.length);
      setScenarioExecuted(true);
      if (reducedMotion) {
        setViewCursor(acceptedEvents.length);
      } else {
        setViewCursor(waitCursor);
        setAutoPlay(true);
      }
    } catch {
      setRun(nextRun);
      setEvents(acceptedEvents);
      setAvailableCursor(acceptedEvents.length);
      setViewCursor(acceptedEvents.length);
      setAutoPlay(false);
      setNotice({
        tone: "error",
        title: "실험 명령이 중간에 멈췄습니다",
        body:
          "성공한 명령까지의 실제 trace만 보존했습니다. 결과를 추측해 채우지 않았습니다. 새 실행으로 다시 시도해 주세요.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function resetExperiment(nextScenarioId = scenarioId) {
    setScenarioId(nextScenarioId);
    setPrediction(null);
    setRun(null);
    setMode(null);
    setEvents([]);
    setAvailableCursor(0);
    setViewCursor(0);
    setWaitCursor(0);
    setAutoPlay(false);
    setScenarioExecuted(false);
    setBusyAction(null);
    setCommandProgress(0);
    setNotice(null);
    setFocus("wait");
    setEvidenceOpen(false);
  }

  function selectScenario(nextScenarioId: VerdantScenarioId) {
    if (run) return;
    setScenarioId(nextScenarioId);
    setPrediction(null);
    setNotice(null);
  }

  function scrubTo(cursor: number) {
    setAutoPlay(false);
    setViewCursor(Math.max(0, Math.min(cursor, availableCursor)));
  }

  function togglePlayback() {
    if (viewCursor >= availableCursor) {
      setViewCursor(scenarioExecuted ? waitCursor : 0);
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
  const canExecute =
    Boolean(run) &&
    Boolean(prediction) &&
    !scenarioExecuted &&
    !busyAction &&
    notice?.tone !== "error" &&
    finalProjection.waitStatus === "WAITING";
  const conceptActive = [
    projection.signalStatus !== "IDLE",
    projection.timeoutStatus !== "IDLE",
    projection.waitStatus !== "IDLE",
    Boolean(projection.lastStepResult),
    projection.routeCommitted,
  ];

  return (
    <main
      className={joinClasses(styles.shell, className)}
      aria-labelledby="verdant-mission-title"
    >
      <header className={styles.header}>
        <a className={styles.brand} href={backHref} aria-label="Flower Garden 홈">
          <span className={styles.brandMark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>Flower Garden</strong>
            <small>실행하며 배우는 Flower microworld</small>
          </span>
        </a>
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
        <a href={backHref}>01 First Bloom Meadow</a>
        <span aria-hidden="true">/</span>
        <strong>02 Verdant Signal Garden</strong>
        <span aria-hidden="true">/</span>
        <span>Signal vs Timeout</span>
      </nav>

      <section className={styles.conceptRibbon} aria-label="이번 미션의 실행 계약">
        {[
          ["Signal", "깨우기 힌트"],
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
            <span className={styles.difficulty}>두 번째 꽃</span>
          </div>

          <p className={styles.missionIntro}>
            입력이 경로를 직접 바꾸는 것이 아닙니다. 실제 Wait Step이 다음
            Worker tick에서 어떤 조건을 보고 어떤 StepResult를 반환하는지
            예측해 보세요.
          </p>

          <div className={styles.ruleCallout}>
            <strong>먼저 기억할 경계</strong>
            <p>
              Signal은 전이 명령이 아니고, Timeout은 queued event가 아닙니다.
              <code>SIGNAL_THEN_TIMEOUT</code>은 이 미션 Step의 앱 정책입니다.
            </p>
          </div>

          {!run ? (
            <>
              <fieldset className={styles.scenarioPicker}>
                <legend>실험 시나리오 선택</legend>
                {VERDANT_SCENARIOS.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={joinClasses(
                      styles.scenarioCard,
                      scenarioId === item.id && styles.selected,
                    )}
                    onClick={() => selectScenario(item.id)}
                    aria-pressed={scenarioId === item.id}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <strong>{item.shortLabel}</strong>
                      <small>{item.timeline}</small>
                    </span>
                  </button>
                ))}
              </fieldset>
              <div className={styles.scenarioBrief}>
                <small>선택한 실험</small>
                <strong>{scenario.title}</strong>
                <p>{scenario.question}</p>
              </div>
              <button
                className={styles.primaryAction}
                type="button"
                onClick={startWait}
                disabled={busyAction !== null}
              >
                {busyAction === "STARTING"
                  ? "실제 Wait를 준비하는 중…"
                  : "실제 Wait Step 시작"}
              </button>
              <p className={styles.controlGuard}>
                WAIT_STARTED가 기록되기 전에는 시간과 Signal 명령을 보내지
                않습니다.
              </p>
            </>
          ) : !scenarioExecuted ? (
            <>
              <div className={styles.activeScenario}>
                <span>선택한 시나리오</span>
                <strong>{scenario.title}</strong>
                <small>{scenario.timeline}</small>
              </div>

              <fieldset className={styles.predictionPicker}>
                <legend>다음 Worker tick에서 Wait Step이 관찰할 조건은?</legend>
                {PREDICTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={joinClasses(
                      styles.predictionOption,
                      prediction === item.value && styles.selected,
                    )}
                    onClick={() => setPrediction(item.value)}
                    aria-pressed={prediction === item.value}
                  >
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </button>
                ))}
              </fieldset>
              <p className={styles.predictionHint}>
                BOTH는 두 경로의 동시 승리가 아니라 두 predicate가 같은
                tick에서 모두 true라는 뜻입니다.
              </p>
              <button
                className={styles.tickAction}
                type="button"
                onClick={executeScenario}
                disabled={!canExecute}
              >
                <span aria-hidden="true">▶</span>
                <span>
                  <strong>
                    {busyAction === "EXECUTING"
                      ? mode === "RECORDED_REPLAY"
                        ? "기록을 여는 중…"
                        : `Runtime 명령 ${commandProgress}/${scenario.commands.length}`
                      : mode === "RECORDED_REPLAY"
                        ? "기록된 실제 실행 재생"
                        : "실제 Runtime으로 실험"}
                  </strong>
                  <small>
                    {mode === "RECORDED_REPLAY"
                      ? "canonical trace cursor만 재생"
                      : "입력 명령 뒤 Worker.tickOnce() 실행"}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className={styles.textAction}
                onClick={() => resetExperiment()}
                disabled={busyAction !== null}
              >
                다른 시나리오 고르기
              </button>
            </>
          ) : playbackComplete ? (
            <div
              className={joinClasses(
                styles.resultCard,
                predictionCorrect ? styles.correct : styles.learning,
              )}
              aria-live="polite"
            >
              <p className={styles.eyebrow}>
                {predictionCorrect ? "PREDICTION MATCH" : "TRACE EXPLAINS"}
              </p>
              <h2>
                관찰 {observedCondition ?? "확인 불가"} · 승자{" "}
                {finalProjection.winner ?? "미기록"}
              </h2>
              <dl>
                <div>
                  <dt>Step 정책</dt>
                  <dd>{finalProjection.checkPrecedence ?? "미기록"}</dd>
                </div>
                <div>
                  <dt>StepResult</dt>
                  <dd>
                    {finalProjection.decisionStepResult ?? "미기록"}
                    {finalProjection.decisionTargetStepId
                      ? ` → ${finalProjection.decisionTargetStepId}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>확정 경로</dt>
                  <dd>{finalProjection.selectedPath ?? "미기록"}</dd>
                </div>
              </dl>
              {observedCondition === "BOTH" && (
                <p>
                  두 조건은 모두 true였지만, Wait Step이 Signal을 먼저
                  검사해 한 경로만 확정했습니다. 이것은 Flower의 보편 규칙이
                  아니라 이 Step의 코드로 보장한 정책입니다.
                </p>
              )}
              {finalProjection.signalStatus === "IGNORED" && (
                <p>
                  Wait가 이미 종료된 뒤 도착한 Signal은 경로를 다시 열지
                  못했습니다.
                </p>
              )}
              {finalProjection.routeCommitted && (
                <p className={styles.contractResult}>
                  보장된 계약 · 후속 경로는 하나만 commit되었습니다.
                </p>
              )}
              <button
                className={styles.secondaryAction}
                type="button"
                onClick={() => resetExperiment()}
              >
                새 실험 시작
              </button>
            </div>
          ) : (
            <div className={styles.replayingCard} aria-live="polite">
              <span aria-hidden="true" />
              <strong>Runtime trace를 세계에 투영하는 중</strong>
              <p>
                sequence {viewCursor}/{availableCursor} · 결과는 재생이 끝난
                뒤 공개됩니다.
              </p>
            </div>
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
                  실제 Wait를 시작하면 runtime event가 sequence 순서로
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
        <a href={backHref}>
          <span>01</span>
          <span>
            <small>이전 월드</small>
            <strong>First Bloom Meadow</strong>
          </span>
        </a>
        <div className={styles.currentWorld}>
          <span>02</span>
          <span>
            <small>현재 월드</small>
            <strong>Verdant Signal Garden</strong>
          </span>
          <b>PLAYING</b>
        </div>
        {nextHref ? (
          <a href={nextHref}>
            <span>03</span>
            <span>
              <small>다음 월드</small>
              <strong>Checkpoint Hollow</strong>
            </span>
          </a>
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
