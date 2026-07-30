# Flower Garden

Flower Garden is a collection of small, playful 3D worlds for learning Flower
through prediction, real execution, observation, and evidence.

The game starts with Flower core:

```text
Flower Garden
├─ 01 First Bloom Meadow              AVAILABLE
│  └─ The First Flow
│     Engine → Worker → Flow → Step → StepResult
└─ 02 Verdant Signal Garden           PLANNED · LOCKED
   └─ Signal vs Timeout
```

The first playable mission deliberately comes before Signal, Timeout,
Checkpoint, Retry, or Worker lifecycle lessons. It gives each core runtime
object a stable visual meaning before later worlds combine those objects.

## Architectural invariant

```text
Actual Flower Runtime
        ↓
Recorded execution events and state changes
        ↓
World Projection
        ↓
3D game world
```

Flower is the only authority for Flow execution. The browser sends commands and
projects the returned runtime trace; it never calculates a Step transition or
terminal result.

See [ADR-0001](docs/adr/0001-runtime-authoritative-world-projection.md) for the
decision and [the contract guide](contracts/README.md) for the wire contract.

## Current vertical slice

**First Bloom Meadow / The First Flow** is the only executable world in v1.
Its JVM gateway uses the published
`io.github.flowerjvm:flower-core:0.1.1` artifact with:

- `ManualClock`;
- `Engine.attach()` with no scheduler;
- one Flower `Worker`;
- one three-Step Flow;
- one real `Worker.tickOnce()` for every accepted `TICK` command.

The mission takes four player ticks:

| Tick | Current Step | Actual StepResult | Flower result |
| ---: | --- | --- | --- |
| 1 | `prepare-soil` | `STAY` | remain on the Step |
| 2 | `prepare-soil` | `DONE` | advance to `grow-stem` |
| 3 | `grow-stem` | `DONE` | advance to `bloom` |
| 4 | `bloom` | `DONE` | Flow becomes `FINISHED` |

The runtime implementation lives in
[`runtime/src/main/java/io/github/flowerjvm/garden/runtime`](runtime/src/main/java/io/github/flowerjvm/garden/runtime),
and the 3D world lives in
[`worlds/first-bloom-meadow/web`](worlds/first-bloom-meadow/web).

**Verdant Signal Garden** is curriculum only for now. Its manifest is
`PLANNED`, its mission is locked, and it has no executable commands or
canonical runtime fixture yet.

## Prerequisites

- Node.js `>=22.13.0`
- Java `>=17`
- Maven `>=3.9`

## Run locally

Install and start the web application:

```bash
npm install
npm run dev
```

In another terminal, start the real Flower runtime gateway:

```bash
mvn -f runtime/pom.xml spring-boot:run
```

The web application runs on `http://localhost:3000`. The gateway runs on
`http://localhost:8080`; the current browser client uses that URL by default.
Set `NEXT_PUBLIC_FLOWER_RUNTIME_URL` before starting the web app to use a
different gateway.

If the JVM gateway is unavailable, the UI may replay the checked-in First Bloom
trace. That mode must remain visibly labelled as a prerecorded replay, and its
controls may only move through recorded events.

## Current v1 API

The implemented gateway exposes exactly two operations:

```text
POST /api/v1/worlds/first-bloom-meadow/runs
POST /api/v1/runs/{runId}/commands
```

Both return a `RunView`. Its `events` array is the complete trace from sequence
`1` through the latest event, not a delta. A valid command contains a unique
`commandId`, the URL's `runId`, the latest `expectedSequence`, `kind: "TICK"`,
and an empty payload.

Retrying a successful `commandId` returns the original cumulative response
without ticking Flower twice.

There is no events GET endpoint, SSE stream, database-backed journal, or
multi-replica routing in the current vertical slice.

## Repository shape

```text
app/                         web application shell
contracts/                   JSON Schemas and the verified First Bloom trace
docs/                        curriculum and architecture decisions
runtime/                     Java 17 Spring Boot + Maven Flower gateway
web/                         shared runtime client and projection code
worlds/
  first-bloom-meadow/
    world.manifest.json
    web/
  verdant-signal-garden/
    world.manifest.json      planned metadata only
```

Worlds use small checked-in manifests and compile-time registration. They are
not dynamically loaded plugins. A dynamic plugin loader, marketplace, remote
code loading, dependency negotiation, and version negotiation are future
questions that require multiple completed worlds first.

## Verify

```bash
npm test
mvn -f runtime/pom.xml test
```

The runtime tests verify the four actual Flower ticks, cumulative trace order,
optimistic sequence checking, and idempotent command retry without sleeps. The
canonical fixture is
[`contracts/fixtures/first-bloom-the-first-flow.trace.json`](contracts/fixtures/first-bloom-the-first-flow.trace.json).

## Explicitly deferred

The following are not part of v1:

- Signal/Timeout execution commands;
- checkpoint, retry, failure injection, or Worker stop controls;
- event polling and SSE reconnect;
- database persistence or a durable trace journal;
- multi-replica ownership, routing, leases, or fencing;
- dynamic or remote world plugins.

They should be introduced only with the first playable mission that needs each
capability.
