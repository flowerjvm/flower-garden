package io.github.flowerjvm.garden.runtime.api;

import io.github.flowerjvm.garden.runtime.firstbloom.FirstBloomRunCoordinator;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(originPatterns = "*")
public final class FirstBloomRunController {

    private final FirstBloomRunCoordinator coordinator;

    public FirstBloomRunController(FirstBloomRunCoordinator coordinator) {
        this.coordinator = coordinator;
    }

    @PostMapping("/worlds/first-bloom-meadow/runs")
    public RunView createRun() {
        return coordinator.createRun();
    }

    @PostMapping("/runs/{runId}/commands")
    public RunView command(
            @PathVariable String runId,
            @RequestBody RunCommand command
    ) {
        return coordinator.execute(runId, command);
    }
}
