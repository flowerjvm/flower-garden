package io.github.flowerjvm.garden.runtime.api;

public final class RunNotFoundException extends RuntimeException {

    public RunNotFoundException(String runId) {
        super("No Flower Garden run exists for id: " + runId);
    }
}
