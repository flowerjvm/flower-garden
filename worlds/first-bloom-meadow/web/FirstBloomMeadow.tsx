"use client";

import Link from "next/link";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import { projectFirstBloom } from "../../../web/projection/firstBloomProjection";
import {
  acceptFirstBloomCumulativeRun,
  createFirstBloomRun,
  publishFirstBloomEvent,
  tickFirstBloomRun,
} from "../../../web/runtime/client";
import type {
  FirstBloomProjection,
  FirstBloomStepId,
  NormalizedRun,
} from "../../../web/runtime/types";
import {
  checkFirstBloomDraft,
  createEmptyFirstBloomDraft,
  createFirstBloomBlueprint,
  FIRST_BLOOM_PARTS,
  firstBloomPart,
  isFirstBloomPartPlaced,
  moveFirstBloomStep,
  placeFirstBloomPart,
  removeFirstBloomPart,
  type FirstBloomDraft,
  type FirstBloomPartId,
} from "./builderGame";
import styles from "./FirstBloomBuilder.module.css";

const FirstBloomScene = lazy(() =>
  import("./FirstBloomScene").then((module) => ({
    default: module.FirstBloomScene,
  })),
);

type BusyState = "CREATING" | "RUNNING" | "EVENT" | null;

const FAILURE_COPY: Record<string, string> = {
  SOIL_NOT_READY: "먼저 흙을 준비해야 해요.",
  SUNLIGHT_NOT_READY: "줄기를 키우기 전에 햇빛 이벤트가 필요해요.",
  STEM_NOT_GROWN: "꽃을 피우기 전에 줄기를 키워야 해요.",
};

