package io.github.flowerjvm.garden.runtime.api;

import java.util.List;

/**
 * Reader-facing state of one learning run.
 *
 * <p>The phase and current step are copied from an actual Flower
 * {@code FlowSnapshot}; the 3D client treats this response as projection input,
 * never as a second workflow engine.
 */
public record RunView(
        String schemaVersion,
        String runId,
        String worldId,
        String missionId,
        String flowerRuntimeVersion,
        String phase,
        String currentStepId,
        List<TraceEvent> events,
        List<TraceEvent.EvidenceReference> evidence,
        Outcome outcome
) {
    public static final String SCHEMA_VERSION = "1.0.0";
    public static final String FLOWER_RUNTIME_VERSION = "0.1.2";

    public RunView {
        events = List.copyOf(events);
        evidence = List.copyOf(evidence);
    }

    public record Outcome(
            String schemaVersion,
            String status,
            String finalState,
            int workerTicks,
            String summary
    ) {
        public static final String SCHEMA_VERSION = "1.0.0";
    }
}
