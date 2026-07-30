package io.github.flowerjvm.garden.runtime.verdant;

import io.github.flowerjvm.flower.core.flow.Flow;
import io.github.flowerjvm.flower.core.step.Step;
import io.github.flowerjvm.flower.core.step.StepContext;
import io.github.flowerjvm.flower.core.step.StepResult;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;
import io.github.flowerjvm.garden.runtime.support.MissionTraceRecorder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The real Flower definition behind the Signal vs Timeout mission.
 *
 * <p>The policy is intentionally visible in {@link WaitForYardAssignmentStep}:
 * when both predicates are true on one tick, Signal is checked first. Trace
 * sequence orders observations; it does not choose the branch.
 */
final class VerdantFlowFactory {

    static final String FLOW_TYPE = "signal-vs-timeout";
    static final String WAIT_FOR_YARD_ASSIGNMENT = "wait-for-yard-assignment";
    static final String YARD_MOVE = "yard-move";
    static final String TIMED_OUT = "timed-out";
    static final String SIGNAL_NAME = "yard-assignment";
    static final String CHECK_PRECEDENCE = "SIGNAL_THEN_TIMEOUT";
    static final long TIMEOUT_MILLIS = 30_000L;

    private VerdantFlowFactory() {
    }

    static Definition create(String runId, MissionTraceRecorder recorder) {
        WaitForYardAssignmentStep waiting = new WaitForYardAssignmentStep(recorder);
        Flow flow = Flow.builder(FLOW_TYPE, runId)
                .step(WAIT_FOR_YARD_ASSIGNMENT, waiting)
                .step(YARD_MOVE, new RouteStep(recorder, Winner.SIGNAL, YARD_MOVE))
                .step(TIMED_OUT, new RouteStep(recorder, Winner.TIMEOUT, TIMED_OUT))
                .build();
        return new Definition(flow, waiting);
    }

    record Definition(Flow flow, WaitForYardAssignmentStep waitingStep) {
    }

    record YardAssignmentSignal(String commandId, long sentAtMillis) {
    }

    enum Winner {
        NONE,
        SIGNAL,
        TIMEOUT
    }

    record Decision(
            Winner winner,
            String selectedPath,
            boolean signalPresent,
            boolean timedOut,
            long decidedAtMillis
    ) {
    }

    static final class WaitForYardAssignmentStep extends Step {
        private final MissionTraceRecorder recorder;
        private volatile boolean active;
        private volatile Long deadlineMillis;
        private volatile Decision decision;
        private int stepTick;

        private WaitForYardAssignmentStep(MissionTraceRecorder recorder) {
            this.recorder = recorder;
        }

        @Override
        protected void onEnter(StepContext ctx) {
            ctx.startTimeout(TIMEOUT_MILLIS);
            deadlineMillis = ctx.clock().currentTimeMillis() + TIMEOUT_MILLIS;
            active = true;
            ctx.subscribe(YardAssignmentSignal.class, event -> {
                // This is the actual Flower signal. The event-bus callback only
                // wakes the Step; the following Worker tick makes the decision.
                ctx.signal(SIGNAL_NAME, event);
                recorder.append(
                        TraceEvent.Source.FLOWER_EVENT_BUS,
                        "FLOWER.SIGNAL_RECEIVED",
                        flowReference(ctx),
                        Map.of(
                                "name", SIGNAL_NAME,
                                "commandId", event.commandId(),
                                "sentAtMillis", event.sentAtMillis(),
                                "elapsedMillis", ctx.elapsedMillis()));
            });

            recorder.append(
                    TraceEvent.Source.FLOWER_STEP,
                    "VERDANT.WAIT_STARTED",
                    flowReference(ctx),
                    Map.of(
                            "signalName", SIGNAL_NAME,
                            "timeoutMillis", TIMEOUT_MILLIS,
                            "startedAtMillis", ctx.clock().currentTimeMillis(),
                            "deadlineMillis", deadlineMillis,
                            "checkPrecedence", CHECK_PRECEDENCE),
                    VerdantEvidence.waitDecisionEvidence());
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            stepTick++;
            boolean signalPresent = ctx.hasSignal(SIGNAL_NAME);
            boolean timedOut = ctx.timedOut();

            // Mission policy: the Signal predicate is deliberately checked
            // before the timeout predicate. This is application code, not a
            // generic Flower arbitration rule.
            Winner winner = signalPresent
                    ? Winner.SIGNAL
                    : timedOut ? Winner.TIMEOUT : Winner.NONE;
            String selectedPath = switch (winner) {
                case SIGNAL -> YARD_MOVE;
                case TIMEOUT -> TIMED_OUT;
                case NONE -> "WAITING";
            };
            StepResult result = switch (winner) {
                case SIGNAL -> StepResult.goTo(YARD_MOVE);
                case TIMEOUT -> StepResult.goTo(TIMED_OUT);
                case NONE -> StepResult.stay();
            };

            Map<String, Object> evaluation = decisionPayload(
                    ctx, signalPresent, timedOut, winner, selectedPath, result);
            recorder.append(
                    TraceEvent.Source.FLOWER_STEP,
                    "VERDANT.WAIT_EVALUATED",
                    flowReference(ctx),
                    evaluation,
                    VerdantEvidence.waitDecisionEvidence());

            if (winner != Winner.NONE) {
                decision = new Decision(
                        winner,
                        selectedPath,
                        signalPresent,
                        timedOut,
                        ctx.clock().currentTimeMillis());
                recorder.append(
                        TraceEvent.Source.FLOWER_STEP,
                        "VERDANT.WAIT_DECIDED",
                        flowReference(ctx),
                        evaluation,
                        VerdantEvidence.waitDecisionEvidence());
                if (signalPresent && timedOut) {
                    recorder.append(
                            TraceEvent.Source.FLOWER_STEP,
                            "VERDANT.TIMEOUT_REJECTED",
                            flowReference(ctx),
                            Map.of(
                                    "reason", "SIGNAL_PRECEDENCE",
                                    "checkPrecedence", CHECK_PRECEDENCE,
                                    "selectedPath", selectedPath,
                                    "winner", winner.name()),
                            VerdantEvidence.waitDecisionEvidence());
                }
            }

            recordStepResult(ctx, recorder, result, stepTick, evaluation);
            return result;
        }

