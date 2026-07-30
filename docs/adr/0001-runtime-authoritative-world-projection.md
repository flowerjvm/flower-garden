# ADR-0001: Runtime-authoritative World Projection

- Status: Accepted
- Date: 2026-07-30
- Decision owners: Flower Garden maintainers

## Context

Flower Garden teaches Flower by letting a player predict, run, and inspect a
real workflow inside a lightweight 3D world. The project has one
non-negotiable pipeline:

```text
Actual Flower Runtime
        ↓
Recorded execution events and state changes
        ↓
World Projection
        ↓
3D game world
```

The renderer must not become a second workflow engine. The first vertical slice
also needs to stay small enough that its architecture does not recreate the
recognition debt the game is intended to reduce.

The curriculum therefore starts with:

```text
Flower Garden
├─ 01 First Bloom Meadow              AVAILABLE
│  └─ The First Flow
│     Engine → Worker → Flow → Step → StepResult
└─ 02 Verdant Signal Garden           AVAILABLE
   └─ Signal vs Timeout
```

## Decision

### 1. Flower owns every semantic transition

The current live path is:

```text
Browser command intent
    ↓ POST command
Mission run coordinator
    ↓ actual ManualClock, EventBus, or Worker operation
Flower Engine → Worker → Flow → Step → StepResult
    ↓ runtime-side trace recording
Cumulative ordered TraceEvent list
    ↓ pure World Projection
3D scene and explanation UI
```

Authority is assigned as follows:

| Concern | Authority |
| --- | --- |
| Flow state, current Step, and terminal result | Actual Flower runtime |
| Whether a command is accepted or retried | Runtime coordinator |
| Trace order | Per-run recorder sequence |
| Semantic 3D world state | Pure projection of accepted trace events |
| Camera, interpolation, particles, and frame rate | Renderer only |

A browser animation finishing is not evidence that a Step finished. Only a
runtime-recorded lifecycle event or Step decision may change the semantic
projection.

### 2. The first run uses an attached manual Flower runtime

The implementation is in
`runtime/src/main/java/io/github/flowerjvm/garden/runtime/firstbloom`.
Each First Bloom run creates:

- a real Flower `ManualClock`;
- an `Engine` attached with `Engine.attach()`;
- one manually driven Flower `Worker`;
- one Flow containing `prepare-soil`, `grow-stem`, and `bloom`;
- an in-memory recorder scoped to that run.

`Engine.start()` is not called, so no scheduler can advance the Flow. The only
execution path is an accepted player `TICK` command calling
`Worker.tickOnce()` exactly once.

Run creation attaches the Engine, submits the Flow, and records:

1. `GARDEN.RUN_CREATED`, including the actual manual runtime topology;
2. `GARDEN.FLOW_READY`, copied from the real `FlowSnapshot`.

`GARDEN.FLOW_READY` is a coordinator observation. Flower's
`onFlowSubmitted(...)` listener callback is not fabricated during creation; it
is emitted by Flower when the first `tickOnce()` applies the pending
submission.

The core mission then advances in four real Worker ticks:

| Worker tick | Step invocation | StepResult | State after tick |
| ---: | --- | --- | --- |
| 1 | `prepare-soil` tick 1 | `STAY` | `RUNNING @ prepare-soil` |
| 2 | `prepare-soil` tick 2 | `DONE` | `RUNNING @ grow-stem` |
| 3 | `grow-stem` tick 1 | `DONE` | `RUNNING @ bloom` |
| 4 | `bloom` tick 1 | `DONE` | `FINISHED` |

Flower invokes at most one current Step per Flow tick. Advancing to a next Step
does not enter or tick that Step until a later Worker tick.

### 3. Trace only observable runtime facts

The recorder combines three actual boundaries:

1. `FirstBloomRunCoordinator` records accepted tick boundaries and snapshots;
2. `FlowerListener` records Flow and Step lifecycle callbacks;
3. the real mission Step records the `StepResult` it is about to return.

The Step probe exists because Flower `0.1.1` does not expose the exact
`StepResult` through `FlowerListener`. It runs inside the actual Flower Step
immediately before returning `StepResult.stay()` or `StepResult.done()`. The
browser never reconstructs that decision.

Each accepted tick is delimited by:

```text
GARDEN.TICK_REQUESTED
    ...actual Flower callbacks and StepResult...
GARDEN.TICK_COMPLETED
```

The recorder assigns a unique immutable `eventId` and a contiguous `sequence`
starting at `1`. Sequence is the only trace order. Logical time is data and is
not a tie-breaker.

### 4. The first slice established cumulative-trace POST operations

The Java 17 Spring Boot gateway began with:

```text
POST /api/v1/worlds/first-bloom-meadow/runs
POST /api/v1/runs/{runId}/commands
```

Both return the same cumulative `RunView` shape. `events` always contains the
complete trace from sequence `1` through the latest event.

The First Bloom command contract requires:

- `schemaVersion: "1.0.0"`;
- a non-empty `commandId`;
- the same `runId` as the URL;
- `expectedSequence` equal to the latest returned sequence;
- `kind: "TICK"`;
- an empty `payload`.

