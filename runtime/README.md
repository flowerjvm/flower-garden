# Flower Garden Runtime Gateway

This Spring Boot service is the authoritative runtime boundary for Flower
Garden. It uses the published `io.github.flowerjvm:flower-core:0.1.1`
artifact; the browser never advances a learning Flow on its own.

## First world

Create a real Flower run:

```http
POST /api/v1/worlds/first-bloom-meadow/runs
```

The run is submitted to an attached Engine and remains `READY`. No scheduler
is started.

Advance exactly one real Worker tick:

```http
POST /api/v1/runs/{runId}/commands
Content-Type: application/json

{
  "schemaVersion": "1.0.0",
  "commandId": "tick-1",
  "runId": "<runId from create response>",
  "expectedSequence": 2,
  "kind": "TICK",
  "payload": {}
}
```

The complete wire shape matches `contracts/run-command.schema.json`; every
field shown above is required. The URL and body `runId` must match, and
`expectedSequence` must equal the latest event sequence returned by the
gateway. Reusing the same `commandId` returns the original response and does
not tick twice only when the complete command is identical; changing any
content under the same id is rejected.

The first mission follows this actual Flower sequence:

1. `prepare-soil` returns `STAY`.
2. `prepare-soil` returns `DONE`.
3. `grow-stem` returns `DONE`.
4. `bloom` returns `DONE`; Flower marks the Flow `FINISHED`.

Every response includes cumulative, sequence-numbered lifecycle and
`STEP_RESULT` trace events, source/test evidence, and the final outcome once
the real Flow finishes.

## Second world: Verdant Signal Garden

Create a deterministic Signal vs Timeout experiment:

```http
POST /api/v1/worlds/verdant-signal-garden/runs
```

The response is a `READY` real Flower Flow. First send a `TICK` command to
enter `wait-for-yard-assignment`. Its `onEnter` starts the actual
`StepContext` timeout at 30,000 milliseconds and subscribes to the in-memory
event bus. That first tick returns `STAY`.

The Verdant run supports exactly three command kinds through the same command
endpoint:

```json
{
  "schemaVersion": "1.0.0",
  "commandId": "advance-29s",
  "runId": "<runId>",
  "expectedSequence": 9,
  "kind": "ADVANCE_TIME",
  "payload": {
    "millis": 29000
  }
}
```

```json
{
  "schemaVersion": "1.0.0",
  "commandId": "yard-assignment-at-29s",
  "runId": "<runId>",
  "expectedSequence": 11,
  "kind": "SEND_SIGNAL",
  "payload": {
    "name": "yard-assignment"
  }
}
```

`TICK` still requires an empty payload. `ADVANCE_TIME` accepts one integer
`millis` field from 1 through 300,000. `SEND_SIGNAL` accepts only the
`yard-assignment` name. Payloads with missing or additional fields are
rejected.

The event-bus callback calls the real `StepContext.signal(...)`; it never
chooses the Flow route. On the next real Worker tick,
`WaitForYardAssignmentStep` checks:

```text
hasSignal("yard-assignment")
then
timedOut()
```

This mission therefore declares `SIGNAL_THEN_TIMEOUT` precedence. When both
predicates are true on the same tick, Signal selects `yard-move`. That is
application policy visible in the mission Step and its `StepResult`, not a
generic Flower ordering guarantee. Trace sequence only describes command and
observation order.

The decisive tick returns `GOTO yard-move` or `GOTO timed-out`. A Signal
published after the waiting Step exits is recorded as
`GARDEN.SIGNAL_IGNORED`, even while the selected route Step is still pending;
it cannot reopen the Wait. One final tick runs that selected route and returns
`FINISH`.

### Canonical deterministic timelines

All timelines begin with `TICK {}` to enter and arm the waiting Step.

1. Signal first:
   `ADVANCE_TIME 29000` → `SEND_SIGNAL` → `TICK` → `TICK`.
   Final state: `SIGNALED`.
2. Timeout first:
   `ADVANCE_TIME 30000` → `TICK` → late `SEND_SIGNAL` → `TICK`.
   The late Signal is ignored after the Wait exits; the pending timeout route
   then finishes with final state `TIMED_OUT`.
3. Both true on one tick:
   `ADVANCE_TIME 30000` → `SEND_SIGNAL` → `TICK` → `TICK`.
   Final state: `SIGNALED`; the trace includes
   `VERDANT.TIMEOUT_REJECTED` with reason `SIGNAL_PRECEDENCE`.

No timeline starts a scheduler, sleeps, or implements a second transition
engine outside Flower.

### Generate canonical RunView responses

The runtime test suite executes all three timelines against Flower and writes
their final cumulative responses to:

```text
target/generated-fixtures/verdant-signal-first.run-view.json
target/generated-fixtures/verdant-timeout-first.run-view.json
target/generated-fixtures/verdant-same-tick.run-view.json
```

These generated files are replay inputs captured from actual execution. They
are not Flower checkpoints or reconstructed browser traces.

## Verify

From the repository root:

```bash
mvn -f runtime/pom.xml clean test
npm run fixtures:verdant:check
```

The second command proves that the checked-in browser traces are byte-for-byte
derived from those newly generated final `RunView` responses. After an
intentional runtime change, run `npm run fixtures:verdant` once to materialize
the new versioned trace bundles, review the diff, and rerun the check.
