# Flower Garden Contracts

These contracts separate actual Flower execution from its projection and
renderer.

## Current files

- `trace-event.schema.json`: one immutable runtime-side observation.
- `trace-bundle.schema.json`: a portable contiguous trace for replay and
  conformance.
- `run-command.schema.json`: strict `TICK`, `ADVANCE_TIME`, and `SEND_SIGNAL`
  command variants.
- `world-manifest.schema.json`: a minimal compile-time world descriptor.
- `fixtures/first-bloom-the-first-flow.trace.json`: the verified four-tick
  First Bloom trace.
- `fixtures/verdant-signal-*.trace.json`: verified Signal-first,
  Timeout-first, and both-ready Verdant traces.

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

## Implemented HTTP contract

The Java gateway exposes two world-specific run factories and one shared
command operation:

```text
POST /api/v1/worlds/first-bloom-meadow/runs
POST /api/v1/worlds/verdant-signal-garden/runs
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

Each create response contains its initial `GARDEN.RUN_CREATED` and
`GARDEN.FLOW_READY` records. It does not tick Flower.

The command response returns the entire trace again, including every newly
recorded event. It is not an ACK-only response and not a delta. The current
vertical slice has no events GET endpoint and no SSE stream.

## Commands

Every command uses the same versioned envelope:

```json
{
  "schemaVersion": "1.0.0",
  "commandId": "command-1",
  "runId": "run-001",
  "expectedSequence": 2,
  "kind": "TICK",
  "payload": {}
}
```

The payload is discriminated by `kind`:

| Kind | Exact payload | Runtime effect |
| --- | --- | --- |
| `TICK` | `{}` | Calls the mission Worker's `tickOnce()` exactly once |
| `ADVANCE_TIME` | `{"millis": integer 1..300000}` | Advances Verdant's `ManualClock`; never ticks |
| `SEND_SIGNAL` | `{"name":"yard-assignment"}` | Publishes Verdant's actual subscribed event |

- `commandId` is the idempotency key. Retrying a successful id returns the
  original cumulative response without applying the command again, but only
  when the complete command content is identical. Reusing an id with changed
  content is rejected.
- `runId` must match the URL run id.
- `expectedSequence` must equal the latest sequence returned to that client.
- First Bloom accepts only `TICK`.
- Verdant accepts all three kinds and validates each payload strictly.

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

## Verdant Signal/Timeout trace

Signal/Timeout is not a generic sequence race. Trace sequence describes input
and command order only. If Signal and Timeout are both observable on one
Worker tick, the real mission Step's explicit check precedence and returned
`StepResult` determine the winner.

Verdant first arms its wait with a `TICK`, then accepts time and Signal inputs.
The important runtime-side facts are:

```text
VERDANT.WAIT_STARTED
GARDEN.TIME_ADVANCE_REQUESTED → GARDEN.TIME_ADVANCED
GARDEN.SIGNAL_SEND_REQUESTED
  → FLOWER.SIGNAL_RECEIVED → GARDEN.SIGNAL_SENT
VERDANT.WAIT_EVALUATED
VERDANT.WAIT_DECIDED
FLOWER.STEP_RESULT
VERDANT.ROUTE_COMMITTED
```

`VERDANT.WAIT_EVALUATED` records both predicate values and
`SIGNAL_THEN_TIMEOUT`. `VERDANT.WAIT_DECIDED` records the winner and selected
downstream Step. When both predicates are true, the mission also records
`VERDANT.TIMEOUT_REJECTED` to explain that this Flow definition checked Signal
first. That label is mission policy, not a generic Flower core event.

After the waiting Step exits, its event subscription is disposed. A later
publish is recorded as `GARDEN.SIGNAL_IGNORED`; it cannot reopen the completed
wait.

Verdant trace bundles also preserve the runtime response's run-level
`evidence[]`. This keeps the scenario-specific source and deterministic test
references visible at the end of prerecorded replay, even when the last trace
event itself has no evidence attachment.

## Replay is not recovery

A trace bundle replays projection input. It does not re-execute Flower and is
not a Flower durable checkpoint. A prerecorded trace must be visibly labelled
as replay.

## Verification

Fixture conformance checks verify:

1. every JSON file parses;
2. every event conforms to `trace-event.schema.json`;
3. sequences are contiguous and event ids are unique;
4. all event run ids match the bundle run id;
5. `expectedOutcome.finalSequence` equals the last event;
6. First Bloom tick boundaries are `1, 2, 3, 4` with results
   `STAY, DONE, DONE, DONE`;
7. Verdant has exactly one decisive wait evaluation and the expected winner;
8. the final Flower state is `FINISHED`.

The runtime behavior is tested with:

```bash
mvn -f runtime/pom.xml clean test
npm run fixtures:verdant:check
npm test
```

The Maven tests use the actual Flower runtime without sleeps. The fixture check
then compares their generated canonical `RunView` responses with the
checked-in replay bundles before the web projection tests run.