function joinClasses(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function latestSequence(run: NormalizedRun): number {
  return run.events.at(-1)?.sequence ?? 0;
}

function stepRunState(
  stepId: FirstBloomStepId,
  projection: FirstBloomProjection,
): "DONE" | "STAY" | "FAIL" | "RUNNING" | null {
  if (projection.failedStepId === stepId) return "FAIL";
  if (projection.completedStepIds.includes(stepId)) return "DONE";
  if (
    projection.lastExecutedStepId === stepId &&
    projection.lastStepResult === "STAY"
  ) {
    return "STAY";
  }
  if (projection.currentStepId === stepId) return "RUNNING";
  return null;
}

function runtimeStatus(projection: FirstBloomProjection): string {
  if (projection.phase === "FINISHED") return "완성";
  if (projection.phase === "FAILED") return "멈춤";
  if (projection.waitingForBloomEvent) return "이벤트 대기";
  if (projection.phase === "READY" || projection.phase === "RUNNING") {
    return "실행 중";
  }
  return "조립 중";
}

function dropPartId(event: DragEvent): FirstBloomPartId | null {
  const value = event.dataTransfer.getData("application/x-flower-part");
  return FIRST_BLOOM_PARTS.some((part) => part.id === value)
    ? (value as FirstBloomPartId)
    : null;
}

export function FirstBloomMeadow() {
  const [draft, setDraft] = useState<FirstBloomDraft>(
    createEmptyFirstBloomDraft,
  );
  const [run, setRun] = useState<NormalizedRun | null>(null);
  const [events, setEvents] = useState<NormalizedRun["events"]>([]);
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState(
    "부품을 눌러 Flower를 조립하세요.",
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const [mobileLayout, setMobileLayout] = useState(true);
  const [mobileCameraEnabled, setMobileCameraEnabled] = useState(false);

  const draftCheck = useMemo(() => checkFirstBloomDraft(draft), [draft]);
  const projection = useMemo(
    () => projectFirstBloom(events),
    [events],
  );
  const terminal =
    projection.phase === "FINISHED" || projection.phase === "FAILED";
  const missionPassed =
    projection.phase === "FINISHED" &&
    projection.gardenState === "BLOOMED";
  const eventNeeded =
    projection.waitingForBloomEvent &&
    !projection.bloomEventPublished &&
    !terminal;
  const cameraControlsEnabled =
    !mobileLayout || mobileCameraEnabled;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = () => {
      setMobileLayout(media.matches);
      if (media.matches) setMobileCameraEnabled(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function updateDraft(
    updater: (current: FirstBloomDraft) => FirstBloomDraft,
    nextMessage: string,
  ) {
    if (busy || run) return;
    setDraft(updater);
    setMessage(nextMessage);
    setRuntimeError(null);
  }

  function addPart(partId: FirstBloomPartId, slot?: number) {
    const part = firstBloomPart(partId);
    updateDraft(
      (current) => placeFirstBloomPart(current, partId, slot),
      `${part.label} 부품을 놓았습니다.`,
    );
  }

  function removePart(partId: FirstBloomPartId) {
    const part = firstBloomPart(partId);
    updateDraft(
      (current) => removeFirstBloomPart(current, partId),
      `${part.label} 부품을 부품함으로 돌려보냈습니다.`,
    );
  }

  function moveStep(fromIndex: number, toIndex: number) {
    updateDraft(
      (current) => moveFirstBloomStep(current, fromIndex, toIndex),
      "Step 순서를 바꿨습니다.",
    );
  }

  function beginPartDrag(
    event: DragEvent<HTMLButtonElement>,
    partId: FirstBloomPartId,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-flower-part", partId);
  }

  function beginStepDrag(
    event: DragEvent<HTMLLIElement>,
    index: number,
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-flower-step-index",
      String(index),
    );
  }

  function dropOnStepSlot(
    event: DragEvent<HTMLLIElement>,
    targetIndex: number,
  ) {
    event.preventDefault();
    if (busy || run) return;
    const rawFromIndex = event.dataTransfer.getData(
      "application/x-flower-step-index",
    );
    const fromIndex = Number(rawFromIndex);
    if (rawFromIndex !== "" && Number.isInteger(fromIndex)) {
      moveStep(fromIndex, targetIndex);
      return;
    }
    const partId = dropPartId(event);
    if (
      partId === "prepare-soil" ||
      partId === "wait-for-sunlight" ||
      partId === "grow-stem" ||
      partId === "bloom"
    ) {
      addPart(partId, targetIndex);
    }
  }

  async function driveUntilPlayerInput(
    initialRun: NormalizedRun,
  ): Promise<NormalizedRun> {
    let current = initialRun;
    const pause = reducedMotion ? 40 : 520;

    for (let tick = 0; tick < 10; tick += 1) {
      const before = projectFirstBloom(current.events);
      if (before.phase === "FINISHED" || before.phase === "FAILED") {
        return current;
      }
      if (
        before.waitingForBloomEvent &&
        !before.bloomEventPublished
      ) {
        return current;
      }

      await wait(pause);
      const incoming = await tickFirstBloomRun(
        current.runId,
        latestSequence(current),
      );
      const next = acceptFirstBloomCumulativeRun(current, incoming);
      setRun(next);
      setEvents(next.events);
      current = next;

      const after = projectFirstBloom(next.events);
      if (
        after.phase === "FINISHED" ||
        after.phase === "FAILED" ||
        (after.waitingForBloomEvent &&
          !after.bloomEventPublished)
      ) {
        return next;
      }
    }

    throw new Error("Flower Flow가 안전 실행 한도를 넘었습니다.");
  }

  async function runDraft() {
    if (!draftCheck.ready || busy || run) return;
    setBusy("CREATING");
    setRuntimeError(null);
    setMessage("실제 Flower Runtime에 Flow를 만들고 있습니다.");

    try {
      const created = acceptFirstBloomCumulativeRun(
        null,
        await createFirstBloomRun(
          createFirstBloomBlueprint(draft),
        ),
      );
      setRun(created);
      setEvents(created.events);
      setBusy("RUNNING");
      setMessage("Worker가 조립한 Step을 순서대로 실행합니다.");
      const result = await driveUntilPlayerInput(created);
      const finalProjection = projectFirstBloom(result.events);
      if (
        finalProjection.waitingForBloomEvent &&
        !finalProjection.bloomEventPublished
      ) {
        setMessage("Flow가 햇빛 이벤트를 기다리고 있습니다.");
      } else if (finalProjection.phase === "FAILED") {
        setMessage("Step 순서를 고쳐서 다시 실행해 보세요.");
      } else if (finalProjection.phase === "FINISHED") {
        setMessage("꽃이 피었습니다!");
      }
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Flower Runtime에 연결하지 못했습니다.",
      );
      setRun(null);
      setEvents([]);
    } finally {
      setBusy(null);
    }
  }

  async function sendSunlightEvent() {
    if (!run || !eventNeeded || busy) return;
    setBusy("EVENT");
    setRuntimeError(null);
    setMessage("햇빛 이벤트를 보내는 중입니다.");

    try {
      const published = acceptFirstBloomCumulativeRun(
        run,
        await publishFirstBloomEvent(
          run.runId,
          latestSequence(run),
        ),
      );
      setRun(published);
      setEvents(published.events);
      await wait(reducedMotion ? 40 : 420);
      setBusy("RUNNING");
      const result = await driveUntilPlayerInput(published);
      const finalProjection = projectFirstBloom(result.events);
      setMessage(
        finalProjection.phase === "FINISHED"
          ? "꽃이 피었습니다!"
          : finalProjection.phase === "FAILED"
            ? "Step 순서를 고쳐서 다시 실행해 보세요."
            : "Worker가 이벤트를 확인했습니다.",
      );
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Bloom 이벤트를 보내지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }

  function editAgain() {
    if (busy) return;
    setRun(null);
    setEvents([]);
    setRuntimeError(null);
    setMessage("같은 부품을 다시 배열해 보세요.");
  }

  function resetAll() {
    if (busy) return;
    setDraft(createEmptyFirstBloomDraft());
    setRun(null);
    setEvents([]);
    setRuntimeError(null);
    setMessage("부품을 눌러 Flower를 조립하세요.");
  }

  const failureMessage =
    (projection.failureCode &&
      FAILURE_COPY[projection.failureCode]) ||
    projection.failureMessage ||
    "이 Step이 필요한 준비를 찾지 못했습니다.";

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="월드 선택으로">
          <span className={styles.brandMark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>Flower Garden</strong>
            <small>WORLD 01</small>
          </span>
        </Link>
        <div className={styles.missionTitle}>
          <span>MISSION</span>
          <h1>꽃 한 송이 피우기</h1>
        </div>
        <span
          className={joinClasses(
            styles.runtimeBadge,
            run && styles.live,
          )}
        >
          <i aria-hidden="true" />
          {run ? "LIVE FLOWER" : "BUILD"}
        </span>
      </header>

      <div className={styles.playfield}>
        <section
          className={joinClasses(
            styles.worldStage,
            cameraControlsEnabled && styles.cameraActive,
          )}
          aria-label="실제 Flower 실행의 3D 정원"
        >
          <div className={styles.missionChip}>
            <span>목표</span>
            <strong>Step을 연결해 꽃을 피우세요.</strong>
          </div>

          <div className={styles.runtimeHud}>
            <span>
              FLOW
              <strong>{runtimeStatus(projection)}</strong>
            </span>
            <span>
              STEP
              <strong>
                {projection.lastExecutedStepId ??
                  projection.currentStepId ??
                  "—"}
              </strong>
            </span>
            <span>
              RESULT
              <strong>{projection.lastStepResult ?? "—"}</strong>
            </span>
          </div>

          <Suspense
            fallback={
              <div className={styles.sceneLoading}>정원을 여는 중…</div>
            }
          >
            <FirstBloomScene
              projection={projection}
              reducedMotion={reducedMotion}
              cameraResetKey={cameraResetKey}
              cameraControlsEnabled={cameraControlsEnabled}
            />
          </Suspense>

          <div className={styles.cameraTools}>
            <span>
              {mobileLayout
                ? mobileCameraEnabled
                  ? "한 손가락 회전 · 두 손가락 줌"
                  : "화면을 밀어 아래로 스크롤"
                : "드래그 회전 · 휠 줌 · 우클릭 이동"}
            </span>
            <button
              type="button"
              className={styles.cameraToggle}
              onClick={() =>
                setMobileCameraEnabled((enabled) => !enabled)
              }
              aria-pressed={mobileCameraEnabled}
            >
              {mobileCameraEnabled ? "스크롤 모드" : "둘러보기"}
            </button>
            <button
              type="button"
              onClick={() => setCameraResetKey((value) => value + 1)}
            >
              전체 보기
            </button>
          </div>

          {eventNeeded && (
            <div className={styles.eventGate}>
              <span aria-hidden="true">☀</span>
              <div>
                <small>SUNLIGHT_GRANTED</small>
                <strong>햇빛을 기다리고 있어요</strong>
              </div>
              <button
                type="button"
                onClick={sendSunlightEvent}
                disabled={busy !== null}
                aria-label="☀ 햇빛 보내기 · SUNLIGHT_GRANTED 이벤트 보내기"
              >
                ☀ 햇빛 보내기
              </button>
            </div>
          )}

          {terminal && (
            <div
              className={joinClasses(
                styles.outcome,
                missionPassed ? styles.success : styles.failure,
              )}
              role="status"
            >
              <span aria-hidden="true">
                {missionPassed ? "✿" : "!"}
              </span>
              <div>
                <strong>
                  {missionPassed
                    ? "완성! 꽃이 피었습니다."
                    : `${projection.failedStepId ?? "Step"}에서 멈췄어요.`}
                </strong>
                <p>
                  {missionPassed
                    ? "조립한 순서대로 실제 Flower Flow가 실행됐습니다."
                    : failureMessage}
                </p>
              </div>
            </div>
          )}

          <p className={styles.srOnly}>
            Flow {projection.phase}. 정원 {projection.gardenState}. 현재 Step{" "}
            {projection.currentStepId ?? "없음"}. 결과{" "}
            {projection.lastStepResult ?? "없음"}.
          </p>
        </section>

        <aside className={styles.builder} aria-label="Flower 조립판">
          <div className={styles.builderHeading}>
            <div>
              <span>FLOW BUILDER</span>
              <h2>조립판</h2>
            </div>
            <strong>
              {draftCheck.placedCount}/{draftCheck.totalCount}
            </strong>
          </div>

          <section className={styles.palette} aria-labelledby="parts-title">
            <h3 id="parts-title">부품</h3>
            <div>
              {FIRST_BLOOM_PARTS.map((part) => {
                const placed = isFirstBloomPartPlaced(draft, part.id);
                return (
                  <button
                    key={part.id}
                    type="button"
                    draggable={!placed && !run && !busy}
                    data-color={part.color}
                    disabled={placed || Boolean(run) || Boolean(busy)}
                    onDragStart={(event) =>
                      beginPartDrag(event, part.id)
                    }
                    onClick={() => addPart(part.id)}
                    aria-label={`${part.label} ${
                      placed ? "배치됨" : "추가"
                    }`}
                  >
                    <span aria-hidden="true">{part.icon}</span>
                    <span>
                      <strong>{part.label}</strong>
                    </span>
                    <b aria-hidden="true">{placed ? "✓" : "+"}</b>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.machine} aria-label="Flower 실행 구조">
            <div className={styles.fixedNode}>
              <span aria-hidden="true">◉</span>
              <p>
                <small>RUNTIME</small>
                <strong>Engine</strong>
              </p>
            </div>
            <i className={styles.wire} aria-hidden="true" />
            <div
              className={joinClasses(
                styles.socketNode,
                draft.workerPlaced && styles.filled,
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dropPartId(event) === "worker") addPart("worker");
              }}
            >
              {draft.workerPlaced ? (
                <>
                  <span aria-hidden="true">⚙</span>
                  <p>
                    <small>EXECUTOR</small>
                    <strong>Worker</strong>
                  </p>
                  {!run && (
                    <button
                      type="button"
                      onClick={() => removePart("worker")}
                      aria-label="Worker 제거"
                    >
                      ×
                    </button>
                  )}
                </>
              ) : (
                <span>Worker 놓기</span>
              )}
            </div>
            <i className={styles.wire} aria-hidden="true" />
            <div
              className={joinClasses(
                styles.socketNode,
                draft.flowPlaced && styles.filled,
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dropPartId(event) === "flow") addPart("flow");
              }}
            >
              {draft.flowPlaced ? (
                <>
                  <span aria-hidden="true">◆</span>
                  <p>
                    <small>WORKFLOW</small>
                    <strong>Flow</strong>
                  </p>
                  {!run && (
                    <button
                      type="button"
                      onClick={() => removePart("flow")}
                      aria-label="Flow 제거"
                    >
                      ×
                    </button>
                  )}
                </>
              ) : (
                <span>Flow 놓기</span>
              )}
            </div>
          </section>

          <section className={styles.flowLane} aria-labelledby="flow-title">
            <div className={styles.flowLaneTitle}>
              <h3 id="flow-title">MY FLOW</h3>
              <span>위에서 아래로 실행</span>
            </div>
            <ol>
              {draft.stepSlots.map((stepId, index) => {
                const part = stepId ? firstBloomPart(stepId) : null;
                const state = stepId
                  ? stepRunState(stepId, projection)
                  : null;

                return (
                  <li
                    key={index}
                    className={joinClasses(
                      styles.stepSlot,
                      part && styles.hasStep,
                      state && styles[`state${state}`],
                    )}
                    draggable={Boolean(part) && !run && !busy}
                    onDragStart={(event) =>
                      beginStepDrag(event, index)
                    }
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropOnStepSlot(event, index)}
                  >
                    <span className={styles.slotNumber}>
                      {index + 1}
                    </span>
                    {part && stepId ? (
                      <>
                        <span
                          className={styles.stepIcon}
                          data-color={part.color}
                          aria-hidden="true"
                        >
                          {part.icon}
                        </span>
                        <p>
                          <strong>{part.label}</strong>
                          <small>{part.runtimeLabel}</small>
                        </p>
                        {state && (
                          <b className={styles.stepState}>{state}</b>
                        )}
                        {!run && (
                          <span className={styles.stepActions}>
                            <button
                              type="button"
                              onClick={() => moveStep(index, index - 1)}
                              disabled={index === 0}
                              aria-label={`${part.label} 위로`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveStep(index, index + 1)}
                              disabled={
                                index === draft.stepSlots.length - 1
                              }
                              aria-label={`${part.label} 아래로`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removePart(stepId)}
                              aria-label={`${part.label} 제거`}
                            >
                              ×
                            </button>
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={styles.emptySlot}>
                        Step을 여기에 놓으세요
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <div className={styles.builderMessage} aria-live="polite">
            <span aria-hidden="true">
              {runtimeError ? "!" : terminal ? "●" : "·"}
            </span>
            <p>{runtimeError ?? message}</p>
          </div>

          <div className={styles.runToolbar}>
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetAll}
              disabled={busy !== null}
            >
              초기화
            </button>
            {eventNeeded ? (
              <button
                type="button"
                className={styles.runButton}
                onClick={sendSunlightEvent}
                disabled={busy !== null}
                aria-label="☀ 햇빛 보내기 · SUNLIGHT_GRANTED 이벤트 보내기"
              >
                {busy === "EVENT"
                  ? "햇빛 보내는 중…"
                  : "☀ 햇빛 보내기"}
              </button>
            ) : run ? (
              <button
                type="button"
                className={styles.runButton}
                onClick={editAgain}
                disabled={busy !== null || (!terminal && !runtimeError)}
              >
                {busy
                  ? "실행 중…"
                  : runtimeError
                    ? "다시 조립"
                    : "고쳐보기"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.runButton}
                onClick={runDraft}
                disabled={!draftCheck.ready || busy !== null}
              >
                {busy
                  ? "Flower 실행 중…"
                  : draftCheck.ready
                    ? "▶ 실행"
                    : `필요: ${draftCheck.missing.join(" · ")}`}
              </button>
            )}
          </div>

          {events.length > 0 && (
            <details className={styles.eventDetails}>
              <summary>실행 이벤트 {events.length}개</summary>
              <ol>
                {events.slice(-8).map((event) => (
                  <li key={event.eventId}>
                    <span>{event.sequence}</span>
                    <code>{event.type}</code>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </aside>
      </div>
    </main>
  );
}
