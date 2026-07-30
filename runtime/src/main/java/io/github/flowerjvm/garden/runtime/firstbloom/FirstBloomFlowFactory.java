package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.flower.core.flow.Flow;
import io.github.flowerjvm.flower.core.flow.FlowBuilder;
import io.github.flowerjvm.flower.core.step.Step;
import io.github.flowerjvm.flower.core.step.StepContext;
import io.github.flowerjvm.flower.core.step.StepResult;
import io.github.flowerjvm.garden.runtime.api.FirstBloomBlueprint;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;
import io.github.flowerjvm.garden.runtime.support.MissionTraceRecorder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class FirstBloomFlowFactory {

    static final String WORKER_ID = "first-bloom-worker";
    static final String FLOW_TYPE = "first-flow";
    static final String PREPARE_SOIL = "prepare-soil";
    static final String WAIT_FOR_SUNLIGHT = "wait-for-sunlight";
    static final String GROW_STEM = "grow-stem";
    static final String BLOOM = "bloom";
    static final List<String> CANONICAL_STEP_IDS = List.of(
            PREPARE_SOIL,
            WAIT_FOR_SUNLIGHT,
            GROW_STEM,
            BLOOM);

    private static final Set<String> ALLOWED_STEP_IDS =
            Set.copyOf(CANONICAL_STEP_IDS);
    private static final String SUNLIGHT_SIGNAL = "sunlight-granted";

    private FirstBloomFlowFactory() {
    }

    static List<String> validateBlueprint(FirstBloomBlueprint blueprint) {
        if (blueprint == null) {
            throw new IllegalArgumentException("First Bloom blueprint is required");
        }
        if (!FirstBloomBlueprint.SCHEMA_VERSION.equals(blueprint.schemaVersion())) {
            throw new IllegalArgumentException(
                    "Unsupported blueprint schemaVersion: " + blueprint.schemaVersion());
        }
        if (!WORKER_ID.equals(blueprint.workerId())) {
            throw new IllegalArgumentException(
                    "Unsupported workerId: " + blueprint.workerId()
                            + "; expected " + WORKER_ID);
        }
        if (!FLOW_TYPE.equals(blueprint.flowType())) {
            throw new IllegalArgumentException(
                    "Unsupported flowType: " + blueprint.flowType()
                            + "; expected " + FLOW_TYPE);
        }
        if (blueprint.stepIds() == null) {
            throw new IllegalArgumentException("blueprint.stepIds is required");
        }
        if (blueprint.stepIds().size() != CANONICAL_STEP_IDS.size()) {
            throw new IllegalArgumentException(
                    "blueprint.stepIds must contain exactly "
                            + CANONICAL_STEP_IDS.size() + " Steps");
        }

        List<String> ordered = new ArrayList<>(blueprint.stepIds().size());
        Set<String> unique = new LinkedHashSet<>();
        for (String stepId : blueprint.stepIds()) {
            if (stepId == null || stepId.isBlank()) {
                throw new IllegalArgumentException(
                        "blueprint.stepIds must not contain null or blank ids");
            }
            if (!ALLOWED_STEP_IDS.contains(stepId)) {
                throw new IllegalArgumentException(
                        "Unknown First Bloom Step id: " + stepId);
            }
            if (!unique.add(stepId)) {
                throw new IllegalArgumentException(
                        "Duplicate First Bloom Step id: " + stepId);
            }
            ordered.add(stepId);
        }
        if (!unique.equals(ALLOWED_STEP_IDS)) {
            throw new IllegalArgumentException(
                    "blueprint.stepIds must contain each First Bloom Step exactly once");
        }
        return List.copyOf(ordered);
    }

    static Flow create(
            String runId,
            List<String> orderedStepIds,
            FirstBloomPlotState plot,
            MissionTraceRecorder recorder
    ) {
        FlowBuilder builder = Flow.builder(FLOW_TYPE, runId);
        for (String stepId : orderedStepIds) {
            builder.step(stepId, createStep(stepId, plot, recorder));
        }
        return builder.build();
    }

    private static Step createStep(
            String stepId,
            FirstBloomPlotState plot,
            MissionTraceRecorder recorder
    ) {
        return switch (stepId) {
            case PREPARE_SOIL -> new PrepareSoilStep(plot, recorder);
            case WAIT_FOR_SUNLIGHT -> new WaitForSunlightStep(plot, recorder);
            case GROW_STEM -> new GrowStemStep(plot, recorder);
            case BLOOM -> new BloomStep(plot, recorder);
            default -> throw new IllegalArgumentException(
                    "Unknown First Bloom Step id: " + stepId);
        };
    }

    private static final class PrepareSoilStep extends Step {
        private final FirstBloomPlotState plot;
        private final MissionTraceRecorder recorder;

        private PrepareSoilStep(
                FirstBloomPlotState plot,
                MissionTraceRecorder recorder
        ) {
            this.plot = plot;
            this.recorder = recorder;
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            plot.prepareSoil();
            recordPlotUpdated(ctx, plot, recorder);
            recordResult(ctx, recorder, StepResult.Type.DONE, 1, null);
            return StepResult.done();
        }
    }

    private static final class WaitForSunlightStep extends Step {
        private final FirstBloomPlotState plot;
        private final MissionTraceRecorder recorder;
        private int tickCount;

        private WaitForSunlightStep(
                FirstBloomPlotState plot,
                MissionTraceRecorder recorder
        ) {
            this.plot = plot;
            this.recorder = recorder;
        }

        @Override
        protected void onEnter(StepContext ctx) {
            ctx.subscribe(SunlightGranted.class, event -> {
                if (ctx.flowId().flowKey().equals(event.runId())) {
                    ctx.signal(SUNLIGHT_SIGNAL, event);
                }
            });
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            tickCount++;
            if (!plot.soilPrepared()) {
                return missionBlocked(
                        ctx,
                        plot,
                        recorder,
                        new FirstBloomMissionException(
                                "SOIL_NOT_READY",
                                "wait-for-sunlight needs prepare-soil to finish first."));
            }
            if (!plot.sunlightGranted()) {
                recorder.append(
                        TraceEvent.Source.FLOWER_STEP,
                        "FIRST_BLOOM.SUNLIGHT_WAITING",
                        flowReference(ctx),
                        Map.of(
                                "gardenState", plot.gardenState().name(),
                                "signalPresent", ctx.hasSignal(SUNLIGHT_SIGNAL),
                                "stepTick", tickCount));
                recordResult(
                        ctx,
                        recorder,
                        StepResult.Type.STAY,
                        tickCount,
                        null);
                return StepResult.stay();
            }

            boolean signalPresent = ctx.hasSignal(SUNLIGHT_SIGNAL);
            plot.acceptSunlight();
            recorder.append(
                    TraceEvent.Source.FLOWER_STEP,
                    "FIRST_BLOOM.SUNLIGHT_ACCEPTED",
                    flowReference(ctx),
                    Map.of(
                            "gardenState", plot.gardenState().name(),
                            "signalPresent", signalPresent,
                            "domainFact", "sunlightGranted",
                            "stepTick", tickCount));
            recordPlotUpdated(ctx, plot, recorder);
            recordResult(
                    ctx,
                    recorder,
                    StepResult.Type.DONE,
                    tickCount,
                    null);
            return StepResult.done();
        }
    }

    private static final class GrowStemStep extends Step {
        private final FirstBloomPlotState plot;
        private final MissionTraceRecorder recorder;

        private GrowStemStep(
                FirstBloomPlotState plot,
                MissionTraceRecorder recorder
        ) {
            this.plot = plot;
            this.recorder = recorder;
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            try {
                plot.growStem();
            } catch (FirstBloomMissionException blocked) {
                return missionBlocked(ctx, plot, recorder, blocked);
            }
            recordPlotUpdated(ctx, plot, recorder);
            recordResult(ctx, recorder, StepResult.Type.DONE, 1, null);
            return StepResult.done();
        }
    }

    private static final class BloomStep extends Step {
        private final FirstBloomPlotState plot;
        private final MissionTraceRecorder recorder;

        private BloomStep(
                FirstBloomPlotState plot,
                MissionTraceRecorder recorder
        ) {
            this.plot = plot;
            this.recorder = recorder;
        }

        @Override
        protected StepResult onTick(StepContext ctx) {
            try {
                plot.bloom();
            } catch (FirstBloomMissionException blocked) {
                return missionBlocked(ctx, plot, recorder, blocked);
            }
            recordPlotUpdated(ctx, plot, recorder);
            recordResult(ctx, recorder, StepResult.Type.DONE, 1, null);
            return StepResult.done();
        }
    }

    private static StepResult missionBlocked(
            StepContext ctx,
            FirstBloomPlotState plot,
            MissionTraceRecorder recorder,
            FirstBloomMissionException blocked
    ) {
        recorder.append(
                TraceEvent.Source.FLOWER_STEP,
                "GARDEN.MISSION_BLOCKED",
                flowReference(ctx),
                Map.of(
                        "stepId", ctx.currentStepId(),
                        "code", blocked.code(),
                        "message", blocked.getMessage(),
                        "gardenState", plot.gardenState().name()));
        recordResult(
                ctx,
                recorder,
                StepResult.Type.FAIL,
                1,
                blocked.getMessage());
        return StepResult.fail(blocked);
    }

    private static void recordPlotUpdated(
            StepContext ctx,
            FirstBloomPlotState plot,
            MissionTraceRecorder recorder
    ) {
        recorder.append(
                TraceEvent.Source.FLOWER_STEP,
                "GARDEN.PLOT_UPDATED",
                flowReference(ctx),
                Map.of(
                        "gardenState", plot.gardenState().name(),
                        "stepId", ctx.currentStepId()));
    }

    private static void recordResult(
            StepContext ctx,
            MissionTraceRecorder recorder,
            StepResult.Type result,
            int stepTick,
            String error
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("result", result.name());
        payload.put("stepTick", stepTick);
        payload.put("stepNo", ctx.stepNo());
        if (error != null) {
            payload.put("error", error);
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
                                "Flower applies this actual StepResult to choose the next Flow state."),
                        new TraceEvent.EvidenceReference(
                                TraceEvent.EvidenceType.TEST,
                                "FirstBloomRunCoordinatorTest"
                                        + ".executesPlayerBlueprintAndBloomEventThroughActualFlowerRuntime",
                                "The runtime test drives this player-built Flow without sleeping.")));
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
