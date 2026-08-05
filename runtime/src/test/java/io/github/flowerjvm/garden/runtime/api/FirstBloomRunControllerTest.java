package io.github.flowerjvm.garden.runtime.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.github.flowerjvm.garden.runtime.FlowerGardenRuntimeApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(classes = FlowerGardenRuntimeApplication.class)
@AutoConfigureMockMvc
class FirstBloomRunControllerTest {

    private static final List<String> CANONICAL_STEPS = List.of(
            "prepare-soil",
            "wait-for-sunlight",
            "grow-stem",
            "bloom");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void createsActualPlayerBlueprintAndPublishesBloomEventWithoutTicking()
            throws Exception {
        JsonNode created = createReadyRun();
        String runId = created.path("runId").asText();

        assertThat(created.path("events")
                .findValues("kind")
                .stream()
                .map(JsonNode::asText))
                .contains("GARDEN.BLUEPRINT_ACCEPTED");
        JsonNode accepted = findEvent(created, "GARDEN.BLUEPRINT_ACCEPTED");
        assertThat(objectMapper.convertValue(
                accepted.path("payload").path("stepIds"),
                List.class))
                .containsExactlyElementsOf(CANONICAL_STEPS);

        JsonNode prepared = performCommand(validCommand(
                runId,
                latestSequence(created),
                "tick-prepare",
                "TICK",
                objectMapper.createObjectNode()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("RUNNING"))
                .andExpect(jsonPath("$.currentStepId").value("wait-for-sunlight"))
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'GARDEN.PLOT_UPDATED'"
                                + " && @.payload.gardenState == 'SOIL_READY')]")
                        .exists())
                .andReturnJson();

