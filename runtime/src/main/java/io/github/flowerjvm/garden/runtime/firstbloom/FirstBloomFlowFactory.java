package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.flower.core.flow.Flow;
import io.github.flowerjvm.flower.core.step.Step;
import io.github.flowerjvm.flower.core.step.StepContext;
import io.github.flowerjvm.flower.core.step.StepResult;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;

import java.util.List;
import java.util.Map;

final class FirstBloomFlowFactory {

    static final String FLOW_TYPE = "first-flow";
    static final String PREPARE_SOIL = "prepare-soil";
    static final String GROW_STEM = "grow-stem";
    static final String BLOOM = "bloom";

    private FirstBloomFlowFactory() {
    }

    static Flow create(String runId, MissionTraceRecorder recorder) {
        return Flow.builder(FLOW_TYPE, runId)
                .step(PREPARE_SOIL, new PrepareSoilStep(recorder))
                .step(GROW_STEM, new DoneStep(recorder))
                .step(BLOOM, new DoneStep(recorder))
                .build();
    }

    private static final class PrepareSoilStep extends Step {
        private final MissionTraceRecorder recorder;
        private int tickCount;

        private PrepareSoilStep(MissionTraceRecorder recorder) {
            this.recorder = recorder;
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            tickCount++;
            if (tickCount == 1) {
                recordResult(ctx, recorder, StepResult.Type.STAY, tickCount);
                return StepResult.stay();
            }
            recordResult(ctx, recorder, StepResult.Type.DONE, tickCount);
            return StepResult.done();
        }
    }

    private static final class DoneStep extends Step {
        private final MissionTraceRecorder recorder;

        private DoneStep(MissionTraceRecorder recorder) {
            this.recorder = recorder;
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            recordResult(ctx, recorder, StepResult.Type.DONE, 1);
            return StepResult.done();
        }
    }

    private static void recordResult(
            StepContext ctx,
            MissionTraceRecorder recorder,
            StepResult.Type result,
            int stepTick
    ) {
        recorder.append(
                TraceEvent.Source.FLOWER_STEP,
                "FLOWER.STEP_RESULT",
                new TraceEvent.FlowReference(
                        ctx.flowId().flowType(),
                        ctx.flowId().flowKey(),
                        "RUNNING",
                        ctx.currentStepId(),
                        ctx.stepNo()),
                Map.of(
                        "result", result.name(),
                        "stepTick", stepTick,
                        "stepNo", ctx.stepNo()),
                List.of(
                        new TraceEvent.EvidenceReference(
                                TraceEvent.EvidenceType.SOURCE,
                                "flower-core:Flow.applyResult",
                                "Flower applies this actual StepResult to choose the next Flow state."),
                        new TraceEvent.EvidenceReference(
                                TraceEvent.EvidenceType.TEST,
                                "FirstBloomRunCoordinatorTest.progressesOneActualFlowerTickAtATimeWithoutSleep",
                                "The runtime test verifies this StepResult sequence without sleeping.")));
    }
}
