package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunView;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FirstBloomRunCoordinatorTest {

    @Test
    void progressesOneActualFlowerTickAtATimeWithoutSleep() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-first-bloom");

        RunView created = coordinator.createRun();
        assertThat(created.phase()).isEqualTo("READY");
        assertThat(created.currentStepId()).isNull();
        assertThat(coordinator.workerTicks(created.runId())).isZero();
        assertThat(eventTypes(created)).containsExactly(
                "GARDEN.RUN_CREATED",
                "GARDEN.FLOW_READY");

        RunView firstTick = coordinator.execute(
                created.runId(),
                tick(created, "tick-1"));
        assertThat(firstTick.phase()).isEqualTo("RUNNING");
        assertThat(firstTick.currentStepId()).isEqualTo("prepare-soil");
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(1);
        assertStepResult(firstTick, "prepare-soil", "STAY", 1);
        assertThat(eventTypes(firstTick)).containsSubsequence(
                "GARDEN.TICK_REQUESTED",
                "FLOWER.FLOW_SUBMITTED",
                "FLOWER.STEP_ENTERED",
                "FLOWER.STEP_RESULT",
                "GARDEN.TICK_COMPLETED");

        RunView secondTick = coordinator.execute(
                created.runId(),
                tick(firstTick, "tick-2"));
        assertThat(secondTick.phase()).isEqualTo("RUNNING");
        assertThat(secondTick.currentStepId()).isEqualTo("grow-stem");
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(2);
        assertStepResult(secondTick, "prepare-soil", "DONE", 2);
        assertThat(lastEventOfType(secondTick, "FLOWER.STEP_EXITED").flow().stepId())
                .isEqualTo("prepare-soil");

        RunView thirdTick = coordinator.execute(
                created.runId(),
                tick(secondTick, "tick-3"));
        assertThat(thirdTick.phase()).isEqualTo("RUNNING");
        assertThat(thirdTick.currentStepId()).isEqualTo("bloom");
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(3);
        assertStepResult(thirdTick, "grow-stem", "DONE", 1);

        RunView fourthTick = coordinator.execute(
                created.runId(),
                tick(thirdTick, "tick-4"));
        assertThat(fourthTick.phase()).isEqualTo("FINISHED");
        assertThat(fourthTick.currentStepId()).isNull();
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(4);
        assertStepResult(fourthTick, "bloom", "DONE", 1);
        assertThat(eventTypes(fourthTick)).contains("FLOWER.FLOW_FINISHED");
        assertThat(fourthTick.outcome()).isNotNull();
        assertThat(fourthTick.outcome().finalState()).isEqualTo("FIRST_BLOOM");
        assertThat(fourthTick.outcome().workerTicks()).isEqualTo(4);
    }

    @Test
    void commandIdMakesTickRetryIdempotent() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-idempotent");
        RunView created = coordinator.createRun();
        RunCommand command = tick(created, "same-command");

        RunView first = coordinator.execute(created.runId(), command);
        RunView retry = coordinator.execute(created.runId(), command);

        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(1);
        assertThat(retry).isEqualTo(first);
        assertThat(retry.events()).hasSameSizeAs(first.events());
    }

    private RunCommand tick(RunView current, String commandId) {
        long expectedSequence = current.events().get(current.events().size() - 1).sequence();
        return new RunCommand(
                RunCommand.SCHEMA_VERSION,
                commandId,
                current.runId(),
                expectedSequence,
                RunCommand.CommandKind.TICK,
                Map.of());
    }

    private List<String> eventTypes(RunView view) {
        return view.events().stream().map(TraceEvent::kind).toList();
    }

    private void assertStepResult(
            RunView view,
            String stepId,
            String result,
            int stepTick
    ) {
        TraceEvent event = view.events().stream()
                .filter(candidate -> candidate.kind().equals("FLOWER.STEP_RESULT"))
                .filter(candidate -> candidate.flow() != null)
                .filter(candidate -> stepId.equals(candidate.flow().stepId()))
                .filter(candidate -> result.equals(candidate.payload().get("result")))
                .filter(candidate -> Integer.valueOf(stepTick).equals(candidate.payload().get("stepTick")))
                .reduce((first, second) -> second)
                .orElseThrow();
        assertThat(event.source()).isEqualTo(TraceEvent.Source.FLOWER_STEP);
    }

    private TraceEvent lastEventOfType(RunView view, String type) {
        return view.events().stream()
                .filter(event -> type.equals(event.kind()))
                .reduce((first, second) -> second)
                .orElseThrow();
    }
}
