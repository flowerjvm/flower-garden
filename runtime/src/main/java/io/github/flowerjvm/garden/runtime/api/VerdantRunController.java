package io.github.flowerjvm.garden.runtime.api;

import io.github.flowerjvm.garden.runtime.verdant.VerdantRunCoordinator;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@CrossOrigin(originPatterns = "*")
public final class VerdantRunController {

    private final VerdantRunCoordinator coordinator;

    public VerdantRunController(VerdantRunCoordinator coordinator) {
        this.coordinator = coordinator;
    }

    @PostMapping("/worlds/verdant-signal-garden/runs")
    public RunView createRun() {
        return coordinator.createRun();
    }
}
