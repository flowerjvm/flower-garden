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
                source(
                        "flower-core:Engine.attach:116-129",
                        "Engine.attach() binds Clock, EventBus, listeners, and Worker without starting a scheduler."),
                source(
                        "flower-core:Worker.tickOnce:365-397",
                        "Worker.tickOnce() applies pending submissions and ticks every active Flow once."),
                source(
                        "flower-core:Flow.tick:264-311",
                        "A Flow tick invokes at most one current Step before applying its StepResult."),
                source(
                        "flower-core:StepResult:10-27",
                        "STAY and DONE are explicit Flower runtime outcomes."),
                test(
                        "FirstBloomRunCoordinatorTest.progressesOneActualFlowerTickAtATimeWithoutSleep",
                        "Verifies prepare-soil STAY, then DONE, grow-stem DONE, bloom DONE, and FINISHED."),
                test(
                        "FirstBloomRunCoordinatorTest.commandIdMakesTickRetryIdempotent",
                        "Verifies a retried command id does not tick Flower twice."),
                test(
                        "FirstBloomRunControllerTest.exposesReadyRunAndTickCommand",
                        "Verifies the HTTP create-and-tick contract."),
                test(
                        "FirstBloomRunControllerTest.rejectsMissingAndMismatchedWireFieldsWithoutTicking",
                        "Verifies required command fields, URL run identity, and optimistic sequence checks."),
                test(
                        "FirstBloomRunControllerTest.duplicateCommandIdReturnsSameResponseWithoutAnotherTick",
                        "Verifies HTTP retries with one command id return the original response without another tick."));
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
