package io.github.flowerjvm.garden.runtime.api;

import java.util.List;

/**
 * Player-authored, server-validated definition of the first Flower Flow.
 *
 * <p>Only stable palette ids cross the wire. The runtime maps those ids to
 * fresh Step instances; clients cannot submit Java class names or code.
 */
public record FirstBloomBlueprint(
        String schemaVersion,
        String workerId,
        String flowType,
        List<String> stepIds
) {
    public static final String SCHEMA_VERSION = "1.0.0";

    public FirstBloomBlueprint {
        if (stepIds != null) {
            stepIds = List.copyOf(stepIds);
        }
    }
}
