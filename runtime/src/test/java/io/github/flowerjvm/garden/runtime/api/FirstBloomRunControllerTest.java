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
class FirstBloomRunControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void exposesReadyRunAndTickCommand() throws Exception {
        String createJson = mockMvc.perform(post("/api/v1/worlds/first-bloom-meadow/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value("1.0.0"))
                .andExpect(jsonPath("$.worldId").value("first-bloom-meadow"))
                .andExpect(jsonPath("$.missionId").value("the-first-flow"))
                .andExpect(jsonPath("$.flowerRuntimeVersion").value("0.1.1"))
                .andExpect(jsonPath("$.phase").value("READY"))
                .andExpect(jsonPath("$.currentStepId").doesNotExist())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode created = objectMapper.readTree(createJson);
        String runId = created.path("runId").asText();

        String commandJson = """
                {
                  "schemaVersion": "1.0.0",
                  "commandId": "web-tick-1",
                  "runId": "%s",
                  "expectedSequence": %d,
                  "kind": "TICK",
                  "payload": {}
                }
                """.formatted(
                runId,
                created.path("events").get(created.path("events").size() - 1).path("sequence").asLong());

        String tickJson = mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(commandJson))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("RUNNING"))
                .andExpect(jsonPath("$.currentStepId").value("prepare-soil"))
                .andExpect(jsonPath("$.events[?(@.kind == 'FLOWER.FLOW_SUBMITTED')]").exists())
                .andExpect(jsonPath("$.events[?(@.kind == 'FLOWER.STEP_ENTERED')]").exists())
                .andExpect(jsonPath("$.events[?(@.kind == 'FLOWER.STEP_RESULT')]").exists())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode ticked = objectMapper.readTree(tickJson);
        assertThat(ticked.path("events").isArray()).isTrue();
        assertThat(ticked.path("events").size()).isGreaterThan(created.path("events").size());
    }

    @Test
    void rejectsMissingAndMismatchedWireFieldsWithoutTicking() throws Exception {
        JsonNode created = createReadyRun();
        String runId = created.path("runId").asText();
        long sequence = latestSequence(created);

        for (String required : new String[]{
                "schemaVersion",
                "commandId",
                "runId",
                "expectedSequence",
                "kind",
                "payload"
        }) {
            ObjectNode missing = validTickCommand(runId, sequence, "missing-" + required);
            missing.remove(required);
            mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(missing.toString()))
                    .andExpect(status().isBadRequest());
        }

        ObjectNode wrongVersion = validTickCommand(runId, sequence, "wrong-version");
        wrongVersion.put("schemaVersion", "0.9.0");
        mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(wrongVersion.toString()))
                .andExpect(status().isBadRequest());

        ObjectNode wrongRun = validTickCommand(runId, sequence, "wrong-run");
        wrongRun.put("runId", "another-run");
        mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(wrongRun.toString()))
                .andExpect(status().isBadRequest());

        ObjectNode wrongSequence = validTickCommand(runId, sequence + 1L, "wrong-sequence");
        mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(wrongSequence.toString()))
                .andExpect(status().isBadRequest());

        mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validTickCommand(runId, sequence, "first-valid").toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("RUNNING"))
                .andExpect(jsonPath("$.currentStepId").value("prepare-soil"))
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'FLOWER.STEP_RESULT' && @.payload.result == 'STAY')]")
                        .exists());
    }

    @Test
    void duplicateCommandIdReturnsSameResponseWithoutAnotherTick() throws Exception {
        JsonNode created = createReadyRun();
        String runId = created.path("runId").asText();
        ObjectNode command = validTickCommand(
                runId,
                latestSequence(created),
                "idempotent-tick");

        String firstJson = mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(command.toString()))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        String retryJson = mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(command.toString()))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode first = objectMapper.readTree(firstJson);
        JsonNode retry = objectMapper.readTree(retryJson);
        assertThat(retry).isEqualTo(first);
        assertThat(retry.path("events").size()).isEqualTo(first.path("events").size());
        assertThat(retry.path("events").findValuesAsText("kind"))
                .containsOnlyOnce("FLOWER.STEP_RESULT");

        ObjectNode collision = validTickCommand(
                runId,
                latestSequence(first),
                "idempotent-tick");
        mockMvc.perform(post("/api/v1/runs/{runId}/commands", runId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(collision.toString()))
                .andExpect(status().isBadRequest());

        String originalAfterCollision = mockMvc.perform(
                        post("/api/v1/runs/{runId}/commands", runId)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(command.toString()))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        assertThat(objectMapper.readTree(originalAfterCollision)).isEqualTo(first);
    }

    private JsonNode createReadyRun() throws Exception {
        String json = mockMvc.perform(post("/api/v1/worlds/first-bloom-meadow/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("READY"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(json);
    }

    private long latestSequence(JsonNode view) {
        JsonNode events = view.path("events");
        return events.get(events.size() - 1).path("sequence").asLong();
    }

    private ObjectNode validTickCommand(
            String runId,
            long expectedSequence,
            String commandId
    ) {
        ObjectNode command = objectMapper.createObjectNode();
        command.put("schemaVersion", "1.0.0");
        command.put("commandId", commandId);
        command.put("runId", runId);
        command.put("expectedSequence", expectedSequence);
        command.put("kind", "TICK");
        command.set("payload", objectMapper.createObjectNode());
        return command;
    }
}
