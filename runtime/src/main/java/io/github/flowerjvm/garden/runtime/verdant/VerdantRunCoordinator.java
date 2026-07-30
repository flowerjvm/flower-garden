package io.github.flowerjvm.garden.runtime.verdant;

import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunNotFoundException;
import io.github.flowerjvm.garden.runtime.api.RunView;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * In-memory registry for authoritative Verdant Flower experiment sessions.
 */
@Service
public final class VerdantRunCoordinator {

    private final Map<String, VerdantRunSession> sessions = new ConcurrentHashMap<>();
    private final Supplier<String> runIdFactory;

    public VerdantRunCoordinator() {
        this(() -> "verdant-" + UUID.randomUUID());
    }

    VerdantRunCoordinator(Supplier<String> runIdFactory) {
        this.runIdFactory = runIdFactory;
    }

    public RunView createRun() {
        String runId = runIdFactory.get();
        VerdantRunSession session = VerdantRunSession.create(runId);
        VerdantRunSession previous = sessions.putIfAbsent(runId, session);
        if (previous != null) {
            throw new IllegalStateException("Duplicate generated run id: " + runId);
        }
        return session.view();
    }

    public RunView execute(String runId, RunCommand command) {
        VerdantRunSession session = sessions.get(runId);
        if (session == null) {
            throw new RunNotFoundException(runId);
        }
        return session.execute(command);
    }

    public boolean hasRun(String runId) {
        return sessions.containsKey(runId);
    }

    int workerTicks(String runId) {
        VerdantRunSession session = requiredSession(runId);
        return session.workerTicks();
    }

    long logicalTimeMillis(String runId) {
        VerdantRunSession session = requiredSession(runId);
        return session.logicalTimeMillis();
    }

    private VerdantRunSession requiredSession(String runId) {
        VerdantRunSession session = sessions.get(runId);
        if (session == null) {
            throw new RunNotFoundException(runId);
        }
        return session;
    }
}
