# Flower Garden

Flower Garden is a collection of small, playful 3D worlds for learning Flower
through prediction, real execution, observation, and evidence.

## 가장 쉬운 실행

Windows에서는 저장소 루트의 **`PLAY.cmd`를 더블클릭**하면 됩니다.

런처가 한 번에 처리합니다.

1. 첫 실행에 필요한 웹 의존성과 Maven을 준비합니다.
2. 실제 Flower 0.1.1 Runtime을 시작합니다.
3. 변경된 경우에만 3D 웹 게임을 빌드하고 시작합니다.
4. 두 번째 월드 `Verdant Signal Garden`을 브라우저에서 자동으로 엽니다.

플레이하는 동안 런처 창을 열어두고, 종료할 때 그 창에서 Enter를
누르세요. 런처가 자신이 시작한 프로세스만 종료합니다.

필수 프로그램은 Node.js 22.13 이상과 JDK 17 이상입니다. Maven은
프로젝트에 포함된 Maven Wrapper가 자동으로 준비하므로 별도로 설치할
필요가 없습니다.

The game starts with Flower core:

```text
Flower Garden
├─ 01 First Bloom Meadow              AVAILABLE
│  └─ The First Flow
│     Engine → Worker → Flow → Step → StepResult
└─ 02 Verdant Signal Garden           AVAILABLE
   └─ Signal vs Timeout
      Event → Signal → ManualClock → explicit Step policy
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

## Playable vertical slices

**First Bloom Meadow / The First Flow** introduces the execution core. Its JVM
gateway uses the published
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

Its runtime implementation lives in
[`runtime/src/main/java/io/github/flowerjvm/garden/runtime`](runtime/src/main/java/io/github/flowerjvm/garden/runtime),
and the 3D world lives in
[`worlds/first-bloom-meadow/web`](worlds/first-bloom-meadow/web).

**Verdant Signal Garden / Signal vs Timeout** adds one controlled layer:

- an actual event subscription that calls `StepContext.signal(...)`;
- an actual per-run `ManualClock` and 30-second timeout;
- player commands for `ADVANCE_TIME` and `SEND_SIGNAL`;
- one real Worker tick where the Step reads `hasSignal(...)` and
  `timedOut()`;
- an explicit `SIGNAL_THEN_TIMEOUT` mission policy if both are true;
- three canonical real-runtime traces: Signal-first, Timeout-first, and
  both-ready on the same tick.

The 3D garden and its result explanation consume only those runtime records.
They do not compare timestamps or choose a route in the browser.

## Prerequisites

- Node.js `>=22.13.0`
- JDK `>=17`

## Run locally

Windows에서는 위의 `PLAY.cmd` 더블클릭을 권장합니다. 명령줄에서 같은
런처를 실행하려면 다음 한 줄이면 됩니다.

```powershell
.\PLAY.cmd
```

개별 서비스를 직접 디버깅해야 할 때만 다음처럼 실행합니다. Maven은
저장소의 Wrapper를 사용합니다.

```powershell
.\runtime\mvnw.cmd -f runtime\pom.xml spring-boot:run
npm run dev -- --hostname 127.0.0.1 --port 3000
```

The web application runs on `http://127.0.0.1:3000`. The gateway runs on
`http://127.0.0.1:8080`; the one-click launcher configures that URL.
Set `NEXT_PUBLIC_FLOWER_RUNTIME_URL` before starting the web app to use a
different gateway.

Open the core world at `/` and Verdant Signal Garden at
`/worlds/verdant-signal-garden`.

If the JVM gateway is unavailable, either UI may replay its matching
checked-in canonical trace. That mode remains visibly labelled as a
prerecorded real-runtime replay, and its controls only move a cursor through
recorded events.

## Runtime API

The implemented gateway exposes:

```text
POST /api/v1/worlds/first-bloom-meadow/runs
POST /api/v1/worlds/verdant-signal-garden/runs
POST /api/v1/runs/{runId}/commands
```

Every response is a cumulative `RunView`. Its `events` array is the complete
trace from sequence `1` through the latest event, not a delta. A valid command
contains a unique `commandId`, the URL's `runId`, and the latest
`expectedSequence`.

| Command | Payload | Effect |
| --- | --- | --- |
| `TICK` | `{}` | Calls this mission Worker's `tickOnce()` exactly once |
| `ADVANCE_TIME` | `{"millis": 1..300000}` | Advances Verdant's real `ManualClock`; does not tick |
| `SEND_SIGNAL` | `{"name":"yard-assignment"}` | Publishes Verdant's subscribed mission event |

Retrying a successful `commandId` returns the original cumulative response
without applying its command twice when the complete command is identical.
Reusing an id with changed content is rejected. First Bloom accepts only
`TICK`; Verdant accepts all three commands.

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
    world.manifest.json
    web/
```

Worlds use small checked-in manifests and compile-time registration. They are
not dynamically loaded plugins. A dynamic plugin loader, marketplace, remote
code loading, dependency negotiation, and version negotiation are future
questions that require multiple completed worlds first.

## Verify

```bash
./runtime/mvnw -f runtime/pom.xml clean test
npm run fixtures:verdant:check
npm test
```

The runtime tests verify the four core ticks and all three Signal/Timeout
outcomes with actual Flower execution and no sleeps. They also verify
cumulative trace order, strict payload validation, optimistic sequence
checking, and idempotent command retry. Canonical replay fixtures live in
[`contracts/fixtures`](contracts/fixtures).

## Explicitly deferred

The following are intentionally not implemented yet:

- checkpoint, retry, failure injection, or Worker stop controls;
- event polling and SSE reconnect;
- database persistence or a durable trace journal;
- multi-replica ownership, routing, leases, or fencing;
- dynamic or remote world plugins.

They should be introduced only with the first playable mission that needs each
capability.
