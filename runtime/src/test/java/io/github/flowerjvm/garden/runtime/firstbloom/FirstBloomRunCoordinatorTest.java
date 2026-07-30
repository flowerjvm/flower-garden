package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.garden.runtime.api.FirstBloomBlueprint;
import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunView;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class FirstBloomRunCoordinatorTest {

    @Test
    void executesPlayerBlueprintAndBloomEventThroughActualFlowerRuntime() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-first-bloom");

        RunView created = coordinator.createRun(canonicalBlueprint());
        assertThat(created.phase()).isEqualTo("READY");
        assertThat(created.currentStepId()).isNull();
        assertThat(coordinator.workerTicks(created.runId())).isZero();
        assertThat(eventTypes(created)).containsExactly(
                "GARDEN.RUN_CREATED",
                "GARDEN.BLUEPRINT_ACCEPTED",
                "GARDEN.PLOT_UPDATED",
                "GARDEN.FLOW_READY");
        assertThat(lastEventOfType(created, "GARDEN.BLUEPRINT_ACCEPTED")
                .payload().get("stepIds"))
                .isEqualTo(FirstBloomFlowFactory.CANONICAL_STEP_IDS);
        assertPlotState(created, "EMPTY");

        RunView prepared = coordinator.execute(
                created.runId(),
                tick(created, "tick-prepare"));
        assertThat(prepared.phase()).isEqualTo("RUNNING");
        assertThat(prepared.currentStepId())
                .isEqualTo(FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT);
        assertStepResult(prepared, FirstBloomFlowFactory.PREPARE_SOIL, "DONE");
        assertPlotState(prepared, "SOIL_READY");

        RunView waiting = coordinator.execute(
                created.runId(),
                tick(prepared, "tick-wait"));
        assertThat(waiting.currentStepId())
                .isEqualTo(FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT);
        assertStepResult(
                waiting,
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                "STAY");
        assertThat(eventTypes(waiting))
                .contains("FIRST_BLOOM.SUNLIGHT_WAITING");
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(2);

        RunView published = coordinator.execute(
                created.runId(),
                publishSunlight(waiting, "publish-sunlight"));
        assertThat(published.phase()).isEqualTo("RUNNING");
        assertThat(published.currentStepId())
                .isEqualTo(FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT);
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(2);
        assertThat(eventTypes(published))
                .contains("GARDEN.BLOOM_EVENT_PUBLISHED");

        RunView sunlightAccepted = coordinator.execute(
                created.runId(),
                tick(published, "tick-accept-sunlight"));
        assertThat(sunlightAccepted.currentStepId())
                .isEqualTo(FirstBloomFlowFactory.GROW_STEM);
        assertStepResult(
                sunlightAccepted,
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                "DONE");
        assertThat(eventTypes(sunlightAccepted))
                .contains("FIRST_BLOOM.SUNLIGHT_ACCEPTED");
        assertThat(lastEventOfType(
                sunlightAccepted,
                "FIRST_BLOOM.SUNLIGHT_ACCEPTED").payload().get("signalPresent"))
                .isEqualTo(true);
        assertPlotState(sunlightAccepted, "SUNLIGHT_READY");

        RunView stemGrown = coordinator.execute(
                created.runId(),
                tick(sunlightAccepted, "tick-grow"));
        assertThat(stemGrown.currentStepId())
                .isEqualTo(FirstBloomFlowFactory.BLOOM);
        assertStepResult(stemGrown, FirstBloomFlowFactory.GROW_STEM, "DONE");
        assertPlotState(stemGrown, "STEM_GROWN");

        RunView bloomed = coordinator.execute(
                created.runId(),
                tick(stemGrown, "tick-bloom"));
        assertThat(bloomed.phase()).isEqualTo("FINISHED");
        assertThat(bloomed.currentStepId()).isNull();
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(5);
        assertStepResult(bloomed, FirstBloomFlowFactory.BLOOM, "DONE");
        assertPlotState(bloomed, "BLOOMED");
        assertThat(eventTypes(bloomed)).contains("FLOWER.FLOW_FINISHED");
        assertThat(bloomed.outcome()).isNotNull();
        assertThat(bloomed.outcome().status()).isEqualTo("PASSED");
        assertThat(bloomed.outcome().finalState()).isEqualTo("BLOOMED");
    }

    @Test
    void persistedSunlightFactSurvivesEventPublishedBeforeWaitStepEnters() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-early-sunlight");
        RunView created = coordinator.createRun(canonicalBlueprint());

        RunView published = coordinator.execute(
                created.runId(),
                publishSunlight(created, "sun-before-wait"));
        assertThat(coordinator.workerTicks(created.runId())).isZero();

        RunView prepared = coordinator.execute(
                created.runId(),
                tick(published, "prepare"));
        RunView accepted = coordinator.execute(
                created.runId(),
                tick(prepared, "wait-observes-domain-fact"));

        assertThat(accepted.currentStepId())
                .isEqualTo(FirstBloomFlowFactory.GROW_STEM);
        assertStepResult(
                accepted,
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                "DONE");
        TraceEvent acceptedEvent =
                lastEventOfType(accepted, "FIRST_BLOOM.SUNLIGHT_ACCEPTED");
        assertThat(acceptedEvent.payload().get("signalPresent")).isEqualTo(false);
        assertThat(eventTypes(accepted))
                .doesNotContain("FIRST_BLOOM.SUNLIGHT_WAITING");
    }

    @Test
    void wrongOrderFailsInsideActualFlowerStep() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-wrong-order");
        FirstBloomBlueprint blueprint = blueprint(List.of(
                FirstBloomFlowFactory.GROW_STEM,
                FirstBloomFlowFactory.PREPARE_SOIL,
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                FirstBloomFlowFactory.BLOOM));

        RunView created = coordinator.createRun(blueprint);
        assertThat(lastEventOfType(created, "GARDEN.BLUEPRINT_ACCEPTED")
                .payload().get("stepIds"))
                .isEqualTo(blueprint.stepIds());

        RunView failed = coordinator.execute(
                created.runId(),
                tick(created, "tick-invalid-grow"));

        assertThat(failed.phase()).isEqualTo("FAILED");
        assertStepResult(failed, FirstBloomFlowFactory.GROW_STEM, "FAIL");
        TraceEvent blocked = lastEventOfType(failed, "GARDEN.MISSION_BLOCKED");
        assertThat(blocked.payload().get("stepId"))
                .isEqualTo(FirstBloomFlowFactory.GROW_STEM);
        assertThat(blocked.payload().get("code")).isEqualTo("SOIL_NOT_READY");
        assertThat(eventTypes(failed)).contains("FLOWER.FLOW_FAILED");
        assertThat(failed.outcome().status()).isEqualTo("FAILED");
        assertThat(failed.outcome().finalState()).isEqualTo("EMPTY");
        assertThat(eventTypes(failed))
                .doesNotContain("FLOWER.FLOW_FINISHED");
    }

    @Test
    void waitForSunlightFailsWhenSoilWasNotPreparedFirst() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-wait-before-soil");
        RunView created = coordinator.createRun(blueprint(List.of(
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                FirstBloomFlowFactory.PREPARE_SOIL,
                FirstBloomFlowFactory.GROW_STEM,
                FirstBloomFlowFactory.BLOOM)));
        RunView sunlightPublished = coordinator.execute(
                created.runId(),
                publishSunlight(created, "early-sunlight"));

        RunView failed = coordinator.execute(
                created.runId(),
                tick(sunlightPublished, "tick-wait-before-soil"));

        assertThat(failed.phase()).isEqualTo("FAILED");
        assertStepResult(
                failed,
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                "FAIL");
        TraceEvent blocked = lastEventOfType(failed, "GARDEN.MISSION_BLOCKED");
        assertThat(blocked.payload().get("stepId"))
                .isEqualTo(FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT);
        assertThat(blocked.payload().get("code")).isEqualTo("SOIL_NOT_READY");
        assertThat(eventTypes(failed))
                .doesNotContain("FIRST_BLOOM.SUNLIGHT_ACCEPTED");
    }

    @Test
    void bloomBeforeStemFailsWithExplicitPrerequisite() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-bloom-before-stem");
        RunView created = coordinator.createRun(blueprint(List.of(
                FirstBloomFlowFactory.BLOOM,
                FirstBloomFlowFactory.PREPARE_SOIL,
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                FirstBloomFlowFactory.GROW_STEM)));

        RunView failed = coordinator.execute(
                created.runId(),
                tick(created, "tick-bloom-before-stem"));

        assertThat(failed.phase()).isEqualTo("FAILED");
        assertStepResult(failed, FirstBloomFlowFactory.BLOOM, "FAIL");
        TraceEvent blocked = lastEventOfType(failed, "GARDEN.MISSION_BLOCKED");
        assertThat(blocked.payload().get("stepId"))
                .isEqualTo(FirstBloomFlowFactory.BLOOM);
        assertThat(blocked.payload().get("code")).isEqualTo("STEM_NOT_GROWN");
        assertThat(failed.outcome().finalState()).isEqualTo("EMPTY");
    }

    @Test
    void growStemFailsWhenSunlightWaitWasPlacedTooLate() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-late-wait");
        RunView created = coordinator.createRun(blueprint(List.of(
                FirstBloomFlowFactory.PREPARE_SOIL,
                FirstBloomFlowFactory.GROW_STEM,
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                FirstBloomFlowFactory.BLOOM)));

        RunView prepared = coordinator.execute(
                created.runId(),
                tick(created, "prepare"));
        RunView failed = coordinator.execute(
                created.runId(),
                tick(prepared, "grow-too-soon"));

        assertThat(failed.phase()).isEqualTo("FAILED");
        assertThat(lastEventOfType(failed, "GARDEN.MISSION_BLOCKED")
                .payload().get("code"))
                .isEqualTo("SUNLIGHT_NOT_READY");
        assertThat(failed.outcome().finalState()).isEqualTo("SOIL_READY");
    }

    @Test
    void publishCommandRetryIsIdempotentAndNeverTicksWorker() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-event-idempotent");
        RunView created = coordinator.createRun(canonicalBlueprint());
        RunCommand command = publishSunlight(created, "same-publish");

        RunView first = coordinator.execute(created.runId(), command);
        RunView retry = coordinator.execute(created.runId(), command);

        assertThat(retry).isEqualTo(first);
        assertThat(coordinator.workerTicks(created.runId())).isZero();
        assertThat(coordinator.bloomEventsPublished(created.runId())).isEqualTo(1);
        assertThat(first.events().stream()
                .filter(event -> event.kind().equals("GARDEN.BLOOM_EVENT_PUBLISHED")))
                .hasSize(1);

        RunCommand collision = publishSunlight(first, "same-publish");
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(created.runId(), collision))
                .withMessageContaining("already used with different command content");
        assertThat(coordinator.workerTicks(created.runId())).isZero();
        assertThat(coordinator.bloomEventsPublished(created.runId())).isEqualTo(1);
    }

    @Test
    void delayedCommandRetryReturnsCurrentViewWithoutReplayingSideEffect() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-delayed-retry");
        RunView created = coordinator.createRun(canonicalBlueprint());
        RunCommand original = publishSunlight(created, "publish-once");
        RunView published = coordinator.execute(created.runId(), original);
        RunView prepared = coordinator.execute(
                created.runId(),
                tick(published, "prepare-after-publish"));

        RunView delayedRetry = coordinator.execute(created.runId(), original);

        assertThat(delayedRetry).isEqualTo(prepared);
        assertThat(delayedRetry).isNotEqualTo(published);
        assertThat(delayedRetry.currentStepId())
                .isEqualTo(FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT);
        assertThat(coordinator.workerTicks(created.runId())).isEqualTo(1);
        assertThat(coordinator.bloomEventsPublished(created.runId())).isEqualTo(1);
        assertThat(delayedRetry.events().stream()
                .filter(event -> event.kind().equals("GARDEN.BLOOM_EVENT_PUBLISHED")))
                .hasSize(1);
    }

    @Test
    void differentCommandIdCannotPublishSunlightTwice() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-double-sunlight");
        RunView created = coordinator.createRun(canonicalBlueprint());
        RunView first = coordinator.execute(
                created.runId(),
                publishSunlight(created, "sunlight-one"));
        long sequenceAfterFirst = latestSequence(first);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(
                        created.runId(),
                        publishSunlight(first, "sunlight-two")))
                .withMessageContaining("already published");

        assertThat(coordinator.bloomEventsPublished(created.runId())).isEqualTo(1);
        assertThat(latestSequence(first)).isEqualTo(sequenceAfterFirst);
        assertThat(first.events().stream()
                .filter(event -> event.kind().equals("GARDEN.BLOOM_EVENT_PUBLISHED")))
                .hasSize(1);
    }

    @Test
    void publishEventDoesNotAdvanceAnyFlowerStepOrFlowTransition() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-publish-boundary");
        RunView created = coordinator.createRun(canonicalBlueprint());
        RunView prepared = coordinator.execute(
                created.runId(),
                tick(created, "prepare"));
        RunView waiting = coordinator.execute(
                created.runId(),
                tick(prepared, "enter-wait"));
        int eventCountBeforePublish = waiting.events().size();
        int workerTicksBeforePublish = coordinator.workerTicks(created.runId());

        RunView published = coordinator.execute(
                created.runId(),
                publishSunlight(waiting, "publish-only"));

        assertThat(published.phase()).isEqualTo(waiting.phase());
        assertThat(published.currentStepId()).isEqualTo(waiting.currentStepId());
        assertThat(coordinator.workerTicks(created.runId()))
                .isEqualTo(workerTicksBeforePublish);
        assertThat(published.events().subList(
                eventCountBeforePublish,
                published.events().size()).stream().map(TraceEvent::kind).toList())
                .containsExactly("GARDEN.BLOOM_EVENT_PUBLISHED");
    }

    @Test
    void rejectsStaleSequenceAndTerminalPublishWithoutChangingRuntime() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "run-publish-rejections");
        RunView created = coordinator.createRun(canonicalBlueprint());
        RunCommand stale = new RunCommand(
                RunCommand.SCHEMA_VERSION,
                "stale-publish",
                created.runId(),
                latestSequence(created) - 1L,
                RunCommand.CommandKind.PUBLISH_EVENT,
                Map.of("type", "SUNLIGHT_GRANTED"));

        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(created.runId(), stale))
                .withMessageContaining("expectedSequence");
        assertThat(coordinator.bloomEventsPublished(created.runId())).isZero();

        RunView published = coordinator.execute(
                created.runId(),
                publishSunlight(created, "valid-publish"));
        RunView prepared = coordinator.execute(
                created.runId(),
                tick(published, "prepare"));
        RunView accepted = coordinator.execute(
                created.runId(),
                tick(prepared, "accept"));
        RunView grown = coordinator.execute(
                created.runId(),
                tick(accepted, "grow"));
        RunView finished = coordinator.execute(
                created.runId(),
                tick(grown, "bloom"));
        assertThat(finished.phase()).isEqualTo("FINISHED");
        long terminalSequence = latestSequence(finished);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.execute(
                        created.runId(),
                        publishSunlight(finished, "terminal-publish")))
                .withMessageContaining("terminal");
        assertThat(coordinator.bloomEventsPublished(created.runId())).isEqualTo(1);
        assertThat(latestSequence(finished)).isEqualTo(terminalSequence);
    }

    @Test
    void validatesExactAllowlistedUniqueFourStepBlueprint() {
        FirstBloomRunCoordinator coordinator =
                new FirstBloomRunCoordinator(() -> "unused");

        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.createRun(null))
                .withMessageContaining("blueprint is required");
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.createRun(new FirstBloomBlueprint(
                        "0.9.0",
                        FirstBloomFlowFactory.WORKER_ID,
                        FirstBloomFlowFactory.FLOW_TYPE,
                        FirstBloomFlowFactory.CANONICAL_STEP_IDS)))
                .withMessageContaining("schemaVersion");
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.createRun(new FirstBloomBlueprint(
                        FirstBloomBlueprint.SCHEMA_VERSION,
                        "another-worker",
                        FirstBloomFlowFactory.FLOW_TYPE,
                        FirstBloomFlowFactory.CANONICAL_STEP_IDS)))
                .withMessageContaining("workerId");
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.createRun(new FirstBloomBlueprint(
                        FirstBloomBlueprint.SCHEMA_VERSION,
                        FirstBloomFlowFactory.WORKER_ID,
                        "another-flow",
                        FirstBloomFlowFactory.CANONICAL_STEP_IDS)))
                .withMessageContaining("flowType");
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.createRun(blueprint(List.of(
                        FirstBloomFlowFactory.PREPARE_SOIL,
                        FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                        FirstBloomFlowFactory.GROW_STEM))))
                .withMessageContaining("exactly 4");
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.createRun(blueprint(List.of(
                        FirstBloomFlowFactory.PREPARE_SOIL,
                        FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                        FirstBloomFlowFactory.GROW_STEM,
                        FirstBloomFlowFactory.GROW_STEM))))
                .withMessageContaining("Duplicate");
        assertThatIllegalArgumentException()
                .isThrownBy(() -> coordinator.createRun(blueprint(List.of(
                        FirstBloomFlowFactory.PREPARE_SOIL,
                        FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                        FirstBloomFlowFactory.GROW_STEM,
                        "run-arbitrary-code"))))
                .withMessageContaining("Unknown");
    }

    private FirstBloomBlueprint canonicalBlueprint() {
        return blueprint(FirstBloomFlowFactory.CANONICAL_STEP_IDS);
    }

    private FirstBloomBlueprint blueprint(List<String> stepIds) {
        return new FirstBloomBlueprint(
                FirstBloomBlueprint.SCHEMA_VERSION,
                FirstBloomFlowFactory.WORKER_ID,
                FirstBloomFlowFactory.FLOW_TYPE,
                stepIds);
    }

    private RunCommand tick(RunView current, String commandId) {
        return command(
                current,
                commandId,
                RunCommand.CommandKind.TICK,
                Map.of());
    }

    private RunCommand publishSunlight(RunView current, String commandId) {
        return command(
                current,
                commandId,
                RunCommand.CommandKind.PUBLISH_EVENT,
                Map.of("type", "SUNLIGHT_GRANTED"));
    }

    private RunCommand command(
            RunView current,
            String commandId,
            RunCommand.CommandKind kind,
            Map<String, Object> payload
    ) {
        long expectedSequence =
                current.events().get(current.events().size() - 1).sequence();
        return new RunCommand(
                RunCommand.SCHEMA_VERSION,
                commandId,
                current.runId(),
                expectedSequence,
                kind,
                payload);
    }

    private List<String> eventTypes(RunView view) {
        return view.events().stream().map(TraceEvent::kind).toList();
    }

    private long latestSequence(RunView view) {
        return view.events().get(view.events().size() - 1).sequence();
    }

    private void assertStepResult(
            RunView view,
            String stepId,
            String result
    ) {
        TraceEvent event = view.events().stream()
                .filter(candidate -> candidate.kind().equals("FLOWER.STEP_RESULT"))
                .filter(candidate -> candidate.flow() != null)
                .filter(candidate -> stepId.equals(candidate.flow().stepId()))
                .filter(candidate -> result.equals(candidate.payload().get("result")))
                .reduce((first, second) -> second)
                .orElseThrow();
        assertThat(event.source()).isEqualTo(TraceEvent.Source.FLOWER_STEP);
    }

    private void assertPlotState(RunView view, String gardenState) {
        assertThat(lastEventOfType(view, "GARDEN.PLOT_UPDATED")
                .payload().get("gardenState"))
                .isEqualTo(gardenState);
    }

    private TraceEvent lastEventOfType(RunView view, String type) {
        return view.events().stream()
                .filter(event -> type.equals(event.kind()))
                .reduce((first, second) -> second)
                .orElseThrow();
    }
}