        JsonNode waiting = performCommand(validCommand(
                runId,
                latestSequence(prepared),
                "tick-wait",
                "TICK",
                objectMapper.createObjectNode()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStepId").value("wait-for-sunlight"))
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'FIRST_BLOOM.SUNLIGHT_WAITING')]")
                        .exists())
                .andReturnJson();

        ObjectNode eventPayload = objectMapper.createObjectNode();
        eventPayload.put("type", "SUNLIGHT_GRANTED");
        JsonNode published = performCommand(validCommand(
                runId,
                latestSequence(waiting),
                "publish-sunlight",
                "PUBLISH_EVENT",
                eventPayload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.phase").value("RUNNING"))
                .andExpect(jsonPath("$.currentStepId").value("wait-for-sunlight"))
                .andExpect(jsonPath("$.outcome").doesNotExist())
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'GARDEN.BLOOM_EVENT_PUBLISHED'"
                                + " && @.payload.eventType == 'SUNLIGHT_GRANTED')]")
                        .exists())
                .andReturnJson();

        long tickCompletedBefore = countEvents(waiting, "GARDEN.TICK_COMPLETED");
        assertThat(countEvents(published, "GARDEN.TICK_COMPLETED"))
                .isEqualTo(tickCompletedBefore);
    }

    @Test
    void rejectsMalformedBlueprintsBeforeCreatingRun() throws Exception {
        mockMvc.perform(post("/api/v1/worlds/first-bloom-meadow/runs")
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest());

        for (String required :
                new String[]{"schemaVersion", "workerId", "flowType", "stepIds"}) {
            ObjectNode missing = canonicalBlueprintJson();
            missing.remove(required);
            postBlueprint(missing).andExpect(status().isBadRequest());
        }

        ObjectNode wrongVersion = canonicalBlueprintJson();
        wrongVersion.put("schemaVersion", "0.9.0");
        postBlueprint(wrongVersion).andExpect(status().isBadRequest());

        ObjectNode wrongWorker = canonicalBlueprintJson();
        wrongWorker.put("workerId", "arbitrary-worker");
        postBlueprint(wrongWorker).andExpect(status().isBadRequest());

        ObjectNode wrongFlow = canonicalBlueprintJson();
        wrongFlow.put("flowType", "arbitrary-flow");
        postBlueprint(wrongFlow).andExpect(status().isBadRequest());

        ObjectNode tooShort = canonicalBlueprintJson();
        tooShort.withArray("stepIds").remove(3);
        postBlueprint(tooShort).andExpect(status().isBadRequest());

        ObjectNode duplicate = canonicalBlueprintJson();
        duplicate.withArray("stepIds").set(3, objectMapper.getNodeFactory()
                .textNode("grow-stem"));
        postBlueprint(duplicate).andExpect(status().isBadRequest());

        ObjectNode unknown = canonicalBlueprintJson();
        unknown.withArray("stepIds").set(3, objectMapper.getNodeFactory()
                .textNode("java.lang.Runtime"));
        postBlueprint(unknown).andExpect(status().isBadRequest());

        ObjectNode nullStep = canonicalBlueprintJson();
        nullStep.withArray("stepIds").set(2, objectMapper.nullNode());
        postBlueprint(nullStep).andExpect(status().isBadRequest());

        ObjectNode extraTopLevelField = canonicalBlueprintJson();
        extraTopLevelField.put("script", "do-not-run");
        postBlueprint(extraTopLevelField).andExpect(status().isBadRequest());
    }

    @Test
    void strictlyValidatesPublishEventPayloadAndUnsupportedCommands()
            throws Exception {
        JsonNode created = createReadyRun();
        String runId = created.path("runId").asText();
        long sequence = latestSequence(created);

        ObjectNode missingType = objectMapper.createObjectNode();
        performCommand(validCommand(
                runId,
                sequence,
                "missing-type",
                "PUBLISH_EVENT",
                missingType))
                .andExpect(status().isBadRequest());

        ObjectNode wrongType = objectMapper.createObjectNode();
        wrongType.put("type", "RAIN_GRANTED");
        performCommand(validCommand(
                runId,
                sequence,
                "wrong-type",
                "PUBLISH_EVENT",
                wrongType))
                .andExpect(status().isBadRequest());

        ObjectNode nonStringType = objectMapper.createObjectNode();
        nonStringType.put("type", 42);
        performCommand(validCommand(
                runId,
                sequence,
                "number-type",
                "PUBLISH_EVENT",
                nonStringType))
                .andExpect(status().isBadRequest());

        ObjectNode extraKey = objectMapper.createObjectNode();
        extraKey.put("type", "SUNLIGHT_GRANTED");
        extraKey.put("script", "do-not-run");
        performCommand(validCommand(
                runId,
                sequence,
                "extra-key",
                "PUBLISH_EVENT",
                extraKey))
                .andExpect(status().isBadRequest());

        ObjectNode unsupportedSignal = objectMapper.createObjectNode();
        unsupportedSignal.put("name", "SUNLIGHT_GRANTED");
        performCommand(validCommand(
                runId,
                sequence,
                "wrong-command-kind",
                "SEND_SIGNAL",
                unsupportedSignal))
                .andExpect(status().isBadRequest());

        ObjectNode validPayload = objectMapper.createObjectNode();
        validPayload.put("type", "SUNLIGHT_GRANTED");
        performCommand(validCommand(
                runId,
                sequence,
                "valid-after-rejections",
                "PUBLISH_EVENT",
                validPayload))
                .andExpect(status().isOk())
                .andExpect(jsonPath(
                        "$.events[?(@.kind == 'GARDEN.BLOOM_EVENT_PUBLISHED')]")
                        .exists());
    }

    @Test
    void duplicateCommandIdReturnsSameResponseWithoutRepublishing() throws Exception {
        JsonNode created = createReadyRun();
        String runId = created.path("runId").asText();
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("type", "SUNLIGHT_GRANTED");
        ObjectNode command = validCommand(
                runId,
                latestSequence(created),
                "same-event",
                "PUBLISH_EVENT",
                payload);

        JsonNode first = performCommand(command)
                .andExpect(status().isOk())
                .andReturnJson();
        JsonNode retry = performCommand(command)
                .andExpect(status().isOk())
                .andReturnJson();

        assertThat(retry).isEqualTo(first);
        assertThat(countEvents(retry, "GARDEN.BLOOM_EVENT_PUBLISHED"))
                .isEqualTo(1);

        ObjectNode collision = validCommand(
                runId,
                latestSequence(first),
                "same-event",
                "TICK",
                objectMapper.createObjectNode());
        performCommand(collision).andExpect(status().isBadRequest());
    }

    private JsonNode createReadyRun() throws Exception {
        String json = postBlueprint(canonicalBlueprintJson())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value("1.0.0"))
                .andExpect(jsonPath("$.worldId").value("first-bloom-meadow"))
                .andExpect(jsonPath("$.missionId").value("the-first-flow"))
                .andExpect(jsonPath("$.flowerRuntimeVersion").value("0.1.2"))
                .andExpect(jsonPath("$.phase").value("READY"))
                .andExpect(jsonPath("$.currentStepId").doesNotExist())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(json);
    }

    private ObjectNode canonicalBlueprintJson() {
        ObjectNode blueprint = objectMapper.createObjectNode();
        blueprint.put("schemaVersion", "1.0.0");
        blueprint.put("workerId", "first-bloom-worker");
        blueprint.put("flowType", "first-flow");
        ArrayNode steps = blueprint.putArray("stepIds");
        CANONICAL_STEPS.forEach(steps::add);
        return blueprint;
    }

    private org.springframework.test.web.servlet.ResultActions postBlueprint(
            ObjectNode blueprint
    ) throws Exception {
        return mockMvc.perform(post("/api/v1/worlds/first-bloom-meadow/runs")
                .contentType(MediaType.APPLICATION_JSON)
                .content(blueprint.toString()));
    }

    private CommandResult performCommand(ObjectNode command) {
        return new CommandResult(command);
    }

    private ObjectNode validCommand(
            String runId,
            long expectedSequence,
            String commandId,
            String kind,
            ObjectNode payload
    ) {
        ObjectNode command = objectMapper.createObjectNode();
        command.put("schemaVersion", "1.0.0");
        command.put("commandId", commandId);
        command.put("runId", runId);
        command.put("expectedSequence", expectedSequence);
        command.put("kind", kind);
        command.set("payload", payload);
        return command;
    }

    private long latestSequence(JsonNode view) {
        JsonNode events = view.path("events");
        return events.get(events.size() - 1).path("sequence").asLong();
    }

    private long countEvents(JsonNode view, String kind) {
        long count = 0;
        for (JsonNode event : view.path("events")) {
            if (kind.equals(event.path("kind").asText())) {
                count++;
            }
        }
        return count;
    }

    private JsonNode findEvent(JsonNode view, String kind) {
        for (JsonNode event : view.path("events")) {
            if (kind.equals(event.path("kind").asText())) {
                return event;
            }
        }
        throw new AssertionError("Missing event " + kind);
    }

    /**
     * Small fluent wrapper that keeps command URL construction out of each
     * assertion while still exposing MockMvc's result expectations.
     */
    private final class CommandResult {
        private final ObjectNode command;
        private org.springframework.test.web.servlet.ResultActions actions;

        private CommandResult(ObjectNode command) {
            this.command = command;
        }

        private CommandResult andExpect(
                org.springframework.test.web.servlet.ResultMatcher matcher
        ) throws Exception {
            if (actions == null) {
                actions = mockMvc.perform(post(
                                "/api/v1/runs/{runId}/commands",
                                command.path("runId").asText())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(command.toString()));
            }
            actions.andExpect(matcher);
            return this;
        }

        private JsonNode andReturnJson() throws Exception {
            if (actions == null) {
                andExpect(status().isOk());
            }
            return objectMapper.readTree(
                    actions.andReturn().getResponse().getContentAsString());
        }
    }
}