The per-run coordinator serializes commands. Retrying an already successful
`commandId` returns the original response and does not tick Flower again.
`expectedSequence` rejects a stale or speculative next action.

The API intentionally has no event GET endpoint and no SSE stream. A
cumulative response is enough for the first local vertical slice and keeps the
authority boundary testable without introducing an unneeded transport layer.

Verdant adds a second run factory:

```text
POST /api/v1/worlds/verdant-signal-garden/runs
```

It reuses the same command envelope and cumulative `RunView`. Its allowed
commands are strict variants:

- `TICK {}` calls the run's `Worker.tickOnce()` once;
- `ADVANCE_TIME {"millis": 1..300000}` advances the run's actual
  `ManualClock` without ticking;
- `SEND_SIGNAL {"name":"yard-assignment"}` publishes the actual subscribed
  mission event.

Idempotency and optimistic sequence checks apply equally to all three.

### 5. Projection replay is not runtime recovery

Projection replay reduces a prerecorded trace to reconstruct the semantic world
and its animation timeline. It does not execute Flower and must be visibly
labelled as replay.

Flower checkpoint/resume is a separate capability. A checkpoint stores where a
Flow can resume; it is not an execution-event history and is not part of the
first mission.

### 6. Worlds use minimal compile-time manifests

The current catalog has two executable entries:

```text
first-bloom-meadow       AVAILABLE
verdant-signal-garden    AVAILABLE
```

The manifests provide identifiers, display names, learning objectives, status,
and currently executable command kinds. Registration is compile-time. There is
no reflection discovery, DLL/JAR loading, remote executable plugin, marketplace,
asset-bundle protocol, dependency injection framework, or runtime version
negotiation.

The shared runtime currently lives in the Maven module `runtime/`; it is not
duplicated inside each world directory. Stable module boundaries should be
extracted only after more playable worlds reveal actual duplication.

### 7. Signal/Timeout precedence is explicit mission policy

Verdant Signal Garden does not teach that Flower has a generic “first trace
sequence wins” Signal/Timeout arbiter.

Flower exposes Step-local Signal and timeout observations. A mission Step
decides what to do by checking the real `StepContext` and returning a real
`StepResult`. If both `hasSignal(...)` and `timedOut()` are true on the same
tick, the mission Step's explicit check order is the precedence policy.

The trace therefore records, from inside that real Step:

- whether the Signal was present;
- whether the timeout predicate was true;
- the check precedence used by that Flow definition;
- the returned `StepResult`;
- the selected downstream Step.

Trace sequence explains the order in which inputs and commands were recorded.
`VERDANT.WAIT_EVALUATED` records both predicates and the declared
`SIGNAL_THEN_TIMEOUT` check order. `VERDANT.WAIT_DECIDED`, the real
`FLOWER.STEP_RESULT`, and their source/test evidence explain the winner. Once
Flower applies the StepResult and exits the waiting Step, a later Signal cannot
reopen that completed wait. `VERDANT.TIMEOUT_REJECTED` is deliberately a
mission-level explanation, not a Flower core event.

## Future work, not v1 architecture

The following require a later mission or demonstrated scale:

- polling endpoints and SSE delivery;
- reconnect and gap catch-up protocols;
- a durable or database-backed trace journal;
- checkpoint and recovery;
- multi-replica run ownership, routing, leases, or fencing;
- dynamic world discovery or remote plugin loading;
- runtime/plugin version negotiation.

Future work must preserve the same authority pipeline, but it must not be
implemented merely because a hypothetical world might need it.

## Consequences

### Positive

- Every visible core transition is backed by an actual Flower run.
- One command maps to one Worker tick, so the learning model matches Flower.
- The cumulative response is simple to inspect, replay, and test.
- A second world reuses the proven boundary without introducing a browser-side
  Signal/Timeout simulator.

### Costs

- Live play requires the Java gateway in addition to the web application.
- Exact StepResult teaching requires a small probe inside the mission Step.
- Cumulative responses are intentionally local-scale and will need an explicit
  transport decision if traces become large.

## Rejected alternatives

### Browser-side Flower simulation

Rejected because it creates a second semantics implementation.

### Multiple Step executions hidden inside one player tick

Rejected because Flower invokes at most one current Step per Flow tick and the
game must preserve that boundary.

### Dynamic plugin infrastructure before multiple playable worlds

Rejected because speculative extension points would add recognition debt before
the first learning loop is complete.

### SSE, database persistence, and multi-replica routing in the first slice

Rejected for now because the implemented cumulative two-POST API already proves
the required runtime-to-world pipeline.

## Verification

The current vertical slice must pass:

1. Maven tests proving the four Flower ticks without sleeps;
2. HTTP tests for create, command validation, sequence checking, and idempotency;
3. a canonical trace whose event order matches the runtime;
4. JSON parsing and cross-event checks for contiguous sequence, stable run
   identity, and final sequence;
5. deterministic Signal-first, Timeout-first, and both-true tests;
6. byte-for-byte comparison of generated runtime responses with checked-in
   Verdant replay bundles;
7. projection reducer tests for all three outcomes and unknown event kinds;
8. web build and replay smoke tests for both routes.
