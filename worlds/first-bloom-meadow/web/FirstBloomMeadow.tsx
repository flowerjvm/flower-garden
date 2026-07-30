"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import recordedTraceBundle from "../../../contracts/fixtures/first-bloom-the-first-flow.trace.json";
import {
  createFirstBloomRun,
  normalizeRunResponse,
  tickFirstBloomRun,
} from "../../../web/runtime/client";
import {
  FIRST_BLOOM_STEPS,
  projectFirstBloom,
} from "../../../web/projection/firstBloomProjection";
import type {
  EvidenceItem,
  NormalizedRun,
  RunMode,
  TickPrediction,
  TraceEvent,
} from "../../../web/runtime/types";

const FirstBloomScene = lazy(() =>
  import("./FirstBloomScene").then((module) => ({
    default: module.FirstBloomScene,
  })),
);

const PREDICTIONS: Array<{
  value: TickPrediction;
  label: string;
  description: string;
}> = [
  {
    value: "STAY",
    label: "STAY",
    description: "현재 Step에 머문다",
  },
  {
    value: "DONE",
    label: "DONE",
    description: "현재 Step을 완료한다",
  },
  {
    value: "NEXT_STEP",
    label: "다음 Step",
    description: "즉시 다음 Step에 들어간다",
  },
];

const STEP_COPY: Record<
  string,
  { eyebrow: string; title: string; description: string }
> = {
  "prepare-soil": {
    eyebrow: "STEP 01",
    title: "prepare-soil",
    description: "씨앗을 받을 흙을 고르고 Flow의 첫 작업을 완료합니다.",
  },
  "grow-stem": {
    eyebrow: "STEP 02",
    title: "grow-stem",
    description: "다음 Worker tick에서 줄기를 자라게 하는 작은 실행 단위입니다.",
  },
  bloom: {
    eyebrow: "STEP 03",
    title: "bloom",
    description: "마지막 꽃을 피우고 Flow를 FINISHED 상태로 보냅니다.",
  },
};

const BUILT_IN_EVIDENCE: EvidenceItem[] = [
  {
    id: "flow-result-contract",
    kind: "SOURCE",
    label: "StepResult 전이 구현",
    description:
      "DONE은 현재 Step을 나가고 다음 Step 인덱스로 이동합니다. 다음 Step 진입은 다음 tick에서 일어납니다.",
    path:
      "../flower/flower-core/src/main/java/io/github/flowerjvm/flower/core/flow/Flow.java",
    symbol: "applyResult",
  },
  {
    id: "worker-tick-contract",
    kind: "SOURCE",
    label: "Worker tick 실행 경계",
    description:
      "Worker가 한 번의 tick에서 활성 Flow를 각각 한 번씩 진행합니다.",
    path:
      "../flower/flower-core/src/main/java/io/github/flowerjvm/flower/core/worker/Worker.java",
    symbol: "tickOnce",
  },
  {
    id: "first-flow-test",
    kind: "TEST",
    label: "결정적 tick 테스트",
    description:
      "ManualClock과 직접 tick으로 scheduler나 sleep 없이 같은 전이를 검증합니다.",
    path:
      "runtime/src/test/java/io/github/flowerjvm/garden/runtime/firstbloom/FirstBloomRunCoordinatorTest.java",
  },
];

interface PredictionResult {
  tick: number;
  stepId?: string;
  predicted: TickPrediction;
  actual: "STAY" | "DONE" | "UNKNOWN";
  correct: boolean;
}

function acceptCumulativeTrace(
  previous: TraceEvent[],
  incoming: TraceEvent[],
  runId: string,
): TraceEvent[] {
  if (incoming.length < previous.length) {
    throw new Error("Runtime trace cannot shrink.");
  }
  for (let index = 0; index < incoming.length; index += 1) {
    if (incoming[index].runId !== runId) {
      throw new Error("Runtime returned a trace for a different run.");
    }
    if (
      index < previous.length &&
      JSON.stringify(incoming[index]) !== JSON.stringify(previous[index])
    ) {
      throw new Error("An immutable trace prefix changed.");
    }
  }
  return incoming;
}

function replayInitialCursor(events: TraceEvent[]): number {
  const firstTick = events.findIndex(
    (event) => event.type === "GARDEN.TICK_REQUESTED",
  );
  return firstTick < 0 ? events.length : firstTick;
}

function nextReplayCursor(events: TraceEvent[], current: number): number {
  if (current >= events.length) return events.length;

  for (let index = current; index < events.length; index += 1) {
    if (events[index].type === "GARDEN.TICK_COMPLETED") return index + 1;
  }
  return events.length;
}

