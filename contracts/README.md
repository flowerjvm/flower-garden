# Flower Garden runtime contracts

Flower Garden has one authority pipeline:

```text
Actual Flower Runtime
        ↓
Recorded execution events and state changes
        ↓
World Projection
        ↓
3D game world
```

The browser may edit a blueprint and render a projection. It does not decide
Step transitions, mission success, failure, or the final garden state.

## Contract files

- `first-bloom-blueprint.schema.json` — the player-authored Worker, Flow, and
  ordered Step assembly for First Bloom Meadow.
- `run-command.schema.json` — strict, versioned, idempotent player commands.
- `trace-event.schema.json` — one immutable runtime observation.
- `world-manifest.schema.json` — the compile-time world catalog contract.
- `fixtures/verdant-*.trace.json` — verified traces for Verdant's three fixed
  Signal/Timeout scenarios.

First Bloom does not have a canonical replay fixture. Its Flow is authored by
the player, so live play requires the JVM Runtime.

## API

```text
POST /api/v1/worlds/first-bloom-meadow/runs
POST /api/v1/worlds/verdant-signal-garden/runs
POST /api/v1/runs/{runId}/commands
```

Every response is a cumulative `RunView`. Its `events` array contains the
complete ordered trace from sequence `1` through the latest event.

## First Bloom blueprint

Create a run by submitting the assembly directly:

```json
{
  "schemaVersion": "1.0.0",
  "workerId": "first-bloom-worker",
  "flowType": "first-flow",
  "stepIds": [
    "prepare-soil",
    "wait-for-sunlight",
    "grow-stem",
    "bloom"
  ]
}
```

The request must contain exactly the four known, unique Step IDs. Their order
is intentionally unrestricted. The JVM validates the structure, then creates a
real Flower `Flow` with Steps in the submitted order.

The browser does not compare `stepIds` with a winning array. Domain
prerequisites inside the real Steps decide the result:

- `wait-for-sunlight` requires prepared soil;
- `grow-stem` requires prepared soil and accepted sunlight;
- `bloom` requires a grown stem;
- a missing prerequisite returns an actual `StepResult.FAIL`;
- a valid Flow ends with garden state `BLOOMED`.

Run creation records at least:

```text
GARDEN.RUN_CREATED
GARDEN.BLUEPRINT_ACCEPTED
GARDEN.PLOT_UPDATED
GARDEN.FLOW_READY
```

`GARDEN.BLUEPRINT_ACCEPTED.payload.stepIds` is the only Step layout accepted by
the World Projection. The 3D scene must not read the local browser draft.

## Commands

Every command uses this envelope:

```json
{
  "schemaVersion": "1.0.0",
  "commandId": "unique-command-id",
  "runId": "run-id-from-create",
  "expectedSequence": 12,
  "kind": "TICK",
  "payload": {}
}
```

| Command | Exact payload | Runtime effect |
| --- | --- | --- |
| `TICK` | `{}` | Calls that mission Worker's `tickOnce()` exactly once |
| `PUBLISH_EVENT` | `{"type":"SUNLIGHT_GRANTED"}` | Publishes First Bloom's event through Bloom without ticking |
| `ADVANCE_TIME` | `{"millis": 1..300000}` | Advances Verdant's `ManualClock` without ticking |
| `SEND_SIGNAL` | `{"name":"yard-assignment"}` | Publishes Verdant's subscribed domain event |

First Bloom accepts only `TICK` and `PUBLISH_EVENT`. Verdant accepts only
`TICK`, `ADVANCE_TIME`, and `SEND_SIGNAL`.

The URL and body `runId` must match. `expectedSequence` must equal the latest
returned event sequence. A successful `commandId` can be retried only with the
same complete command; the Runtime returns its original response without
applying the effect again.

## Bloom event semantics

The First Bloom session creates a real Bloom `LocalEventBus` and wraps it with
the Flower adapter used by the Engine.

When the player publishes sunlight, the Runtime performs these operations:

```text
store sunlightGranted domain fact
        ↓
publish SunlightGranted on Bloom LocalEventBus
        ↓
wake the active Flower wait through the Bloom adapter, if subscribed
        ↓
record GARDEN.BLOOM_EVENT_PUBLISHED
```

This command never calls `Worker.tickOnce()`. The Flow remains on the same
Step. On the next `TICK`, `wait-for-sunlight` checks the stored domain fact and
returns `DONE`.

The stored fact matters when the event arrives before the wait subscribes:
event delivery may have no active receiver, but the later Step still observes
sunlight and proceeds. The event is a wake-up hint; durable mission state is
the source used by the Step.

A normal successful assembly produces this interaction:

```text
TICK  prepare-soil       → DONE
TICK  wait-for-sunlight  → STAY
PUBLISH_EVENT            → no Worker tick, same current Step
TICK  wait-for-sunlight  → DONE
TICK  grow-stem          → DONE
TICK  bloom              → DONE, Flow FINISHED
```

Important mission events include:

```text
GARDEN.PLOT_UPDATED
FIRST_BLOOM.SUNLIGHT_WAITING
GARDEN.BLOOM_EVENT_PUBLISHED
FIRST_BLOOM.SUNLIGHT_ACCEPTED
GARDEN.MISSION_BLOCKED
```

Only `GARDEN.PLOT_UPDATED` changes the projected garden state. Flower lifecycle
and `FLOWER.STEP_RESULT` events drive the projected Flow and Step status.

## Trace invariants

Each `TraceEvent` has:

- `schemaVersion: "1.0.0"`;
- a unique `eventId`;
- the owning `runId`;
- a contiguous positive `sequence`;
- a canonical dotted `kind`;
- an explicit source;
- an optional Flow snapshot reference;
- a JSON payload;
- zero or more evidence references.

Sequence is the sole ordering authority. `logicalTimeMillis` is data and is not
a tie-breaker.

An accepted tick is delimited by:

```text
GARDEN.TICK_REQUESTED
    …actual Flower callbacks and StepResult…
GARDEN.TICK_COMPLETED
```

The Runtime records `FLOWER.STEP_RESULT` inside the actual mission Step
immediately before returning it to Flower. The browser must never reconstruct
that result from animation or elapsed time.

## Verdant replay fixtures

Verdant has three fixed, verified traces:

- Signal at 29 seconds;
- Timeout before a late Signal;
- Signal and Timeout both true at 30 seconds.

The fixtures are generated from actual Flower executions and compared
byte-for-byte by the runtime tests. Replaying them only moves a cursor through
recorded events; it does not execute or simulate Flower.

## Compatibility

Contracts are currently version `1.0.0`. A consumer must reject unsupported
schema versions, unknown command kinds, malformed payloads, non-contiguous
traces, and incompatible event shapes. Unknown future event kinds may be
ignored by a projection only when their documented semantics are not required
for that world.
