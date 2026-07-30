package io.github.flowerjvm.garden.runtime.api;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One versioned, idempotent player command sent to a live Flower Garden run.
 * All record fields are required by the wire contract.
 */
public record RunCommand(
        String schemaVersion,
        String commandId,
        String runId,
        Long expectedSequence,
        CommandKind kind,
        Map<String, Object> payload
) {
    public static final String SCHEMA_VERSION = "1.0.0";

    public RunCommand {
        if (payload != null) {
            payload = Map.copyOf(new LinkedHashMap<>(payload));
        }
    }

    public enum CommandKind {
        TICK,
        ADVANCE_TIME,
        SEND_SIGNAL,
        ADVANCE_TO_TIMEOUT
    }
}
