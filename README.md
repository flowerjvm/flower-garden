# Flower Garden

[한국어](README.ko.md)

**Learn Flower by projecting executions from the real Flower Runtime into
playful 3D microworlds.**

Flower Garden is an educational game for learning the core concepts of
[Flower](https://github.com/flowerjvm/flower). Instead of memorizing the
documentation first, players assemble Flower parts, run the resulting Flow on
an actual Flower Runtime, and manipulate events while its execution is
projected into a 3D world.

<table>
  <tr>
    <td width="50%">
      <img src="public/worlds/first-bloom-meadow-cover.webp" alt="First Bloom Meadow voxel world" />
    </td>
    <td width="50%">
      <img src="public/worlds/verdant-signal-garden-cover.webp" alt="Verdant Signal Garden voxel world" />
    </td>
  </tr>
  <tr>
    <td><strong>01 · First Bloom Meadow</strong><br />Start with the smallest useful Flower execution model.</td>
    <td><strong>02 · Verdant Signal Garden</strong><br />Explore Signal and Timeout observations through an explicit Step policy.</td>
  </tr>
</table>

## Why Flower Garden?

As the Flower ecosystem grows, a new learner may encounter `Engine`, `Worker`,
`Flow`, `Step`, `Signal`, `Timeout`, and `Checkpoint` all at once. Flower
Garden reduces that conceptual overhead by teaching one runtime contract at a
time in each world.

```text
Assemble Worker, Flow, and Step parts
  ↓
Submit the blueprint
  ↓
Run the actual Flower Runtime
  ↓
Send events when a Step waits
  ↓
Record execution events and state changes
  ↓
Project the result into the 3D world
```

The project is built around one architectural invariant:

```text
Actual Flower Runtime
        ↓
Recorded execution events and state changes
        ↓
World Projection
        ↓
3D game world
```

For workflow execution facts in Flower Garden, the actual Flower Runtime is the
sole authority for Flow state, the current Step, StepResult, and the final
execution outcome. The browser and 3D scenes never calculate a Step transition,
winning path, or terminal state. They only reduce and project the trace produced
by Flower into a world that is easier to understand.

See [ADR-0001](docs/adr/0001-runtime-authoritative-world-projection.md) for the
architectural decision and [contracts/README.md](contracts/README.md) for the
wire contract.

## Quick start

### Requirements

- Node.js `22.13` or newer
- JDK `17` or newer
- An internet connection during the first launch
- Local ports `3000` and `8080`

Maven does not need to be installed separately. The included Maven Wrapper
downloads the required distribution.

### Windows

1. Download or clone this repository.
2. Double-click **`PLAY.cmd`** in the repository root.
3. Choose a world in the browser.
4. When you finish playing, press Enter in the launcher window.

```powershell
git clone https://github.com/flowerjvm/flower-garden.git
cd flower-garden
.\PLAY.cmd
```

The first launch may take longer while npm and the Maven Wrapper download their
dependencies. Later launches rebuild only when the source has changed.

`PLAY.cmd` handles the complete local session:

1. verifies the required tools;
2. starts the actual Flower `0.1.1` JVM Runtime;
3. builds and starts the 3D web application;
4. opens the world library at `http://127.0.0.1:3000/`;
5. stops only the processes that it started.

### macOS, Linux, or development mode

Use two terminals.

Terminal 1:

```bash
SERVER_ADDRESS=127.0.0.1 \
  ./runtime/mvnw -f runtime/pom.xml spring-boot:run
```

Terminal 2:

```bash
npm ci
NEXT_PUBLIC_FLOWER_RUNTIME_URL=http://127.0.0.1:8080 \
  npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000/`.

## Playable worlds

### 01 · First Bloom Meadow

**Mission: The First Flow**

```text
Engine → Worker → player-built Flow → ordered Steps → StepResult
```

The player places one Worker, one Flow, and four Step blocks on a compact
builder:

```text
prepare-soil
wait-for-sunlight
grow-stem
bloom
```

The browser submits the chosen Step order without grading it. The JVM builds an
actual Flower `Flow` in that order and the Worker executes it one tick at a
time. When `wait-for-sunlight` returns `STAY`, the game pauses and asks the
player to publish `SUNLIGHT_GRANTED`. That input travels through a real Bloom
`LocalEventBus` and Flower adapter. Publishing the event does not tick the
Worker; the waiting Step observes the stored fact and returns `DONE` on the
next real tick.

Changing the Step order is a genuine experiment. A missing prerequisite causes
the responsible Step to return `StepResult.FAIL`, and the 3D garden stops at
the state reached by the Runtime. The browser never compares the assembly with
a hidden answer array. The first mission's dependency chain is soil → sunlight
wait → stem → bloom.

This world teaches:

- how Engine, Worker, Flow, and ordered Steps fit together;
- that Steps own the mission's domain prerequisites;
- the difference between `STAY`, `DONE`, and `FAIL`;
- that an event can wake a wait without secretly advancing the Worker;
- that the 3D garden changes only after runtime-recorded state changes.

### 02 · Verdant Signal Garden

**Mission: Signal vs Timeout**

```text
Event → Signal → StepContext → ManualClock → StepResult
```

The player changes a real `ManualClock`, optionally publishes a real event, and
predicts what the next Worker tick will observe. Every button sends exactly one
runtime command; there is no pre-scripted scenario macro.

| Scenario | Facts before the deciding tick | Actual policy and result |
| --- | --- | --- |
| Signal at 29s | Signal=true, Timeout=false | `GOTO yard-move` |
| Timeout at 30s | Signal=false, Timeout=true | `GOTO timed-out` |
| Both at 30s | Signal=true, Timeout=true | `SIGNAL_THEN_TIMEOUT` → `yard-move` |

The three challenges unlock in order. A run that reaches the wrong route is
shown as `MISSION FAILED` with the missing trace facts, and a successful runtime
outcome still requires a final evidence answer before the lesson is cleared.

This world teaches:

- a Signal is a wake-up hint and does not directly choose a transition;
- advancing time and ticking a Worker are separate commands;
- when multiple predicates are true, the Step's explicit policy determines
  precedence;
- a late Signal cannot reopen a Wait that Flower has already exited.

Planned curriculum themes include Checkpoint/Recovery, Worker Stop,
Retry/Idempotency, incident response, and visual Flow design.

See [docs/curriculum.md](docs/curriculum.md) for the complete learning order.

## LIVE Runtime and Recorded Replay

When launched locally with `PLAY.cmd`, the Flower JVM Runtime Gateway is
available. After the player starts a mission, that run is labelled `LIVE`.

The First Bloom builder requires the live Runtime because every player
blueprint may be different; it never substitutes a prerecorded success.
Worlds with fixed scenarios may provide a canonical trace generated by real
Flower execution. Such replay controls may only move a cursor through recorded
events and must be clearly labelled `RECORDED REPLAY`.

## Adding a world

Each world is an independent educational game module:

```text
worlds/<world-id>/
├─ world.manifest.json
└─ web/
```

A completed world is registered in [worlds/catalog.ts](worlds/catalog.ts) and
then appears in the world library. All worlds share one web application and one
Flower Runtime Gateway, so a new world does not require a separate server.
The manifest and 3D UI live under `worlds/<world-id>`; the authoritative JVM
mission implementations currently live in the shared `runtime/` module.

The current registry is compile-time and explicit. A marketplace that loads
untrusted remote plugin code is deliberately out of scope for now.

Every new world should be completed in this order:

```text
Actual runtime behavior and tests
→ command and trace contracts
→ pure World Projection
→ 3D UI
→ manifest, route, and catalog registration
```

A checked-in replay fixture is optional and only appropriate for a fixed
scenario. Player-authored Flow builders must require the live Runtime.

## Developer reference

### Runtime API

```text
POST /api/v1/worlds/first-bloom-meadow/runs
POST /api/v1/worlds/verdant-signal-garden/runs
POST /api/v1/runs/{runId}/commands
```

Every command contains a unique `commandId`, the same `runId` as the URL, and
the latest `expectedSequence`. The response is a cumulative `RunView`: its
`events` array contains the complete trace from sequence `1` through the latest
event, not a delta.

| Command | Payload | Actual effect |
| --- | --- | --- |
| `TICK` | `{}` | Calls the mission Worker's `tickOnce()` exactly once |
| `PUBLISH_EVENT` | `{"type":"SUNLIGHT_GRANTED"}` | Publishes First Bloom's event through Bloom without ticking |
| `ADVANCE_TIME` | `{"millis": 1..300000}` | Advances Verdant's actual `ManualClock` without ticking |
| `SEND_SIGNAL` | `{"name":"yard-assignment"}` | Publishes Verdant's subscribed mission event |

Retrying the same complete command with the same `commandId` returns its
original response without applying the command twice. Reusing an ID with
different command content is rejected.

### Repository layout

```text
app/                         web shell and world library
contracts/                   JSON Schemas and verified runtime traces
docs/                        curriculum and Architecture Decision Records
runtime/                     Java 17 Spring Boot Flower Runtime Gateway
web/                         shared runtime client and projections
worlds/
  first-bloom-meadow/        first world manifest and 3D UI
  verdant-signal-garden/     second world manifest and 3D UI
```

### Verification

Windows:

```powershell
.\runtime\mvnw.cmd -f runtime\pom.xml test
npm run lint
npm run fixtures:verdant:check
npm test
npm run play:smoke
```

macOS or Linux:

```bash
./runtime/mvnw -f runtime/pom.xml test
npm run lint
npm run fixtures:verdant:check
npm test
```

The runtime tests verify player-ordered First Bloom Flows, successful and
failing Step dependencies, Bloom event delivery and idempotency, plus all three
Verdant Signal/Timeout scenarios through actual Flower execution without fixed
sleeps.

## Current scope

Flower Garden is an early educational project. Runs and traces are held in
memory and disappear when the Runtime restarts. It is not a production
workflow service.

The following capabilities are deliberately not implemented yet:

- a database-backed durable trace journal;
- gameplay controls for Checkpoint, Retry, failure injection, or Worker Stop;
- SSE reconnect and multi-replica routing;
- a dynamic or remote world plugin loader.

Each capability should be introduced together with the first playable world
that genuinely needs to teach its contract.

## License

Flower Garden is released under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for copyright and attribution notices.
