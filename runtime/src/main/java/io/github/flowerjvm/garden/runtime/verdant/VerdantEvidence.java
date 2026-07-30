package io.github.flowerjvm.garden.runtime.verdant;

import io.github.flowerjvm.garden.runtime.api.TraceEvent;

import java.util.List;

final class VerdantEvidence {

    private VerdantEvidence() {
    }

    static List<TraceEvent.EvidenceReference> create() {
        return List.of(
                contract(
                        "signal-vs-timeout.flower-is-source-of-truth",
                        "Commands create inputs; the actual Flower StepResult selects the route."),
                contract(
                        "signal-vs-timeout.signal-is-a-wake-up-hint",
                        "The event callback sets a Flower signal, while onTick decides the transition."),
                contract(
                        "signal-vs-timeout.signal-first-precedence",
                        "When both predicates are true, this mission Step checks Signal before Timeout."),
                contract(
                        "signal-vs-timeout.exited-wait-cannot-reopen",
                        "A later Signal is ignored after Flower exits the waiting Step."),
                source(
                        "VerdantFlowFactory.WaitForYardAssignmentStep.onTick",
                        "Contains the explicit SIGNAL_THEN_TIMEOUT predicate order and returned StepResult."),
                source(
                        "flower-core:StepContext.startTimeout",
                        "Starts the actual transient Flower timeout from the ManualClock."),
                source(
                        "flower-core:StepContext.hasSignal",
                        "Reads the actual Step-local Flower signal on a Worker tick."),
                source(
                        "flower-core:Flow.applyResult",
                        "Applies GOTO and FINISH results inside the Flower runtime."),
                test(
                        "VerdantRunCoordinatorTest.signalBeforeDeadlineSelectsYardMove",
                        "Verifies the signal-first timeline without sleeps."),
                test(
                        "VerdantRunCoordinatorTest.timeoutBeforeSignalSelectsTimeoutAndLateSignalCannotReopenWait",
                        "Verifies timeout selection and ignored late Signal."),
                test(
                        "VerdantRunCoordinatorTest.timeoutBoundaryIsInclusiveAtThirtySeconds",
                        "Verifies 29,999ms stays waiting and 30,000ms observes timedOut=true."),
                test(
                        "VerdantRunCoordinatorTest.sameTickUsesExplicitSignalFirstStepPolicyRegardlessOfInputCommandOrder",
                        "Verifies both predicates true selects Signal because of mission Step source order."),
                test(
                        "VerdantRunCoordinatorTest.commandsAreStrictOptimisticAndIdempotent",
                        "Verifies payload validation, expected sequence, and command retry semantics."),
                test(
                        "VerdantRunControllerTest.exposesCreateAndAllThreeCommandKinds",
                        "Verifies the HTTP wire contract for create, time, Signal, and tick."));
    }

    static List<TraceEvent.EvidenceReference> waitDecisionEvidence() {
        return List.of(
                source(
                        "VerdantFlowFactory.WaitForYardAssignmentStep.onTick",
                        "The Step checks hasSignal before timedOut and returns the recorded StepResult."),
                test(
                        "VerdantRunCoordinatorTest.sameTickUsesExplicitSignalFirstStepPolicyRegardlessOfInputCommandOrder",
                        "Both predicates are true on the same deterministic Worker tick."));
    }

    private static TraceEvent.EvidenceReference contract(String ref, String label) {
        return new TraceEvent.EvidenceReference(
                TraceEvent.EvidenceType.CONTRACT, ref, label);
    }

    private static TraceEvent.EvidenceReference source(String ref, String label) {
        return new TraceEvent.EvidenceReference(
                TraceEvent.EvidenceType.SOURCE, ref, label);
    }

    private static TraceEvent.EvidenceReference test(String ref, String label) {
        return new TraceEvent.EvidenceReference(
                TraceEvent.EvidenceType.TEST, ref, label);
    }
}
