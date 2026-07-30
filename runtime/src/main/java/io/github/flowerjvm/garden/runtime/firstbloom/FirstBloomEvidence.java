package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.garden.runtime.api.TraceEvent;

import java.util.List;

final class FirstBloomEvidence {

    private FirstBloomEvidence() {
    }

    static List<TraceEvent.EvidenceReference> create() {
        return List.of(
                contract(
                        "the-first-flow.flower-is-source-of-truth",
                        "The 3D world projects the real Flower Flow state and never advances it locally."),
                contract(
                        "the-first-flow.one-command-one-tick",
                        "Every accepted TICK command calls Worker.tickOnce() exactly once."),
                contract(
                        "the-first-flow.player-blueprint-is-actual-flow",
                        "The accepted Step order is the order passed to the actual Flower FlowBuilder."),
                contract(
                        "the-first-flow.bloom-event-is-a-wake-hint",
                        "The Step observes stored sunlight state; the Bloom event only wakes an active wait."),
                source(
                        "flower-core:Engine.attach:116-129",
                        "Engine.attach() binds Clock, EventBus, listeners, and Worker without starting a scheduler."),
                source(
                        "bloom-flower-adapter:BloomEventBus.wrap",
                        "BloomEventBus connects Flower Step subscriptions to the run's LocalEventBus."),
                source(
                        "flower-core:Worker.tickOnce:365-397",
                        "Worker.tickOnce() applies pending submissions and ticks every active Flow once."),
                source(
                        "flower-core:Flow.tick:264-311",
                        "A Flow tick invokes at most one current Step before applying its StepResult."),
                source(
                        "flower-core:StepResult:10-27",
                        "STAY, DONE, and FAIL are explicit Flower runtime outcomes."),
                test(
                        "FirstBloomRunCoordinatorTest.executesPlayerBlueprintAndBloomEventThroughActualFlowerRuntime",
                        "Verifies the assembled Flow waits for a real Bloom event and reaches BLOOMED."),
                test(
                        "FirstBloomRunCoordinatorTest.persistedSunlightFactSurvivesEventPublishedBeforeWaitStepEnters",
                        "Verifies a stored domain fact survives an event published before the waiting Step subscribes."),
                test(
                        "FirstBloomRunCoordinatorTest.wrongOrderFailsInsideActualFlowerStep",
                        "Verifies a wrong assembly returns an actual StepResult.FAIL and failed Flower state."),
                test(
                        "FirstBloomRunControllerTest.createsActualPlayerBlueprintAndPublishesBloomEventWithoutTicking",
                        "Verifies the HTTP blueprint and Bloom event contract without an implicit Worker tick."),
                test(
                        "FirstBloomRunControllerTest.strictlyValidatesPublishEventPayloadAndUnsupportedCommands",
                        "Verifies only the exact SUNLIGHT_GRANTED event command reaches the run."));
    }

    private static TraceEvent.EvidenceReference contract(String ref, String label) {
        return new TraceEvent.EvidenceReference(TraceEvent.EvidenceType.CONTRACT, ref, label);
    }

    private static TraceEvent.EvidenceReference source(String ref, String label) {
        return new TraceEvent.EvidenceReference(TraceEvent.EvidenceType.SOURCE, ref, label);
    }

    private static TraceEvent.EvidenceReference test(String ref, String label) {
        return new TraceEvent.EvidenceReference(TraceEvent.EvidenceType.TEST, ref, label);
    }
}