function actualStepResult(events: TraceEvent[]): {
  value: PredictionResult["actual"];
  stepId?: string;
} {
  const decision = [...events]
    .reverse()
    .find((event) => event.type === "FLOWER.STEP_RESULT");
  if (
    decision?.payload.result === "STAY" ||
    decision?.payload.result === "DONE"
  ) {
    return { value: decision.payload.result, stepId: decision.stepId };
  }
  return { value: "UNKNOWN", stepId: decision?.stepId };
}

function formatStep(stepId?: string): string {
  if (!stepId) return "Flow 대기";
  return STEP_COPY[stepId]?.title ?? stepId;
}

function sourceLabel(mode: RunMode | null): string {
  if (mode === "LIVE_RUNTIME") return "LIVE · 실제 Flower Runtime";
  if (mode === "RECORDED_REPLAY") return "기록 재생 · 실제 Flower fixture";
  return "Runtime 연결 전";
}

export function FirstBloomMeadow() {
  const recordedRun = useMemo(
    () => normalizeRunResponse(recordedTraceBundle),
    [],
  );
  const [run, setRun] = useState<NormalizedRun | null>(null);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [availableCursor, setAvailableCursor] = useState(0);
  const [viewCursor, setViewCursor] = useState(0);
  const [playbackTarget, setPlaybackTarget] = useState(0);
  const [prediction, setPrediction] = useState<TickPrediction | null>(null);
  const [predictionResults, setPredictionResults] = useState<
    PredictionResult[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(
    "prepare-soil",
  );
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const projection = useMemo(
    () => projectFirstBloom(events, viewCursor),
    [events, viewCursor],
  );
  const latestProjection = useMemo(
    () => projectFirstBloom(events, availableCursor),
    [events, availableCursor],
  );
  const isPlaying = viewCursor < playbackTarget;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (viewCursor >= playbackTarget) return;
    const timeout = window.setTimeout(
      () => setViewCursor((current) => Math.min(current + 1, playbackTarget)),
      360,
    );
    return () => window.clearTimeout(timeout);
  }, [playbackTarget, viewCursor]);

  function beginReveal(from: number, to: number) {
    setAvailableCursor(to);
    if (reducedMotion) {
      setViewCursor(to);
      setPlaybackTarget(to);
      return;
    }
    setViewCursor(Math.min(from, to));
    setPlaybackTarget(to);
  }

  function activateRecordedReplay(message: string) {
    const initialCursor = replayInitialCursor(recordedRun.events);
    setRun(recordedRun);
    setMode("RECORDED_REPLAY");
    setEvents(recordedRun.events);
    setAvailableCursor(initialCursor);
    setViewCursor(initialCursor);
    setPlaybackTarget(initialCursor);
    setPrediction(null);
    setPredictionResults([]);
    setNotice(message);
  }

  async function startRun() {
    setBusy(true);
    setNotice(null);
    try {
      const liveRun = await createFirstBloomRun();
      setRun(liveRun);
      setMode("LIVE_RUNTIME");
      setEvents(liveRun.events);
      setAvailableCursor(liveRun.events.length);
      setViewCursor(liveRun.events.length);
      setPlaybackTarget(liveRun.events.length);
      setPrediction(null);
      setPredictionResults([]);
    } catch {
      activateRecordedReplay(
        "Flower Runtime에 연결되지 않아, 실제 런타임에서 미리 기록한 canonical trace를 재생합니다. 아래 조작은 새 결과를 계산하지 않고 기록 cursor만 이동합니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runTick() {
    if (!run || !prediction || busy || isPlaying) return;
    setBusy(true);
    setNotice(null);
    const beforeCursor = availableCursor;

    try {
      let nextEvents = events;
      let nextRun = run;
      let nextCursor = availableCursor;

      if (mode === "LIVE_RUNTIME") {
        const expectedSequence = events.at(-1)?.sequence ?? 0;
        const response = await tickFirstBloomRun(
          run.runId,
          expectedSequence,
        );
        if (response.runId !== run.runId) {
          throw new Error("Runtime returned a different run.");
        }
        nextEvents = acceptCumulativeTrace(
          events,
          response.events,
          run.runId,
        );
        nextCursor = nextEvents.length;
        nextRun = response;
        setRun(nextRun);
        setEvents(nextEvents);
      } else {
        nextCursor = nextReplayCursor(events, availableCursor);
      }

      const revealed = nextEvents.slice(beforeCursor, nextCursor);
      const actual = actualStepResult(revealed);
      if (actual.stepId) setSelectedStepId(actual.stepId);
      setPredictionResults((history) => [
        ...history,
        {
          tick: history.length + 1,
          stepId: actual.stepId,
          predicted: prediction,
          actual: actual.value,
          correct: prediction === actual.value,
        },
      ]);
      setPrediction(null);
      beginReveal(beforeCursor, nextCursor);
    } catch {
      setNotice(
        "실시간 실행이 중단되었습니다. 결과를 추측하지 않았습니다. 새 실행을 시작하면 canonical 기록 재생으로 안전하게 전환할 수 있습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  function resetRun() {
    setRun(null);
    setMode(null);
    setEvents([]);
    setAvailableCursor(0);
    setViewCursor(0);
    setPlaybackTarget(0);
    setPrediction(null);
    setPredictionResults([]);
    setNotice(null);
    setSelectedStepId("prepare-soil");
  }

  function scrubTo(cursor: number) {
    setViewCursor(cursor);
    setPlaybackTarget(cursor);
  }

  const selectedStep =
    selectedStepId && STEP_COPY[selectedStepId]
      ? STEP_COPY[selectedStepId]
      : STEP_COPY["prepare-soil"];
  const activeEvent = projection.activeEvent;
  const combinedEvidence = [
    ...(activeEvent?.evidence ?? []),
    ...(run?.evidence ?? []),
    ...BUILT_IN_EVIDENCE,
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.id === item.id) === index,
  );
  const visibleEvents = events.slice(0, availableCursor);
  const latestPrediction = predictionResults.at(-1);
  const canTick =
    Boolean(run) &&
    Boolean(prediction) &&
    !busy &&
    !isPlaying &&
    latestProjection.phase !== "FINISHED" &&
    latestProjection.phase !== "FAILED";

  return (
    <main className="flower-garden-shell">
      <header className="garden-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="brand-name">Flower Garden</p>
            <p className="brand-tagline">Flower를 실행하며 배우는 마이크로월드</p>
          </div>
        </div>
        <div
          className={`runtime-badge ${
            mode === "LIVE_RUNTIME"
              ? "is-live"
              : mode === "RECORDED_REPLAY"
                ? "is-replay"
                : ""
          }`}
          role="status"
        >
          <span className="runtime-dot" aria-hidden="true" />
          <span>{sourceLabel(mode)}</span>
          {run && <small>{run.runtimeVersion}</small>}
        </div>
      </header>

      <nav className="world-crumbs" aria-label="현재 학습 위치">
        <span>01</span>
        <strong>First Bloom Meadow</strong>
        <i aria-hidden="true">/</i>
        <span>The First Flow</span>
      </nav>

      <section className="concept-ribbon" aria-label="Flower 실행 계층">
        {[
          ["Engine", "정원을 깨우는 실행기"],
          ["Worker", "tick을 운반하는 일꾼"],
          ["Flow", "하나의 꽃 피우기"],
          ["Step", formatStep(projection.currentStepId)],
          ["StepResult", projection.lastStepResult ?? "아직 없음"],
        ].map(([term, description], index) => (
          <div
            key={term}
            className={`concept-node ${
              run && index <= Math.min(4, projection.flowerStage + 1)
                ? "is-active"
                : ""
            }`}
          >
            <span>{term}</span>
            <small>{description}</small>
          </div>
        ))}
      </section>

      {notice && (
        <div
          className={`source-notice ${
            mode === "RECORDED_REPLAY" ? "is-replay" : "is-error"
          }`}
          role="status"
        >
          <strong>
            {mode === "RECORDED_REPLAY" ? "기록 재생 모드" : "실행 연결 안내"}
          </strong>
          <span>{notice}</span>
        </div>
      )}

      <section className="garden-workspace">
        <aside className="mission-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">MISSION 01</p>
              <h1>The First Flow</h1>
            </div>
            <span className="difficulty-pill">첫 꽃</span>
          </div>

          <p className="mission-intro">
            Worker가 한 번 tick할 때마다 실제 Flower Runtime이 어떤 Step을
            실행하고 어떤 StepResult를 받는지 예측하세요.
          </p>

          <div className="mission-goal">
            <span aria-hidden="true">✦</span>
            <p>
              <strong>목표</strong>
              씨앗에서 꽃까지 세 Step의 경계를 Trace로 설명하기
            </p>
          </div>

          {!run ? (
            <div className="start-card">
              <p>
                먼저 실행을 만들면 Flow가 Worker의 READY 대기열에
                들어갑니다.
              </p>
              <button
                className="primary-action"
                type="button"
                onClick={startRun}
                disabled={busy}
              >
                {busy ? "Runtime을 깨우는 중…" : "첫 실행 만들기"}
              </button>
            </div>
          ) : latestProjection.phase === "FINISHED" ? (
            <div className="completion-card">
              <p className="eyebrow">FLOW FINISHED</p>
              <h2>첫 꽃이 피었습니다.</h2>
              <p>
                결과를 만든 것은 3D 애니메이션이 아니라 Flower가 반환한
                StepResult입니다.
              </p>
              <button
                type="button"
                className="secondary-action"
                onClick={resetRun}
              >
                새 실행 시작
              </button>
            </div>
          ) : (
            <>
              <div className="prediction-block">
                <div className="prediction-heading">
                  <p className="eyebrow">
                    TICK {predictionResults.length + 1} · 실행 전
                  </p>
                  <span>{formatStep(latestProjection.currentStepId)}</span>
                </div>
                <h2>다음 tick의 결과는?</h2>
                <div className="prediction-options">
                  {PREDICTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={
                        prediction === option.value ? "is-selected" : ""
                      }
                      onClick={() => setPrediction(option.value)}
                      aria-pressed={prediction === option.value}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </button>
                  ))}
                </div>
                <p className="prediction-note">
                  예측은 학습 기록일 뿐, Runtime 결과를 바꾸지 않습니다.
                </p>
              </div>

              <button
                className="tick-action"
                type="button"
                onClick={runTick}
                disabled={!canTick}
              >
                <span className="tick-icon" aria-hidden="true">
                  ↻
                </span>
                <span>
                  <strong>{busy ? "Flower 실행 중…" : "Worker tick"}</strong>
                  <small>실제 Flow를 한 번 진행</small>
                </span>
              </button>
            </>
          )}

          {latestPrediction && (
            <div
              className={`prediction-result ${
                latestPrediction.correct ? "is-correct" : "is-learning"
              }`}
              aria-live="polite"
            >
              <span aria-hidden="true">
                {latestPrediction.correct ? "✓" : "↗"}
              </span>
              <div>
                <strong>
                  예상 {latestPrediction.predicted} · 실제{" "}
                  {latestPrediction.actual}
                </strong>
                <p>
                  {latestPrediction.predicted === "NEXT_STEP"
                    ? "다음 Step 이동은 DONE의 효과입니다. NEXT_STEP이라는 StepResult는 없습니다."
                    : latestPrediction.correct
                      ? "실제 Trace와 예측이 일치했습니다."
                      : "Trace를 되감아 StepResult가 결정된 순간을 확인해 보세요."}
                </p>
              </div>
            </div>
          )}
        </aside>

        <section className="world-stage" aria-label="First Bloom Meadow 3D 투영">
          <Suspense
            fallback={
              <div className="world-loading" role="status">
                <span aria-hidden="true" />
                <p>정원을 불러오는 중…</p>
              </div>
            }
          >
            <FirstBloomScene
              projection={projection}
              reducedMotion={reducedMotion}
              selectedStepId={selectedStepId}
              onSelectStep={setSelectedStepId}
            />
          </Suspense>

          <div className="stage-overlay stage-status">
            <span
              className={`status-light phase-${projection.phase.toLowerCase()}`}
              aria-hidden="true"
            />
            <div>
              <small>FLOW STATE</small>
              <strong>{projection.phase}</strong>
            </div>
            <i />
            <div>
              <small>현재 STEP</small>
              <strong>{formatStep(projection.currentStepId)}</strong>
            </div>
          </div>

          <div
            className={`stage-overlay source-stamp ${
              mode === "RECORDED_REPLAY" ? "is-replay" : ""
            }`}
          >
            {sourceLabel(mode)}
          </div>

          <div className="stage-overlay step-inspector">
            <p>{selectedStep.eyebrow}</p>
            <strong>{selectedStep.title}</strong>
            <span>{selectedStep.description}</span>
          </div>

          <div className="accessible-world-state">
            <h2>3D 정원 상태</h2>
            <p>
              Flow 상태 {projection.phase}. 현재 Step{" "}
              {formatStep(projection.currentStepId)}. 흙, 줄기, 꽃 가운데{" "}
              {projection.flowerStage}단계가 완료되었습니다.
            </p>
            <div>
              {FIRST_BLOOM_STEPS.map((stepId) => (
                <button
                  key={stepId}
                  type="button"
                  onClick={() => setSelectedStepId(stepId)}
                >
                  {formatStep(stepId)} 살펴보기
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="trace-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">RUNTIME TRACE</p>
              <h2>진실의 기록</h2>
            </div>
            <button
              type="button"
              className="evidence-toggle"
              onClick={() => setEvidenceOpen((open) => !open)}
              aria-expanded={evidenceOpen}
            >
              {evidenceOpen ? "Trace 보기" : "근거 보기"}
            </button>
          </div>

          {evidenceOpen ? (
            <div className="evidence-list">
              <p className="panel-copy">
                결과를 뒷받침하는 계약, 실제 소스, 테스트 위치입니다.
              </p>
              {combinedEvidence.map((item) => (
                <article key={item.id} className="evidence-card">
                  <span>{item.kind}</span>
                  <h3>{item.label}</h3>
                  {item.description && <p>{item.description}</p>}
                  {(item.path || item.url) && (
                    <code>{item.path ?? item.url}</code>
                  )}
                  {item.symbol && <small>symbol · {item.symbol}</small>}
                </article>
              ))}
            </div>
          ) : (
            <ol className="trace-list">
              {visibleEvents.length === 0 && (
                <li className="trace-empty">
                  실행을 만들면 FlowerListener의 첫 기록이 여기에 나타납니다.
                </li>
              )}
              {visibleEvents.map((event, index) => {
                const active = index + 1 === viewCursor;
                return (
                  <li
                    key={`${event.sequence}-${event.type}`}
                    className={active ? "is-active" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => scrubTo(index + 1)}
                      aria-label={`${event.sequence}번 이벤트로 이동: ${event.summary}`}
                    >
                      <span className="trace-sequence">
                        {String(event.sequence).padStart(2, "0")}
                      </span>
                      <span className="trace-body">
                        <small>
                          {event.source.replaceAll("_", " ")} ·{" "}
                          {(event.logicalTimeMillis / 1000).toFixed(1)}s
                        </small>
                        <strong>{event.type}</strong>
                        <p>{event.summary}</p>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </section>

      <section className="trace-transport" aria-label="Trace 재생 제어">
        <button
          type="button"
          onClick={() => scrubTo(Math.max(0, viewCursor - 1))}
          disabled={viewCursor === 0}
          aria-label="이전 이벤트"
        >
          ←
        </button>
        <div className="trace-scrubber">
          <div>
            <span>TRACE REPLAY</span>
            <strong>
              {viewCursor} / {availableCursor}
            </strong>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(availableCursor, 1)}
            value={Math.min(viewCursor, Math.max(availableCursor, 1))}
            onChange={(event) => scrubTo(Number(event.target.value))}
            aria-label="Trace 이벤트 위치"
            aria-valuetext={`${viewCursor}번째 이벤트`}
            disabled={availableCursor === 0}
          />
        </div>
        <button
          type="button"
          onClick={() =>
            scrubTo(Math.min(availableCursor, viewCursor + 1))
          }
          disabled={viewCursor >= availableCursor}
          aria-label="다음 이벤트"
        >
          →
        </button>
        <div className="active-event-summary">
          <span>SEQ {activeEvent?.sequence ?? "—"}</span>
          <p>{activeEvent?.summary ?? "아직 기록된 이벤트가 없습니다."}</p>
        </div>
      </section>

      <section className="world-catalog" aria-labelledby="world-catalog-title">
        <div className="catalog-heading">
          <p className="eyebrow">GARDEN MAP</p>
          <h2 id="world-catalog-title">다음에 피울 세계</h2>
        </div>
        <article className="world-card is-current">
          <span className="world-number">01</span>
          <div>
            <small>현재 월드</small>
            <h3>First Bloom Meadow</h3>
            <p>The First Flow · 기본 실행 계층</p>
          </div>
          <span className="world-status">PLAYING</span>
        </article>
        <Link
          className="world-card is-next is-available"
          href="/worlds/verdant-signal-garden"
          aria-label="두 번째 월드 Verdant Signal Garden 열기"
        >
          <span className="world-number">02</span>
          <div>
            <small>두 번째 월드</small>
            <h3>Verdant Signal Garden</h3>
            <p>Signal vs Timeout · 시간과 경쟁</p>
          </div>
          <span className="world-status">ENTER</span>
        </Link>
      </section>
    </main>
  );
}