        @Override
        protected void onExit(StepContext ctx) {
            active = false;
        }

        boolean active() {
            return active;
        }

        Long deadlineMillis() {
            return deadlineMillis;
        }

        Decision decision() {
            return decision;
        }

        private Map<String, Object> decisionPayload(
                StepContext ctx,
                boolean signalPresent,
                boolean timedOut,
                Winner winner,
                String selectedPath,
                StepResult result
        ) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("signalPresent", signalPresent);
            payload.put("timedOut", timedOut);
            payload.put("elapsedMillis", ctx.elapsedMillis());
            payload.put("checkPrecedence", CHECK_PRECEDENCE);
            payload.put("returnedStepResult", result.type().name());
            payload.put("selectedPath", selectedPath);
            payload.put("winner", winner.name());
            payload.put("stepTick", stepTick);
            if (result.targetStepId() != null) {
                payload.put("targetStepId", result.targetStepId());
            }
            return payload;
        }
    }

    private static final class RouteStep extends Step {
        private final MissionTraceRecorder recorder;
        private final Winner winner;
        private final String selectedPath;

        private RouteStep(
                MissionTraceRecorder recorder,
                Winner winner,
                String selectedPath
        ) {
            this.recorder = recorder;
            this.winner = winner;
            this.selectedPath = selectedPath;
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            recorder.append(
                    TraceEvent.Source.FLOWER_STEP,
                    "VERDANT.ROUTE_COMMITTED",
                    flowReference(ctx),
                    Map.of(
                            "winner", winner.name(),
                            "selectedPath", selectedPath,
                            "resultingState", winner == Winner.SIGNAL
                                    ? "SIGNALED"
                                    : "TIMED_OUT"),
                    VerdantEvidence.waitDecisionEvidence());
            StepResult result = StepResult.finish();
            recordStepResult(ctx, recorder, result, 1, Map.of(
                    "winner", winner.name(),
                    "selectedPath", selectedPath));
            return result;
        }
    }

    private static void recordStepResult(
            StepContext ctx,
            MissionTraceRecorder recorder,
            StepResult result,
            int stepTick,
            Map<String, ?> observations
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("result", result.type().name());
        payload.put("stepTick", stepTick);
        payload.put("stepNo", ctx.stepNo());
        if (result.targetStepId() != null) {
            payload.put("targetStepId", result.targetStepId());
        }
        if (observations != null && !observations.isEmpty()) {
            payload.put("observations", new LinkedHashMap<>(observations));
        }
        recorder.append(
                TraceEvent.Source.FLOWER_STEP,
                "FLOWER.STEP_RESULT",
                flowReference(ctx),
                payload,
                List.of(
                        new TraceEvent.EvidenceReference(
                                TraceEvent.EvidenceType.SOURCE,
                                "flower-core:Flow.applyResult",
                                "Flower applies this actual StepResult to select the next Step or finish."),
                        new TraceEvent.EvidenceReference(
                                TraceEvent.EvidenceType.TEST,
                                "VerdantRunCoordinatorTest.sameTickUsesExplicitSignalFirstStepPolicyRegardlessOfInputCommandOrder",
                                "The deterministic both-true test verifies the mission Step's policy.")));
    }

    private static TraceEvent.FlowReference flowReference(StepContext ctx) {
        return new TraceEvent.FlowReference(
                ctx.flowId().flowType(),
                ctx.flowId().flowKey(),
                "RUNNING",
                ctx.currentStepId(),
                ctx.stepNo());
    }
}
