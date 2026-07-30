package io.github.flowerjvm.garden.runtime.api;

import io.github.flowerjvm.garden.runtime.firstbloom.FirstBloomRunCoordinator;
import io.github.flowerjvm.garden.runtime.verdant.VerdantRunCoordinator;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Explicit two-world router for the shared run-command resource.
 *
 * <p>This remains compile-time wiring; it is not a dynamic plugin system.
 */
@RestController
@RequestMapping("/api/v1")
@CrossOrigin(originPatterns = "*")
public final class RunCommandController {

    private final FirstBloomRunCoordinator firstBloom;
    private final VerdantRunCoordinator verdant;

    public RunCommandController(
            FirstBloomRunCoordinator firstBloom,
            VerdantRunCoordinator verdant
    ) {
        this.firstBloom = firstBloom;
        this.verdant = verdant;
    }

    @PostMapping("/runs/{runId}/commands")
    public RunView command(
            @PathVariable String runId,
            @RequestBody RunCommand command
    ) {
        if (firstBloom.hasRun(runId)) {
            return firstBloom.execute(runId, command);
        }
        if (verdant.hasRun(runId)) {
            return verdant.execute(runId, command);
        }
        throw new RunNotFoundException(runId);
    }
}
