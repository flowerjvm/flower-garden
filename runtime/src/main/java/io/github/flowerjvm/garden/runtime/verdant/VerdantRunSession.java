package io.github.flowerjvm.garden.runtime.verdant;

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
import io.github.flowerjvm.garden.runtime.support.MissionTraceRecorder;
import io.github.flowerjvm.garden.runtime.support.RuntimeTraceListener;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;

final class VerdantRunSession {

    static final String WORLD_ID = "verdant-signal-garden";
    static final String MISSION_ID = "signal-vs-timeout";
    private static final String WORKER_NAME = "verdant-interactive-worker";
    private static final long MAX_ADVANCE_MILLIS = 300_000L;

    private final String runId;
    private final ManualClock clock;
    private final MissionTraceRecorder recorder;
    private final InMemoryEventBus eventBus;
    private final Worker worker;
    @SuppressWarnings("unused")
    private final Engine engine;
    private final Flow flow;
    private final VerdantFlowFactory.WaitForYardAssignmentStep waitingStep;
    private final ReentrantLock commandLock = new ReentrantLock();
    private final Map<String, CommandReceipt> receiptsByCommandId = new LinkedHashMap<>();
    private int workerTicks;

    private VerdantRunSession(
            String runId,
            ManualClock clock,
            MissionTraceRecorder recorder,
            InMemoryEventBus eventBus,
            Worker worker,
            Engine engine,
            Flow flow,
            VerdantFlowFactory.WaitForYardAssignmentStep waitingStep
    ) {
        this.runId = runId;
        this.clock = clock;
        this.recorder = recorder;
        this.eventBus = eventBus;
        this.worker = worker;
        this.engine = engine;
        this.flow = flow;
        this.waitingStep = waitingStep;
    }

