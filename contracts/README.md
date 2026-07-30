# Flower Garden Contracts

These contracts separate actual Flower execution from its projection and
renderer.

## Current files

- `trace-event.schema.json`: one immutable runtime-side observation.
- `trace-bundle.schema.json`: a portable contiguous trace for replay and
  conformance.
- `run-command.schema.json`: the only executable v1 command, `TICK`.
- `world-manifest.schema.json`: a minimal compile-time world descriptor.
- `fixtures/first-bloom-the-first-flow.trace.json`: the verified four-tick
  First Bloom trace.

There is no Verdant Signal Garden fixture. That world remains `PLANNED` and
locked until its actual Flower Flow and tests exist.

All schemas use JSON Schema Draft 2020-12.

## Authority

```text
client command
→ actual Flower runtime
→ TraceEvent records
→ projection reducer
→ 3D world
```

A command is intent. A trace event is a runtime-side observation. Projection
state and animation are derived views. No client response adapter, reducer, or
renderer may manufacture a StepResult or terminal Flow state.

## Implemented v1 HTTP contract

The Java gateway currently exposes exactly two operations:

```text
POST /api/v1/worlds/first-bloom-meadow/runs
POST /api/v1/runs/{runId}/commands
```

Both return the current cumulative `RunView`:

```text
RunView
├─ schemaVersion
├─ runId
├─ worldId
├─ missionId
├─ flowerRuntimeVersion
├─ phase
├─ currentStepId
├─ events[]                 sequence 1 through latest
├─ evidence[]
└─ outcome?                 present after FINISHED
```

The create response contains the initial `GARDEN.RUN_CREATED` and
`GARDEN.FLOW_READY` records. It does not tick Flower.

The command response returns the entire trace again, including every newly
recorded event. It is not an ACK-only response and not a delta. The current
vertical slice has no events GET endpoint and no SSE stream.

## TICK command

Contract `1.0.0` accepts only:

```json
{
  "schemaVersion": "1.0.0",
  "commandId": "tick-1",
  "runId": "first-bloom-run-001",
  "expectedSequence": 2,
  "kind": "TICK",
  "payload": {}
}
```

For every newly accepted command, the runtime calls the mission Worker's
`tickOnce()` exactly once.

- `commandId` is the idempotency key. Retrying a successful id returns the
  original cumulative response without another tick.
- `runId` must match the URL run id.
- `expectedSequence` must equal the latest sequence returned to that client.
- `payload` must be empty.

`ADVANCE_TIME`, `SEND_SIGNAL`, and `ADVANCE_TO_TIMEOUT` are not v1 commands.
They may be added in a later contract version only when Verdant Signal Garden
has an executable Flow and deterministic tests.

## First Bloom trace shape

The canonical run has four actual Worker tick groups:

```text
create: RUN_CREATED, FLOW_READY

tick 1: TICK_REQUESTED
        FLOW_SUBMITTED
        STEP_ENTERED prepare-soil
        STEP_RESULT STAY
        TICK_COMPLETED

tick 2: TICK_REQUESTED
        STEP_RESULT DONE prepare-soil
        STEP_EXITED prepare-soil
        TICK_COMPLETED @ grow-stem

tick 3: TICK_REQUESTED
        STEP_ENTERED grow-stem
        STEP_RESULT DONE
        STEP_EXITED grow-stem
        TICK_COMPLETED @ bloom

tick 4: TICK_REQUESTED
        STEP_ENTERED bloom
        STEP_RESULT DONE
        STEP_EXITED bloom
        FLOW_FINISHED
        TICK_COMPLETED
```

`FLOW_SUBMITTED` appears on tick 1 because Flower emits that listener callback
when `Worker.tickOnce()` applies the pending submission. `GARDEN.FLOW_READY` is
the coordinator's pre-tick snapshot and must not be relabelled as a Flower
listener event.

## Ordering and cumulative responses

Within one run:

- `sequence` begins at `1` and increases by exactly one;
- `eventId` is unique and immutable;
- every event has the same `runId`;
- an accepted response contains the full prefix through its latest sequence;
- a duplicate command response is byte-equivalent in meaning and adds no
  event;
- `logicalTimeMillis` never breaks an ordering tie.

A consumer may ignore an unknown additive event kind only after validating a
supported trace major version, but it must still consume that event's sequence.
A conflicting event at an already-seen sequence, a sequence gap, or a different
run id is a contract error.

The current cumulative API does not need reconnect catch-up behavior. Polling,
SSE, a durable event journal, and gap recovery are future transport work.

## Signal/Timeout is not a generic sequence race

For the planned Verdant mission, trace sequence will describe input and command
order only. If Signal and Timeout are both observable on one Worker tick, the
real mission Step's check precedence and returned StepResult determine the
winner.

The future decision event must record both predicate values, the declared check
precedence, the returned StepResult, and the selected path. It must cite the
mission Step source and a deterministic both-true test. A mission explanation
must not present this application policy as a generic Flower guarantee.

## Replay is not recovery

A trace bundle replays projection input. It does not re-execute Flower and is
not a Flower durable checkpoint. A prerecorded trace must be visibly labelled
as replay.

## Verification

The fixture conformance check must verify:

1. every JSON file parses;
2. every event conforms to `trace-event.schema.json`;
3. sequences are contiguous and event ids are unique;
4. all event run ids match the bundle run id;
5. `expectedOutcome.finalSequence` equals the last event;
6. tick boundaries are `1, 2, 3, 4` with results
   `STAY, DONE, DONE, DONE`;
7. the final Flower state is `FINISHED`.

The runtime behavior is tested with:

```bash
mvn -f runtime/pom.xml test
```

Those tests use the actual Flower runtime without sleeps.
