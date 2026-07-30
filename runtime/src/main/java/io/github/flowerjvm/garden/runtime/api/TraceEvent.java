package io.github.flowerjvm.garden.runtime.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Versioned fact recorded while the real Flower runtime is executing.
 */
public record TraceEvent(
        String schemaVersion,
        String eventId,
        String runId,
        long sequence,
        long logicalTimeMillis,
        Source source,
        String kind,
        FlowReference flow,
        Map<String, Object> payload,
        List<EvidenceReference> evidence
) {
    public static final String SCHEMA_VERSION = "1.0.0";

    public TraceEvent {
        payload = payload == null
                ? Collections.emptyMap()
                : Collections.unmodifiableMap(new LinkedHashMap<>(payload));
        evidence = evidence == null ? List.of() : List.copyOf(evidence);
    }

    public enum Source {
        RUN_COORDINATOR,
        FLOWER_LISTENER,
        FLOWER_EVENT_BUS,
        FLOWER_STEP
    }

    public record FlowReference(
            String type,
            String key,
            String state,
            String stepId,
            int stepNo
    ) {
    }

    public record EvidenceReference(
            EvidenceType type,
            String ref,
            String label
    ) {
    }

    public enum EvidenceType {
        CONTRACT,
        SOURCE,
        TEST
    }
}
