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
not tick twice.

The first mission follows this actual Flower sequence:

1. `prepare-soil` returns `STAY`.
2. `prepare-soil` returns `DONE`.
3. `grow-stem` returns `DONE`.
4. `bloom` returns `DONE`; Flower marks the Flow `FINISHED`.

Every response includes cumulative, sequence-numbered lifecycle and
`STEP_RESULT` trace events, source/test evidence, and the final outcome once
the real Flow finishes.

## Verify

```powershell
& 'C:\Program Files\JetBrains\IntelliJ IDEA Community Edition 2025.2\plugins\maven\lib\maven3\bin\mvn.cmd' test
```
