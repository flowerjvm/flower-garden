package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunNotFoundException;
import io.github.flowerjvm.garden.runtime.api.RunView;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Owns the in-memory registry of actual Flower runtime sessions.
 */
@Service
public final class FirstBloomRunCoordinator {

    private final Map<String, FirstBloomRunSession> sessions = new ConcurrentHashMap<>();
    private final Supplier<String> runIdFactory;

    public FirstBloomRunCoordinator() {
        this(() -> UUID.randomUUID().toString());
    }

    FirstBloomRunCoordinator(Supplier<String> runIdFactory) {
        this.runIdFactory = runIdFactory;
    }

    public RunView createRun() {
        String runId = runIdFactory.get();
        FirstBloomRunSession session = FirstBloomRunSession.create(runId);
        FirstBloomRunSession previous = sessions.putIfAbsent(runId, session);
        if (previous != null) {
            throw new IllegalStateException("Duplicate generated run id: " + runId);
        }
        return session.view();
    }

    public RunView execute(String runId, RunCommand command) {
        FirstBloomRunSession session = sessions.get(runId);
        if (session == null) {
            throw new RunNotFoundException(runId);
        }
        return session.execute(command);
    }

    int workerTicks(String runId) {
        FirstBloomRunSession session = sessions.get(runId);
        if (session == null) {
            throw new RunNotFoundException(runId);
        }
        return session.workerTicks();
    }
}
