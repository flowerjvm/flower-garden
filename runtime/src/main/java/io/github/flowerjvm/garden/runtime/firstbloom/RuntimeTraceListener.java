package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.flower.core.flow.FlowSnapshot;
import io.github.flowerjvm.flower.core.listener.FlowerListener;
import io.github.flowerjvm.garden.runtime.api.TraceEvent;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Records only immutable lifecycle facts and returns immediately to Flower's
 * Worker thread.
 */
final class RuntimeTraceListener implements FlowerListener {

    private final MissionTraceRecorder recorder;

    RuntimeTraceListener(MissionTraceRecorder recorder) {
        this.recorder = recorder;
    }

    @Override
    public void onFlowSubmitted(FlowSnapshot flow) {
        record("FLOWER.FLOW_SUBMITTED", flow, null, null);
    }

    @Override
    public void onStepEntered(FlowSnapshot flow, String stepId) {
        record("FLOWER.STEP_ENTERED", flow, stepId, null);
    }

    @Override
    public void onStepExited(FlowSnapshot flow, String stepId) {
        record("FLOWER.STEP_EXITED", flow, stepId, null);
    }

    @Override
    public void onFlowFinished(FlowSnapshot flow) {
        record("FLOWER.FLOW_FINISHED", flow, null, null);
    }

    @Override
    public void onFlowFailed(FlowSnapshot flow, Throwable cause) {
        record("FLOWER.FLOW_FAILED", flow, null, cause);
    }

    @Override
    public void onFlowCancelled(FlowSnapshot flow) {
        record("FLOWER.FLOW_CANCELLED", flow, null, null);
    }

    @Override
    public void onListenerError(FlowSnapshot flow, String callbackName, Throwable cause) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("callbackName", callbackName);
        payload.put("error", errorText(cause));
        recorder.append(
                TraceEvent.Source.FLOWER_LISTENER,
                "FLOWER.LISTENER_ERROR",
                flowReference(flow, null),
                payload);
    }

    @Override
    public void onWorkerError(String workerName, Throwable cause) {
        recorder.append(
                TraceEvent.Source.FLOWER_LISTENER,
                "FLOWER.WORKER_ERROR",
                null,
                Map.of(
                        "workerName", workerName,
                        "error", errorText(cause)));
    }

    private void record(
            String type,
            FlowSnapshot flow,
            String stepId,
            Throwable cause
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (cause != null) {
            payload.put("error", errorText(cause));
        }
        recorder.append(
                TraceEvent.Source.FLOWER_LISTENER,
                type,
                flowReference(flow, stepId),
                payload);
    }

    private TraceEvent.FlowReference flowReference(FlowSnapshot flow, String listenerStepId) {
        return new TraceEvent.FlowReference(
                flow.flowId().flowType(),
                flow.flowId().flowKey(),
                flow.state().name(),
                listenerStepId != null ? listenerStepId : flow.currentStepId(),
                flow.currentStepNo());
    }

    private String errorText(Throwable cause) {
        if (cause == null) {
            return "unknown";
        }
        return cause.getClass().getSimpleName() + ": " + cause.getMessage();
    }
}
