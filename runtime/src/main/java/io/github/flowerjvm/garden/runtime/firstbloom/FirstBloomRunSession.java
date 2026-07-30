package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.bloom.LocalEventBus;
import io.github.flowerjvm.bloom.flower.BloomEventBus;
import io.github.flowerjvm.flower.core.engine.Engine;
import io.github.flowerjvm.flower.core.flow.Flow;
import io.github.flowerjvm.flower.core.flow.FlowSnapshot;
import io.github.flowerjvm.flower.core.flow.FlowState;
import io.github.flowerjvm.flower.core.step.StepDefinition;
import io.github.flowerjvm.flower.core.time.ManualClock;
import io.github.flowerjvm.flower.core.worker.Worker;
import io.github.flowerjvm.garden.runtime.api.RunCommand;
import io.github.flowerjvm.garden.runtime.api.RunView;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;
import io.github.flowerjvm.garden.runtime.support.MissionTraceRecorder;
import io.github.flowerjvm.garden.runtime.support.RuntimeTraceListener;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;

final class FirstBloomRunSession {

    static final String WORLD_ID = "first-bloom-meadow";
    static final String MISSION_ID = "the-first-flow";

    private final String runId;
    private final ManualClock clock;
    private final MissionTraceRecorder recorder;
    private final LocalEventBus bloomEventBus;
    private final Worker worker;
    @SuppressWarnings("unused")
    private final Engine engine;
    private final Flow flow;
    private final FirstBloomPlotState plot;
    private final ReentrantLock commandLock = new ReentrantLock();
    private final Map<String, CommandReceipt> receiptsByCommandId = new LinkedHashMap<>();
    private int workerTicks;
    private int bloomEventsPublished;

    private FirstBloomRunSession(
            String runId,
            ManualClock clock,
            MissionTraceRecorder recorder,
            LocalEventBus bloomEventBus,
            Worker worker,
            Engine engine,
            Flow flow,
            FirstBloomPlotState plot
    ) {
        this.runId = runId;
        this.clock = clock;
        this.recorder = recorder;
        this.bloomEventBus = bloomEventBus;
        this.worker = worker;
        this.engine = engine;
        this.flow = flow;
        this.plot = plot;
    }