    static VerdantRunSession create(String runId) {
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

        // Each experiment owns a ManualClock, so its attached runtime is
        // intentionally isolated. No scheduler or sleep participates.
        engine.attach();

        VerdantFlowFactory.Definition definition =
                VerdantFlowFactory.create(runId, recorder);
        VerdantRunSession session = new VerdantRunSession(
                runId,
                clock,
                recorder,
                eventBus,
                worker,
                engine,
                definition.flow(),
                definition.waitingStep());
        session.recordRunCreated();
        worker.submit(definition.flow());
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
            validateEnvelope(command);

            CommandReceipt existing = receiptsByCommandId.get(command.commandId());
            if (existing != null) {
                if (!existing.command().equals(command)) {
                    throw new IllegalArgumentException(
                            "commandId was already used with different command content: "
                                    + command.commandId());
                }
                return existing.response();
            }

            if (command.expectedSequence() != recorder.lastSequence()) {
                throw new IllegalArgumentException(
                        "expectedSequence " + command.expectedSequence()
                                + " does not match latest sequence " + recorder.lastSequence());
            }

            RunView response = switch (command.kind()) {
                case TICK -> executeTick(command);
                case ADVANCE_TIME -> executeAdvanceTime(command);
                case SEND_SIGNAL -> executeSendSignal(command);
                case PUBLISH_EVENT -> throw new IllegalArgumentException(
                        "Verdant Signal Garden does not support PUBLISH_EVENT");
            };
            receiptsByCommandId.put(
                    command.commandId(),
                    new CommandReceipt(command, response));
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

    long logicalTimeMillis() {
        commandLock.lock();
        try {
            return clock.currentTimeMillis();
        } finally {
            commandLock.unlock();
        }
    }

    private RunView executeTick(RunCommand command) {
        requireExactPayload(command, Set.of());
        FlowSnapshot before = flow.snapshot();
        if (before.state().isTerminal()) {
            throw new IllegalArgumentException(
                    "Cannot TICK a terminal Verdant run: " + before.state());
        }

        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.TICK_REQUESTED",
                flowReference(before),
                commandDetails(command, before));

        // Contract: exactly one real Flower Worker tick per accepted TICK.
        worker.tickOnce();
        workerTicks++;

        FlowSnapshot after = flow.snapshot();
        Map<String, Object> completed = new LinkedHashMap<>();
        completed.put("workerTick", workerTicks);
        completed.put("beforePhase", before.state().name());
        completed.put("afterPhase", after.state().name());
        completed.put("beforeStepId", before.currentStepId());
        completed.put("afterStepId", after.currentStepId());
        completed.put("commandId", command.commandId());
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.TICK_COMPLETED",
                flowReference(after),
                completed);
        return buildView();
    }

    private RunView executeAdvanceTime(RunCommand command) {
        requireExactPayload(command, Set.of("millis"));
        long millis = requiredIntegralLong(command.payload().get("millis"), "payload.millis");
        if (millis < 1L || millis > MAX_ADVANCE_MILLIS) {
            throw new IllegalArgumentException(
                    "payload.millis must be between 1 and "
                            + MAX_ADVANCE_MILLIS + ": " + millis);
        }
        long beforeMillis = clock.currentTimeMillis();
        long afterMillis;
        try {
            afterMillis = Math.addExact(beforeMillis, millis);
        } catch (ArithmeticException overflow) {
            throw new IllegalArgumentException("logical clock overflow", overflow);
        }

        FlowSnapshot snapshot = flow.snapshot();
        Map<String, Object> requested = commandDetails(command, snapshot);
        requested.put("beforeMillis", beforeMillis);
        requested.put("millis", millis);
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.TIME_ADVANCE_REQUESTED",
                flowReference(snapshot),
                requested);

        clock.advance(millis);

        Map<String, Object> advanced = new LinkedHashMap<>();
        advanced.put("commandId", command.commandId());
        advanced.put("beforeMillis", beforeMillis);
        advanced.put("millis", millis);
        advanced.put("afterMillis", afterMillis);
        advanced.put("deadlineMillis", waitingStep.deadlineMillis());
        advanced.put("deadlineReached",
                waitingStep.deadlineMillis() != null
                        && afterMillis >= waitingStep.deadlineMillis());
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.TIME_ADVANCED",
                flowReference(flow.snapshot()),
                advanced);
        return buildView();
    }

    private RunView executeSendSignal(RunCommand command) {
        requireExactPayload(command, Set.of("name"));
        Object rawName = command.payload().get("name");
        if (!(rawName instanceof String name) || name.isBlank()) {
            throw new IllegalArgumentException("payload.name must be a non-blank string");
        }
        if (!VerdantFlowFactory.SIGNAL_NAME.equals(name)) {
            throw new IllegalArgumentException(
                    "Unsupported Signal name: " + name
                            + "; expected " + VerdantFlowFactory.SIGNAL_NAME);
        }

        FlowSnapshot before = flow.snapshot();
        Map<String, Object> requested = commandDetails(command, before);
        requested.put("name", name);
        requested.put("waitStepActive", waitingStep.active());
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.SIGNAL_SEND_REQUESTED",
                flowReference(before),
                requested);

        boolean waitWasActive = waitingStep.active();
        eventBus.publish(new VerdantFlowFactory.YardAssignmentSignal(
                command.commandId(),
                clock.currentTimeMillis()));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("commandId", command.commandId());
        result.put("name", name);
        result.put("publishedAtMillis", clock.currentTimeMillis());
        result.put("deliveredToWait", waitWasActive);
        if (waitWasActive) {
            recorder.append(
                    TraceEvent.Source.RUN_COORDINATOR,
                    "GARDEN.SIGNAL_SENT",
                    flowReference(flow.snapshot()),
                    result);
        } else {
            result.put("reason", "WAIT_STEP_NOT_ACTIVE");
            recorder.append(
                    TraceEvent.Source.RUN_COORDINATOR,
                    "GARDEN.SIGNAL_IGNORED",
                    flowReference(flow.snapshot()),
                    result);
        }
        return buildView();
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
                        "workerName", worker.name(),
                        "timeoutMillis", VerdantFlowFactory.TIMEOUT_MILLIS,
                        "checkPrecedence", VerdantFlowFactory.CHECK_PRECEDENCE));
    }

    private void recordFlowReady() {
        FlowSnapshot snapshot = flow.snapshot();
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.FLOW_READY",
                flowReference(snapshot),
                Map.of(
                        "workerName", worker.name(),
                        "initialStepId", VerdantFlowFactory.WAIT_FOR_YARD_ASSIGNMENT));
    }

    private RunView buildView() {
        FlowSnapshot snapshot = flow.snapshot();
        VerdantFlowFactory.Decision decision = waitingStep.decision();
        RunView.Outcome outcome = snapshot.state() == FlowState.FINISHED && decision != null
                ? new RunView.Outcome(
                        RunView.Outcome.SCHEMA_VERSION,
                        "COMPLETED",
                        decision.winner() == VerdantFlowFactory.Winner.SIGNAL
                                ? "SIGNALED"
                                : "TIMED_OUT",
                        workerTicks,
                        decision.winner() == VerdantFlowFactory.Winner.SIGNAL
                                ? decision.timedOut()
                                        ? "Signal won because the mission Step uses "
                                                + "SIGNAL_THEN_TIMEOUT precedence."
                                        : "Signal was present and Timeout was false "
                                                + "when the mission Step ticked."
                                : "Timeout won because no Signal was present when the mission Step ticked.")
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
                VerdantEvidence.create(),
                outcome);
    }

    private Map<String, Object> commandDetails(
            RunCommand command,
            FlowSnapshot snapshot
    ) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("kind", command.kind().name());
        details.put("expectedSequence", command.expectedSequence());
        details.put("commandId", command.commandId());
        details.put("workerTicks", workerTicks);
        details.put("phase", snapshot.state().name());
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

    private void validateEnvelope(RunCommand command) {
        if (command == null || command.kind() == null) {
            throw new IllegalArgumentException("command.kind is required");
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
            throw new IllegalArgumentException(
                    "command.expectedSequence must not be negative");
        }
        if (command.payload() == null) {
            throw new IllegalArgumentException("command.payload is required");
        }
    }

    private void requireExactPayload(RunCommand command, Set<String> expectedKeys) {
        if (!command.payload().keySet().equals(expectedKeys)) {
            throw new IllegalArgumentException(
                    command.kind() + " payload must contain exactly " + expectedKeys);
        }
    }

    private long requiredIntegralLong(Object value, String fieldName) {
        if (!(value instanceof Number number)) {
            throw new IllegalArgumentException(fieldName + " must be an integer");
        }
        if (number instanceof Float || number instanceof Double) {
            double decimal = number.doubleValue();
            if (!Double.isFinite(decimal) || decimal != Math.rint(decimal)) {
                throw new IllegalArgumentException(fieldName + " must be an integer");
            }
        }
        long result = number.longValue();
        if (number instanceof java.math.BigInteger integer
                && integer.bitLength() > 63) {
            throw new IllegalArgumentException(fieldName + " is outside the long range");
        }
        if (number instanceof java.math.BigDecimal decimal) {
            try {
                return decimal.longValueExact();
            } catch (ArithmeticException invalid) {
                throw new IllegalArgumentException(
                        fieldName + " must be an integer in the long range", invalid);
            }
        }
        return result;
    }

    private record CommandReceipt(RunCommand command, RunView response) {
    }
}
