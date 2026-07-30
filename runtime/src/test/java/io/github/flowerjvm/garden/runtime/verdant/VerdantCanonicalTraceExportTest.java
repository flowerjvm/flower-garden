package io.github.flowerjvm.garden.runtime.verdant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunView;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Exports canonical replay input from actual coordinator execution.
 *
 * <p>The generated files live under target and are deliberately not source
 * fixtures. The web/package workflow may review and copy them into its own
 * fixture location after the runtime tests pass.
 */
class VerdantCanonicalTraceExportTest {

    private final ObjectMapper objectMapper = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);

    @Test
    void exportsAllCanonicalScenariosFromActualFlowerRuns() throws Exception {
        Path output = Path.of("target", "generated-fixtures");
        Files.createDirectories(output);

        RunView signalFirst = signalFirst();
        RunView timeoutFirst = timeoutFirst();
        RunView sameTick = sameTick();

        write(output.resolve("verdant-signal-first.run-view.json"), signalFirst);
        write(output.resolve("verdant-timeout-first.run-view.json"), timeoutFirst);
        write(output.resolve("verdant-same-tick.run-view.json"), sameTick);

        assertThat(signalFirst.outcome().finalState()).isEqualTo("SIGNALED");
        assertThat(signalFirst.outcome().summary()).isEqualTo(
                "Signal was present and Timeout was false when the mission Step ticked.");
        assertThat(timeoutFirst.outcome().finalState()).isEqualTo("TIMED_OUT");
        assertThat(sameTick.outcome().finalState()).isEqualTo("SIGNALED");
        assertThat(sameTick.outcome().summary()).isEqualTo(
                "Signal won because the mission Step uses SIGNAL_THEN_TIMEOUT precedence.");
    }

    private RunView signalFirst() {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> "canonical-verdant-signal-first");
        RunView view = coordinator.createRun();
        view = execute(coordinator, view, "tick-init", RunCommand.CommandKind.TICK, Map.of());
        view = execute(
                coordinator,
                view,
                "advance-29s",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 29_000));
        view = execute(
                coordinator,
                view,
                "signal-at-29s",
                RunCommand.CommandKind.SEND_SIGNAL,
                Map.of("name", "yard-assignment"));
        view = execute(coordinator, view, "tick-decide", RunCommand.CommandKind.TICK, Map.of());
        return execute(coordinator, view, "tick-route", RunCommand.CommandKind.TICK, Map.of());
    }

    private RunView timeoutFirst() {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> "canonical-verdant-timeout-first");
        RunView view = coordinator.createRun();
        view = execute(coordinator, view, "tick-init", RunCommand.CommandKind.TICK, Map.of());
        view = execute(
                coordinator,
                view,
                "advance-deadline",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 30_000));
        view = execute(coordinator, view, "tick-timeout", RunCommand.CommandKind.TICK, Map.of());
        view = execute(
                coordinator,
                view,
                "late-signal",
                RunCommand.CommandKind.SEND_SIGNAL,
                Map.of("name", "yard-assignment"));
        return execute(coordinator, view, "tick-route", RunCommand.CommandKind.TICK, Map.of());
    }

    private RunView sameTick() {
        VerdantRunCoordinator coordinator =
                new VerdantRunCoordinator(() -> "canonical-verdant-same-tick");
        RunView view = coordinator.createRun();
        view = execute(coordinator, view, "tick-init", RunCommand.CommandKind.TICK, Map.of());
        view = execute(
                coordinator,
                view,
                "advance-deadline",
                RunCommand.CommandKind.ADVANCE_TIME,
                Map.of("millis", 30_000));
        view = execute(
                coordinator,
                view,
                "signal-at-deadline",
                RunCommand.CommandKind.SEND_SIGNAL,
                Map.of("name", "yard-assignment"));
        view = execute(coordinator, view, "tick-both", RunCommand.CommandKind.TICK, Map.of());
        return execute(coordinator, view, "tick-route", RunCommand.CommandKind.TICK, Map.of());
    }

    private RunView execute(
            VerdantRunCoordinator coordinator,
            RunView current,
            String commandId,
            RunCommand.CommandKind kind,
            Map<String, Object> payload
    ) {
        long latestSequence =
                current.events().get(current.events().size() - 1).sequence();
        return coordinator.execute(
                current.runId(),
                new RunCommand(
                        RunCommand.SCHEMA_VERSION,
                        commandId,
                        current.runId(),
                        latestSequence,
                        kind,
                        payload));
    }

    private void write(Path path, RunView view) throws Exception {
        objectMapper.writeValue(path.toFile(), view);
    }
}
