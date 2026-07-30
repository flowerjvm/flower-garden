package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.flower.core.time.ManualClock;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class MissionTraceRecorder {

    private final String runId;
    private final ManualClock clock;
    private final List<TraceEvent> events = new ArrayList<>();
    private long nextSequence = 1L;

    MissionTraceRecorder(String runId, ManualClock clock) {
        this.runId = runId;
        this.clock = clock;
    }

    synchronized TraceEvent append(
            TraceEvent.Source source,
            String kind,
            TraceEvent.FlowReference flow,
            Map<String, ?> payload,
            List<TraceEvent.EvidenceReference> evidence
    ) {
        Map<String, Object> safePayload = new LinkedHashMap<>();
        if (payload != null) {
            payload.forEach(safePayload::put);
        }
        long sequence = nextSequence++;
        TraceEvent event = new TraceEvent(
                TraceEvent.SCHEMA_VERSION,
                runId + ":" + String.format("%06d", sequence),
                runId,
                sequence,
                clock.currentTimeMillis(),
                source,
                kind,
                flow,
                safePayload,
                evidence);
        events.add(event);
        return event;
    }

    TraceEvent append(
            TraceEvent.Source source,
            String kind,
            TraceEvent.FlowReference flow,
            Map<String, ?> payload
    ) {
        return append(source, kind, flow, payload, List.of());
    }

    TraceEvent append(
            TraceEvent.Source source,
            String kind,
            TraceEvent.FlowReference flow
    ) {
        return append(source, kind, flow, Collections.emptyMap(), List.of());
    }

    synchronized List<TraceEvent> snapshot() {
        return List.copyOf(events);
    }

    synchronized long lastSequence() {
        return nextSequence - 1L;
    }
}
