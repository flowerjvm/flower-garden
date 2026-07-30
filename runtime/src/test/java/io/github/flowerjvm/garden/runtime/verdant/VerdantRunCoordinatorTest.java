package io.github.flowerjvm.garden.runtime.verdant;

import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunView;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class VerdantRunCoordinatorTest {

    @Test
    void signalBeforeDeadlineSelectsYardMove() {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> "verdant-signal-first");
        RunView created = coordinator.createRun();

        assertThat(created.worldId()).isEqualTo("verdant-signal-garden");
        assertThat(created.missionId()).isEqualTo("signal-vs-timeout");
        assertThat(created.phase()).isEqualTo("READY");
        assertThat(eventKinds(created)).containsExactly(
                "GARDEN.RUN_CREATED",
                "GARDEN.FLOW_READY");

        RunView waiting = execute(
                coordinator, created, "tick-init", RunCommand.CommandKind.TICK, Map.of());
        assertThat(waiting.phase()).isEqualTo("RUNNING");
        assertThat(waiting.currentStepId()).isEqualTo("wait-for-yard-assignment");
        assertEvaluation(waiting, false, false, "NONE", "STAY", "WAITING");

        RunView advanced = execute(
                coordinator,
                waiting,
                "advance-29s",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 29_000));
        assertThat(coordinator.logicalTimeMillis(created.runId())).isEqualTo(29_000L);
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(1);
        assertThat(lastEvent(advanced, "GARDEN.TIME_ADVANCED").payload())
                .containsEntry("afterMillis", 29_000L)
                .containsEntry("deadlineMillis", 30_000L)
                .containsEntry("deadlineReached", false);

        RunView signalled = execute(
                coordinator,
                advanced,
                "signal-at-29s",
                RunCommand.CommandKind.SEND_SIGNAL,
                Map.of("name", "yard-assignment"));
        assertThat(eventKinds(signalled)).containsSubsequence(
                "GARDEN.SIGNAL_SEND_REQUESTED",
                "FLOWER.SIGNAL_RECEIVED",
                "GARDEN.SIGNAL_SENT");
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(1);

        RunView decided = execute(
                coordinator, signalled, "tick-decide", RunCommand.CommandKind.TICK, Map.of());
        assertThat(decided.phase()).isEqualTo("RUNNING");
        assertThat(decided.currentStepId()).isEqualTo("yard-move");
        assertEvaluation(decided, true, false, "SIGNAL", "GOTO", "yard-move");
        assertThat(lastEvent(decided, "VERDANT.WAIT_DECIDED").payload())
                .containsEntry("checkPrecedence", "SIGNAL_THEN_TIMEOUT")
                .containsEntry("targetStepId", "yard-move");
        assertThat(eventKinds(decided)).doesNotContain("VERDANT.TIMEOUT_REJECTED");

        RunView finished = execute(
                coordinator, decided, "tick-route", RunCommand.CommandKind.TICK, Map.of());
        assertThat(finished.phase()).isEqualTo("FINISHED");
        assertThat(finished.currentStepId()).isNull();
        assertThat(finished.outcome()).isNotNull();
        assertThat(finished.outcome().finalState()).isEqualTo("SIGNALED");
        assertThat(finished.outcome().workerTicks()).isEqualTo(3);
        assertThat(finished.outcome().summary()).isEqualTo(
                "Signal was present and Timeout was false when the mission Step ticked.");
        assertThat(lastEvent(finished, "VERDANT.ROUTE_COMMITTED").payload())
                .containsEntry("selectedPath", "yard-move")
                .containsEntry("resultingState", "SIGNALED");
        assertThat(eventKinds(finished)).contains("FLOWER.FLOW_FINISHED");
    }

    @Test
    void timeoutBeforeSignalSelectsTimeoutAndLateSignalCannotReopenWait() {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> "verdant-timeout-first");
        RunView created = coordinator.createRun();
        RunView waiting = execute(
                coordinator, created, "tick-init", RunCommand.CommandKind.TICK, Map.of());
        RunView deadline = execute(
                coordinator,
                waiting,
                "advance-deadline",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 30_000L));

        RunView decided = execute(
                coordinator, deadline, "tick-timeout", RunCommand.CommandKind.TICK, Map.of());
        assertThat(decided.currentStepId()).isEqualTo("timed-out");
        assertEvaluation(decided, false, true, "TIMEOUT", "GOTO", "timed-out");

        int eventsBeforeLateSignal = decided.events().size();
        RunView afterLateSignal = execute(
                coordinator,
                decided,
                "late-signal",
                RunCommand.CommandKind.SEND_SIGNAL,
                Map.of("name", "yard-assignment"));
        assertThat(afterLateSignal.phase()).isEqualTo("RUNNING");
        assertThat(afterLateSignal.currentStepId()).isEqualTo("timed-out");
        assertThat(afterLateSignal.outcome()).isNull();
        assertThat(afterLateSignal.events()).hasSize(eventsBeforeLateSignal + 2);
        assertThat(lastEvent(afterLateSignal, "GARDEN.SIGNAL_IGNORED").payload())
                .containsEntry("reason", "WAIT_STEP_NOT_ACTIVE")
                .containsEntry("deliveredToWait", false);
        assertThat(eventKinds(afterLateSignal))
                .doesNotContainSubsequence(
                        "GARDEN.SIGNAL_SEND_REQUESTED",
                        "FLOWER.SIGNAL_RECEIVED");
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(2);

        RunView finished = execute(
                coordinator,
                afterLateSignal,
                "tick-route",
                RunCommand.CommandKind.TICK,
                Map.of());
        assertThat(finished.phase()).isEqualTo("FINISHED");
        assertThat(finished.outcome().finalState()).isEqualTo("TIMED_OUT");
        assertThat(finished.outcome().workerTicks()).isEqualTo(3);
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(3);
    }

    @Test
    void timeoutBoundaryIsInclusiveAtThirtySeconds() {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> "verdant-timeout-boundary");
        RunView current = coordinator.createRun();
        current = execute(
                coordinator, current, "tick-init", RunCommand.CommandKind.TICK, Map.of());
        current = execute(
                coordinator,
                current,
                "advance-29999",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 29_999));

        current = execute(
                coordinator,
                current,
                "tick-before-deadline",
                RunCommand.CommandKind.TICK,
                Map.of());
        assertThat(current.currentStepId()).isEqualTo("wait-for-yard-assignment");
        assertEvaluation(current, false, false, "NONE", "STAY", "WAITING");
        assertThat(lastEvent(current, "VERDANT.WAIT_EVALUATED").payload())
                .containsEntry("elapsedMillis", 29_999L);

        current = execute(
                coordinator,
                current,
                "advance-final-millisecond",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 1));
        current = execute(
                coordinator,
                current,
                "tick-at-deadline",
                RunCommand.CommandKind.TICK,
                Map.of());

        assertThat(current.currentStepId()).isEqualTo("timed-out");
        assertEvaluation(current, false, true, "TIMEOUT", "GOTO", "timed-out");
        assertThat(lastEvent(current, "VERDANT.WAIT_EVALUATED").payload())
                .containsEntry("elapsedMillis", 30_000L);
    }

    @Test
    void sameTickUsesExplicitSignalFirstStepPolicyRegardlessOfInputCommandOrder() {
        RunView timeThenSignal = runBothTrueScenario(
                "verdant-same-time-time-first", true);
        RunView signalThenTime = runBothTrueScenario(
                "verdant-same-time-signal-first", false);

        for (RunView decided : List.of(timeThenSignal, signalThenTime)) {
            assertThat(decided.currentStepId()).isEqualTo("yard-move");
            assertEvaluation(decided, true, true, "SIGNAL", "GOTO", "yard-move");
            assertThat(lastEvent(decided, "VERDANT.WAIT_DECIDED").payload())
                    .containsEntry("checkPrecedence", "SIGNAL_THEN_TIMEOUT");
            assertThat(lastEvent(decided, "VERDANT.TIMEOUT_REJECTED").payload())
                    .containsEntry("reason", "SIGNAL_PRECEDENCE")
                    .containsEntry("winner", "SIGNAL");
        }
    }

    @Test
    void commandsAreStrictOptimisticAndIdempotent() {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> "verdant-command-contract");
        RunView created = coordinator.createRun();
        RunView waiting = execute(
                coordinator, created, "tick-init", RunCommand.CommandKind.TICK, Map.of());

        RunCommand advance = command(
                waiting,
                "advance-once",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 1_000));
        RunView first = coordinator.execute(created.runId(), advance);
        RunView retry = coordinator.execute(created.runId(), advance);
        assertThat(retry).isEqualTo(first);
        assertThat(coordinator.logicalTimeMillis(created.runId())).isEqualTo(1_000L);

        RunCommand commandIdCollision = new RunCommand(
                RunCommand.SCHEMA_VERSION,
                "advance-once",
                created.runId(),
                advance.expectedSequence(),
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 2_000));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(created.runId(), commandIdCollision))
                .withMessageContaining("already used with different");

        RunCommand stale = new RunCommand(
                RunCommand.SCHEMA_VERSION,
                "stale",
                created.runId(),
                advance.expectedSequence(),
                RunCommand.CommandKind.TICK,
                Map.of());
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(created.runId(), stale))
                .withMessageContaining("does not match latest sequence");

        RunCommand extraPayload = command(
                first,
                "bad-tick",
                RunCommand.CommandKind.TICK,
                Map.of("unexpected", true));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(created.runId(), extraPayload))
                .withMessageContaining("payload must contain exactly");

        RunCommand wrongSignal = command(
                first,
                "wrong-signal",
                RunCommand.CommandKind.SEND_SIGNAL,
                Map.of("name", "another-signal"));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(created.runId(), wrongSignal))
                .withMessageContaining("Unsupported Signal name");

        RunCommand outOfRange = command(
                first,
                "huge-advance",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 300_001));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(created.runId(), outOfRange))
                .withMessageContaining("between 1 and 300000");

        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(1);
        assertThat(coordinator.logicalTimeMillis(created.runId())).isEqualTo(1_000L);
    }

    private RunView runBothTrueScenario(String runId, boolean timeFirst) {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> runId);
        RunView current = coordinator.createRun();
        current = execute(
                coordinator, current, "tick-init", RunCommand.CommandKind.TICK, Map.of());
        if (timeFirst) {
            current = execute(
                    coordinator,
                    current,
                    "advance-deadline",
                    RunCommand.CommandKind.ADVANCE_TIME,
                    Map.of("millis", 30_000));
            current = execute(
                    coordinator,
                    current,
                    "signal-at-deadline",
                    RunCommand.CommandKind.SEND_SIGNAL,
                    Map.of("name", "yard-assignment"));
        } else {
            current = execute(
                    coordinator,
                    current,
                    "signal-at-zero",
                    RunCommand.CommandKind.SEND_SIGNAL,
                    Map.of("name", "yard-assignment"));
            current = execute(
                    coordinator,
                    current,
                    "advance-deadline",
                    RunCommand.CommandKind.ADVANCE_TIME,
                    Map.of("millis", 30_000));
        }
        return execute(
                coordinator, current, "tick-both-true", RunCommand.CommandKind.TICK, Map.of());
    }

    private RunView execute(
            VerdantRunCoordinator coordinator,
            RunView current,
            String commandId,
            RunCommand.CommandKind kind,
            Map<String, Object> payload
    ) {
        return coordinator.execute(
                current.runId(),
                command(current, commandId, kind, payload));
    }

    private RunCommand command(
            RunView current,
            String commandId,
            RunCommand.CommandKind kind,
            Map<String, Object> payload
    ) {
        return new RunCommand(
                RunCommand.SCHEMA_VERSION,
                commandId,
                current.runId(),
                latestSequence(current),
                kind,
                payload);
    }

    private long latestSequence(RunView view) {
        return view.events().get(view.events().size() - 1).sequence();
    }

    private List<String> eventKinds(RunView view) {
        return view.events().stream().map(TraceEvent::kind).toList();
    }

    private TraceEvent lastEvent(RunView view, String kind) {
        return view.events().stream()
                .filter(event -> kind.equals(event.kind()))
                .reduce((first, second) -> second)
                .orElseThrow();
    }

    private void assertEvaluation(
            RunView view,
            boolean signalPresent,
            boolean timedOut,
            String winner,
            String result,
            String selectedPath
    ) {
        assertThat(lastEvent(view, "VERDANT.WAIT_EVALUATED").payload())
                .containsEntry("signalPresent", signalPresent)
                .containsEntry("timedOut", timedOut)
                .containsEntry("winner", winner)
                .containsEntry("returnedStepResult", result)
                .containsEntry("selectedPath", selectedPath);
    }
}