    static FirstBloomRunSession create(
            String runId,
            List<String> orderedStepIds
    ) {
        ManualClock clock = new ManualClock(0L);
        MissionTraceRecorder recorder = new MissionTraceRecorder(runId, clock);
        LocalEventBus bloomEventBus = LocalEventBus.create();
        Worker worker = Worker.builder(FirstBloomFlowFactory.WORKER_ID)
                .intervalMillis(100L)
                .build();
        Engine engine = Engine.builder()
                .clock(clock)
                .eventBus(BloomEventBus.wrap(bloomEventBus))
                .worker(worker)
                .listener(new RuntimeTraceListener(recorder))
                .build();

        // Manual mode is deliberate: no scheduler is started. Player TICK
        // commands are the only code path that calls worker.tickOnce().
        engine.attach();

        FirstBloomPlotState plot = new FirstBloomPlotState();
        Flow flow = FirstBloomFlowFactory.create(
                runId,
                orderedStepIds,
                plot,
                recorder);
        FirstBloomRunSession session = new FirstBloomRunSession(
                runId,
                clock,
                recorder,
                bloomEventBus,
                worker,
                engine,
                flow,
                plot);
        session.recordRunCreated();
        session.recordBlueprintAccepted();
        session.recordInitialPlot();
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
            validateEnvelope(command);
            String commandId = command.commandId();
            CommandReceipt existing = receiptsByCommandId.get(commandId);
            if (existing != null) {
                if (!existing.command().equals(command)) {
                    throw new IllegalArgumentException(
                            "commandId was already used with different command content: "
                                    + commandId);
                }
                // The side effect is idempotent, but the resource view is live.
                // Returning the current view prevents a delayed retry from
                // rewinding the client to the command's historical response.
                return buildView();
            }
            if (command.expectedSequence() != recorder.lastSequence()) {
                throw new IllegalArgumentException(
                        "expectedSequence " + command.expectedSequence()
                                + " does not match latest sequence " + recorder.lastSequence());
            }

            RunView response = switch (command.kind()) {
                case TICK -> executeTick(command);
                case PUBLISH_EVENT -> executePublishEvent(command);
                case ADVANCE_TIME, SEND_SIGNAL -> throw new IllegalArgumentException(
                        "First Bloom Meadow does not support " + command.kind());
            };
            receiptsByCommandId.put(
                    commandId,
                    new CommandReceipt(command));
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

    int bloomEventsPublished() {
        commandLock.lock();
        try {
            return bloomEventsPublished;
        } finally {
            commandLock.unlock();
        }
    }

    private RunView executeTick(RunCommand command) {
        requireExactPayload(command, Set.of());
        FlowSnapshot before = flow.snapshot();
        if (before.state().isTerminal()) {
            throw new IllegalArgumentException(
                    "Cannot TICK a terminal First Bloom run: " + before.state());
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
        Map<String, Object> completedDetails = new LinkedHashMap<>();
        completedDetails.put("workerTick", workerTicks);
        completedDetails.put("beforePhase", before.state().name());
        completedDetails.put("afterPhase", after.state().name());
        completedDetails.put("beforeStepId", before.currentStepId());
        completedDetails.put("afterStepId", after.currentStepId());
        completedDetails.put("commandId", command.commandId());
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.TICK_COMPLETED",
                flowReference(after),
                completedDetails);
        return buildView();
    }

    private RunView executePublishEvent(RunCommand command) {
        requireExactPayload(command, Set.of("type"));
        Object rawType = command.payload().get("type");
        if (!(rawType instanceof String eventType)
                || !"SUNLIGHT_GRANTED".equals(eventType)) {
            throw new IllegalArgumentException(
                    "PUBLISH_EVENT payload.type must be exactly SUNLIGHT_GRANTED");
        }

        FlowSnapshot snapshot = flow.snapshot();
        if (snapshot.state().isTerminal()) {
            throw new IllegalArgumentException(
                    "Cannot PUBLISH_EVENT to a terminal First Bloom run: "
                            + snapshot.state());
        }
        if (plot.sunlightGranted()) {
            throw new IllegalArgumentException(
                    "SUNLIGHT_GRANTED was already published for this First Bloom run");
        }

        // Persist the business fact first. The Bloom event only wakes an
        // active Step; a later Step still observes the durable session fact.
        plot.grantSunlight();
        bloomEventBus.publish(new SunlightGranted(runId));
        bloomEventsPublished++;

        Map<String, Object> published = commandDetails(command, flow.snapshot());
        published.put("eventType", eventType);
        published.put("eventClass", SunlightGranted.class.getSimpleName());
        published.put("gardenState", plot.gardenState().name());
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.BLOOM_EVENT_PUBLISHED",
                flowReference(flow.snapshot()),
                published);
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
                        "eventBus", "BloomEventBus(LocalEventBus)"));
    }

    private void recordBlueprintAccepted() {
        FlowSnapshot snapshot = flow.snapshot();
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.BLUEPRINT_ACCEPTED",
                flowReference(snapshot),
                Map.of(
                        "workerId", worker.name(),
                        "flowType", flow.flowId().flowType(),
                        "stepIds", actualStepIds()));
    }

    private void recordInitialPlot() {
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.PLOT_UPDATED",
                flowReference(flow.snapshot()),
                Map.of(
                        "gardenState", plot.gardenState().name(),
                        "reason", "RUN_CREATED"));
    }

    private void recordFlowReady() {
        FlowSnapshot snapshot = flow.snapshot();
        recorder.append(
                TraceEvent.Source.RUN_COORDINATOR,
                "GARDEN.FLOW_READY",
                flowReference(snapshot),
                Map.of(
                        "workerName", worker.name(),
                        "initialStepId", actualStepIds().get(0),
                        "stepIds", actualStepIds()));
    }

    private RunView buildView() {
        FlowSnapshot snapshot = flow.snapshot();
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
                outcome(snapshot));
    }

    private RunView.Outcome outcome(FlowSnapshot snapshot) {
        if (!snapshot.state().isTerminal()) {
            return null;
        }

        FirstBloomPlotState.GardenState gardenState = plot.gardenState();
        if (snapshot.state() == FlowState.FINISHED
                && gardenState == FirstBloomPlotState.GardenState.BLOOMED) {
            return new RunView.Outcome(
                    RunView.Outcome.SCHEMA_VERSION,
                    "PASSED",
                    gardenState.name(),
                    workerTicks,
                    "The player-built Flower Flow grew and bloomed the garden.");
        }

        Throwable failure = snapshot.failureCause();
        String summary = failure == null || failure.getMessage() == null
                ? "The player-built Flower Flow did not complete the mission."
                : failure.getMessage();
        return new RunView.Outcome(
                RunView.Outcome.SCHEMA_VERSION,
                "FAILED",
                gardenState.name(),
                workerTicks,
                summary);
    }

    private List<String> actualStepIds() {
        return flow.steps().stream()
                .map(StepDefinition::stepId)
                .toList();
    }

    private Map<String, Object> commandDetails(
            RunCommand command,
            FlowSnapshot snapshot
    ) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("kind", command.kind().name());
        details.put("workerTicks", workerTicks);
        details.put("phase", snapshot.state().name());
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

    private void requireExactPayload(
            RunCommand command,
            Set<String> expectedKeys
    ) {
        if (!command.payload().keySet().equals(expectedKeys)) {
            throw new IllegalArgumentException(
                    command.kind() + " payload must contain exactly " + expectedKeys);
        }
    }

    private record CommandReceipt(RunCommand command) {
    }
}
