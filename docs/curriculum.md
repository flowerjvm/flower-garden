# Flower Garden curriculum

Flower Garden reduces recognition debt by introducing one executable Flower
contract at a time. The learning loop is hands-on:

```text
Assemble or change an input
        ↓
Run the actual Flower Runtime
        ↓
Record execution events and state changes
        ↓
Project those facts into the 3D world
        ↓
Adjust the design and run again
```

The browser never grades workflow semantics. A mission succeeds or fails
because an actual Flower Step returned a result and the Runtime recorded the
resulting state.

## Learning order

| World | Theme | Concepts | Status |
| ---: | --- | --- | --- |
| 01 | Core execution | Engine, Worker, Flow, Step, StepResult | Available |
| 02 | Waiting and races | Event, Signal, StepContext, ManualClock, Timeout | Available |
| 03 | Durability | Checkpoint, resume, recovery | Planned |
| 04 | Operations | Graceful stop, immediate stop, Worker lanes | Planned |
| 05 | Reliability | Retry, idempotency, external effects | Planned |
| 06 | Design | Guards, paths, DSL, validation | Planned |

## 01. First Bloom Meadow

Mission: **The First Flow**

Goal:

> Assemble Flower parts and make one flower bloom.

The builder contains one fixed Engine and six player-placeable parts:

- one `Worker`;
- one `Flow`;
- `prepare-soil`;
- `wait-for-sunlight`;
- `grow-stem`;
- `bloom`.

The player connects the parts and chooses the Step order. When the build is
complete, the browser serializes the layout and submits it to the JVM Runtime.
The JVM validates IDs and uniqueness but does not compare the order with a
hidden answer. It constructs an actual Flower `Flow` in the submitted order.

The Worker then executes one real tick at a time. The 3D scene follows only
runtime facts:

```text
GARDEN.BLUEPRINT_ACCEPTED  → show the accepted route
FLOWER.STEP_ENTERED        → move the Worker to that Step
FLOWER.STEP_RESULT         → show DONE, STAY, or FAIL
GARDEN.PLOT_UPDATED        → change soil, stem, or flower
FLOWER.FLOW_FINISHED       → complete the mission
FLOWER.FLOW_FAILED         → stop the mission
```

### Player-authored Bloom input

`wait-for-sunlight` returns `STAY` until sunlight has been granted. The game
pauses and gives the player a single input:

```text
Publish SUNLIGHT_GRANTED
```

The command stores the mission fact and publishes a real event through Bloom's
`LocalEventBus` and Flower adapter. It does not call the Worker. The next
player-driven tick lets the waiting Step observe the fact and return `DONE`.

This interaction makes three contracts tangible:

1. a waiting Step can return `STAY`;
2. an event can wake a wait without advancing the Flow by itself;
3. the next Worker tick is where the Step actually decides to continue.

### Experiments

The successful dependency chain is intentionally strict and easy to discover:

```text
prepare soil
        ↓
wait for and accept sunlight
        ↓
grow stem
        ↓
bloom
```

Other orders expose real domain failures:

- `wait-for-sunlight` before soil → `SOIL_NOT_READY`;
- `grow-stem` before soil → `SOIL_NOT_READY`;
- `grow-stem` before accepted sunlight → `SUNLIGHT_NOT_READY`;
- `bloom` before a stem → `STEM_NOT_GROWN`.

The result card stays short. Full events remain available in a collapsed
advanced drawer.

## 02. Verdant Signal Garden

Mission: **Signal vs Timeout**

Goal:

> Control the clock and Signal input, then observe which path the real waiting
> Step chooses.

Verdant adds these concepts on top of World 01:

- Step-local Signal state;
- a real `ManualClock`;
- timeout observation;
- explicit precedence inside a Step;
- `StepResult.gotoStep(...)`.

The three challenges are:

| Scenario | Facts at the deciding tick | Runtime result |
| --- | --- | --- |
| Signal at 29s | Signal=true, Timeout=false | `GOTO yard-move` |
| Timeout at 30s | Signal=false, Timeout=true | `GOTO timed-out` |
| Both at 30s | Signal=true, Timeout=true | declared `SIGNAL_THEN_TIMEOUT` policy |

The lesson is not that Flower globally races trace timestamps. Flower exposes
facts to the Step, and the Step's actual code returns the transition. A late
Signal cannot reopen a wait that Flower already exited.

## Why core comes first

Starting with Signal and Timeout introduces a Worker tick, current Step,
Step-local state, runtime clock, competing conditions, and StepResult at the
same time. World 01 first makes the execution hierarchy physical:

```text
Engine owns runtime services
Worker drives execution
Flow contains ordered Steps
Step returns StepResult
```

World 02 then adds waiting and competing inputs without reteaching that
hierarchy.

## Growth rule

A world becomes `AVAILABLE` only when one complete vertical slice exists:

```text
actual Flower behavior and tests
        ↓
strict input and trace contracts
        ↓
pure World Projection
        ↓
playable 3D feedback
        ↓
manifest, route, and catalog entry
```

Fixed scenarios may include a checked-in trace replay. A player-authored Flow
must not fall back to a canonical success trace when the Runtime is offline.

Checkpoint, recovery, Worker stopping, retry, idempotency, incident response,
and visual Flow design should enter the product only with a world that lets the
player experience their real contracts.
