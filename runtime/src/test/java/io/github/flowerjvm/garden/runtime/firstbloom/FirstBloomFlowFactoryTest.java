package io.github.flowerjvm.garden.runtime.firstbloom;

import io.github.flowerjvm.flower.core.flow.Flow;
import io.github.flowerjvm.flower.core.step.StepDefinition;
import io.github.flowerjvm.flower.core.time.ManualClock;
import io.github.flowerjvm.garden.runtime.support.MissionTraceRecorder;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FirstBloomFlowFactoryTest {

    @Test
    void buildsActualFlowInPlayerOrderWithFreshStepInstances() {
        List<String> playerOrder = List.of(
                FirstBloomFlowFactory.WAIT_FOR_SUNLIGHT,
                FirstBloomFlowFactory.PREPARE_SOIL,
                FirstBloomFlowFactory.GROW_STEM,
                FirstBloomFlowFactory.BLOOM);

        Flow first = create("flow-a", playerOrder);
        Flow second = create("flow-b", playerOrder);

        assertThat(first.steps().stream().map(StepDefinition::stepId).toList())
                .containsExactlyElementsOf(playerOrder);
        assertThat(second.steps().stream().map(StepDefinition::stepId).toList())
                .containsExactlyElementsOf(playerOrder);
        for (int index = 0; index < playerOrder.size(); index++) {
            assertThat(second.steps().get(index).step())
                    .isNotSameAs(first.steps().get(index).step());
        }
    }

    private Flow create(String runId, List<String> playerOrder) {
        return FirstBloomFlowFactory.create(
                runId,
                playerOrder,
                new FirstBloomPlotState(),
                new MissionTraceRecorder(runId, new ManualClock(0L)));
    }
}
