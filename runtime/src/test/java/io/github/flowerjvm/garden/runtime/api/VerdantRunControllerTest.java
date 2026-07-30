package io.github.flowerjvm.garden.runtime.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.github.flowerjvm.garden.runtime.FlowerGardenRuntimeApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = FlowerGardenRuntimeApplication.class)
@AutoConfigureMockMvc
class VerdantRunControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void exposesCreateAndAllThreeCommandKinds() throws Exception {
        JsonNode current = createRun();
        String runId = current.path("runId").asText();

        current = send(runId, current, "tick-init", "TICK", objectMapper.createObjectNode())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("RUNNING"))
                .andExpect(jsonPath("$.currentStepId").value("wait-for-yard-assignment"))
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'VERDANT.WAIT_STARTED')]").exists())
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'VERDANT.WAIT_EVALUATED' "
                                + "&& @.payload.returnedStepResult == 'STAY')]").exists())
                .andReturnJson();

        ObjectNode advancePayload = objectMapper.createObjectNode();
        advancePayload.put("millis", 30_000);
        current = send(runId, current, "advance-deadline", "ADVANCE_TIME", advancePayload)
                .andExpect(status().isOk())
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'GARDEN.TIME_ADVANCED' "
                                + "&& @.payload.afterMillis == 30000)]").exists())
                .andReturnJson();

        ObjectNode signalPayload = objectMapper.createObjectNode();
        signalPayload.put("name", "yard-assignment");
        current = send(runId, current, "signal-at-deadline", "SEND_SIGNAL", signalPayload)
                .andExpect(status().isOk())
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'FLOWER.SIGNAL_RECEIVED')]").exists())
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'GARDEN.SIGNAL_SENT')]").exists())
                .andReturnJson();

        current = send(runId, current, "tick-decide", "TICK", objectMapper.createObjectNode())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStepId").value("yard-move"))
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'VERDANT.WAIT_DECIDED' "
                                + "&& @.payload.signalPresent == true "
                                + "&& @.payload.timedOut == true "
                                + "&& @.payload.winner == 'SIGNAL')]").exists())
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'VERDANT.TIMEOUT_REJECTED')]").exists())
                .andReturnJson();

        send(runId, current, "tick-route", "TICK", objectMapper.createObjectNode())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("FINISHED"))
                .andExpect(jsonPath("$.outcome.status").value("COMPLETED"))
                .andExpect(jsonPath("$.outcome.finalState").value("SIGNALED"))
                .andExpect(jsonPath("$.outcome.workerTicks").value(3));
    }

    @Test
    void rejectsMalformedCommandPayloadsBeforeChangingRuntime() throws Exception {
        JsonNode current = createRun();
        String runId = current.path("runId").asText();

        ObjectNode unknownEnvelopeField = validCommand(
                runId,
                current,
                "unknown-envelope-field",
                "TICK",
                objectMapper.createObjectNode());
        unknownEnvelopeField.put("unexpected", true);
        mockMvc.perform(
                        post("/api/v1/runs/{runId}/commands", runId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(unknownEnvelopeField.toString()))
                .andExpect(status().isBadRequest());

        ObjectNode fractionalTime = objectMapper.createObjectNode();
        fractionalTime.put("millis", 1.5);
        send(runId, current, "fractional", "ADVANCE_TIME", fractionalTime)
                .andExpect(status().isBadRequest());

        ObjectNode extraTickPayload = objectMapper.createObjectNode();
        extraTickPayload.put("unexpected", true);
        send(runId, current, "extra-tick", "TICK", extraTickPayload)
                .andExpect(status().isBadRequest());

        ObjectNode wrongSignal = objectMapper.createObjectNode();
        wrongSignal.put("name", "rain");
        send(runId, current, "wrong-signal", "SEND_SIGNAL", wrongSignal)
                .andExpect(status().isBadRequest());

        // All rejected commands leave the initial two-event response current.
        send(runId, current, "valid-init", "TICK", objectMapper.createObjectNode())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.events[0].sequence").value(1))
                .andExpect(jsonPath("$.events[1].sequence").value(2))
                .andExpect(jsonPath("$.events[2].kind").value("GARDEN.TICK_REQUESTED"));
    }

    private JsonNode createRun() throws Exception {
        String json = mockMvc.perform(
                        post("/api/v1/worlds/verdant-signal-garden/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value("1.0.0"))
                .andExpect(jsonPath("$.worldId").value("verdant-signal-garden"))
                .andExpect(jsonPath("$.missionId").value("signal-vs-timeout"))
                .andExpect(jsonPath("$.flowerRuntimeVersion").value("0.1.1"))
                .andExpect(jsonPath("$.phase").value("READY"))
                .andExpect(jsonPath("$.currentStepId").doesNotExist())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(json);
    }

    private Result send(
            String runId,
            JsonNode current,
            String commandId,
            String kind,
            ObjectNode payload
    ) throws Exception {
        ObjectNode command = validCommand(runId, current, commandId, kind, payload);
        return new Result(mockMvc.perform(
                post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(command.toString())));
    }

    private ObjectNode validCommand(
            String runId,
            JsonNode current,
            String commandId,
            String kind,
            ObjectNode payload
    ) {
        ObjectNode command = objectMapper.createObjectNode();
        command.put("schemaVersion", "1.0.0");
        command.put("commandId", commandId);
        command.put("runId", runId);
        command.put("expectedSequence", latestSequence(current));
        command.put("kind", kind);
        command.set("payload", payload);
        return command;
    }

    private long latestSequence(JsonNode view) {
        JsonNode events = view.path("events");
        return events.get(events.size() - 1).path("sequence").asLong();
    }

    private final class Result {
        private final org.springframework.test.web.servlet.ResultActions actions;

        private Result(org.springframework.test.web.servlet.ResultActions actions) {
            this.actions = actions;
        }

        private Result andExpect(
                org.springframework.test.web.servlet.ResultMatcher matcher
        ) throws Exception {
            actions.andExpect(matcher);
            return this;
        }

        private JsonNode andReturnJson() throws Exception {
            String json = actions.andReturn().getResponse().getContentAsString();
            JsonNode parsed = objectMapper.readTree(json);
            assertThat(parsed.path("events").isArray()).isTrue();
            return parsed;
        }
    }
}
