package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.flower.core.engine.Engine;
import io.github.flowerjvm.flower.core.event.InMemoryEventBus;
import io.github.flowerjvm.flower.core.flow.Flow;
import io.github.flowerjvm.flower.core.flow.FlowSnapshot;
import io.github.flowerjvm.flower.core.flow.FlowState;
import io.github.flowerjvm.flower.core.time.ManualClock;
import io.github.flowerjvm.flower.core.worker.Worker;
import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunView;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

final class FirstBloomRunSession {

    static final String WORLD_ID = "first-bloom-meadow";
    static final String MISSION_ID = "the-first-flow";
    private static final String WORKER_NAME = "first-bloom-worker";

    private final String runId;
    private final ManualClock clock;
    private final MissionTraceRecorder recorder;
    private final Worker worker;
    private final Engine engine;
    private final Flow flow;
    private final ReentrantLock commandLock = new ReentrantLock();
    private final Map<String, RunView> responsesByCommandId = new LinkedHashMap<>();
    private int workerTicks;

    private FirstBloomRunSession(
            String runId,
            ManualClock clock,
            MissionTraceRecorder recorder,
            Worker worker,
            Engine engine,
            Flow flow
    ) {
        this.runId = runId;
        this.clock = clock;
        this.recorder = recorder;
        this.worker = worker;
        this.engine = engine;
        this.flow = flow;
    }

    static FirstBloomRunSession create(String runId) {
        ManualClock clock = new ManualClock(0L);
        MissionTraceRecorder recorder = new MissionTraceRecorder(runId, clock);
        InMemoryEventBus eventBus = InMemoryEventBus.create();
        Worker worker = Worker.builder(WORKER_NAME)
                .intervalMillis(100L)
                .build();
        Engine engine = Engine.builder()
                .clock(clock)
                .eventBus(eventBus)
                .worker(worker)
                .listener(new RuntimeTraceListener(recorder))
                .build();

        // Manual mode is deliberate: no scheduler is started. Player TICK
        // commands are the only code path that calls worker.tickOnce().
        engine.attach();

        Flow flow = FirstBloomFlowFactory.create(runId, recorder);
        FirstBloomRunSession session = new FirstBloomRunSession(
                runId, clock, recorder, worker, engine, flow);
        session.recordRunCreated();
        worker.submit(flow);
        session.recordFlowReady();
        return session;
    }

    RunView view() {
        commandLock.lock();
        try {
            return buildView();
        } finally {
            commandLock.unlock();
        }
    }

    RunView execute(RunCommand command) {
        commandLock.lock();
        try {
            validateCommand(command);
            String commandId = command.commandId();
            if (responsesByCommandId.containsKey(commandId)) {
                return responsesByCommandId.get(commandId);
            }
            if (command.expectedSequence() != recorder.lastSequence()) {
                throw new IllegalArgumentException(
                        "expectedSequence " + command.expectedSequence()
                                + " does not match latest sequence " + recorder.lastSequence());
            }

            FlowSnapshot before = flow.snapshot();
            recorder.append(
                    TraceEvent.Source.RUN_COORDINATOR,
                    "GARDEN.TICK_REQUESTED",
                    flowReference(before),
                    commandDetails(command, before));

            // Contract: exactly one real Flower Worker tick per accepted TICK.
            worker.tickOnce();
            workerTicks++;

            FlowSnapshot after = flow.snapshot();
            Map<String, Object> completedDetails = new LinkedHashMap<>();
            completedDetails.put("workerTick", workerTicks);
            completedDetails.put("beforePhase", before.state().name());
            completedDetails.put("afterPhase", after.state().name());
            completedDetails.put("beforeStepId", before.currentStepId());
            completedDetails.put("afterStepId", after.currentStepId());
            completedDetails.put("commandId", commandId);
            recorder.append(
                    TraceEvent.Source.RUN_COORDINATOR,
                    "GARDEN.TICK_COMPLETED",
                    flowReference(after),
                    completedDetails);

            RunView response = buildView();
            responsesByCommandId.put(commandId, response);
            return response;
        } finally {
            commandLock.unlock();
        }
    }

    int workerTicks() {
        commandLock.lock();
        try {
            return workerTicks;
        } finally {
            commandLock.unlock();
        }
    }

    private void recordRunCreated() {
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.RUN_CREATED",
                null,
                Map.of(
                        "driveMode", "MANUAL",
                        "engineLifecycle", "ATTACHED",
                        "clock", ManualClock.class.getSimpleName(),
                        "workerName", worker.name()));
    }

    private void recordFlowReady() {
        FlowSnapshot snapshot = flow.snapshot();
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.FLOW_READY",
                flowReference(snapshot),
                Map.of("workerName", worker.name()));
    }

    private RunView buildView() {
        FlowSnapshot snapshot = flow.snapshot();
        RunView.Outcome outcome = snapshot.state() == FlowState.FINISHED
                ? new RunView.Outcome(
                        RunView.Outcome.SCHEMA_VERSION,
                        "COMPLETED",
                        "FIRST_BLOOM",
                        workerTicks,
                        "The actual Flower Flow completed prepare-soil, grow-stem, and bloom.")
                : null;

        return new RunView(
                RunView.SCHEMA_VERSION,
                runId,
                WORLD_ID,
                MISSION_ID,
                RunView.FLOWER_RUNTIME_VERSION,
                snapshot.state().name(),
                snapshot.currentStepId(),
                recorder.snapshot(),
                FirstBloomEvidence.create(),
                outcome);
    }

    private Map<String, Object> commandDetails(RunCommand command, FlowSnapshot snapshot) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("kind", command.kind().name());
        details.put("nextWorkerTick", workerTicks + 1);
        details.put("expectedSequence", command.expectedSequence());
        details.put("commandId", command.commandId());
        return details;
    }

    private TraceEvent.FlowReference flowReference(FlowSnapshot snapshot) {
        return new TraceEvent.FlowReference(
                snapshot.flowId().flowType(),
                snapshot.flowId().flowKey(),
                snapshot.state().name(),
                snapshot.currentStepId(),
                snapshot.currentStepNo());
    }

    private void validateCommand(RunCommand command) {
        if (command == null || command.kind() == null) {
            throw new IllegalArgumentException("command.kind is required");
        }
        if (command.kind() != RunCommand.CommandKind.TICK) {
            throw new IllegalArgumentException(
                    "First Bloom Meadow only supports TICK, received: " + command.kind());
        }
        if (command.schemaVersion() == null || command.schemaVersion().isBlank()) {
            throw new IllegalArgumentException("command.schemaVersion is required");
        }
        if (!RunCommand.SCHEMA_VERSION.equals(command.schemaVersion())) {
            throw new IllegalArgumentException(
                    "Unsupported command schemaVersion: " + command.schemaVersion());
        }
        if (command.commandId() == null || command.commandId().isBlank()) {
            throw new IllegalArgumentException("command.commandId is required");
        }
        if (command.runId() == null || command.runId().isBlank()) {
            throw new IllegalArgumentException("command.runId is required");
        }
        if (!runId.equals(command.runId())) {
            throw new IllegalArgumentException(
                    "Command runId does not match URL runId: " + command.runId());
        }
        if (command.expectedSequence() == null) {
            throw new IllegalArgumentException("command.expectedSequence is required");
        }
        if (command.expectedSequence() < 0L) {
            throw new IllegalArgumentException("command.expectedSequence must not be negative");
        }
        if (command.payload() == null) {
            throw new IllegalArgumentException("command.payload is required");
        }
        if (!command.payload().isEmpty()) {
            throw new IllegalArgumentException("TICK payload must be empty");
        }
    }
}
