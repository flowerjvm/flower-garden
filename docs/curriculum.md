# Flower Garden Curriculum

## Learning principle

Flower Garden introduces one runtime idea at a time:

```text
Predict → Command → Actual Flower execution → Observe → Explain with evidence
```

A learner should know which object performed an action before learning a race
involving that action. The curriculum starts with Flower's core execution chain
and adds Signal and Timeout only after that vocabulary is stable.

## 01. First Bloom Meadow

Status: **AVAILABLE**

Mission: **The First Flow**

```text
Engine → Worker → Flow → Step → StepResult
```

The player creates a run and issues one `TICK` at a time. The run uses an actual
attached Flower Engine and a manually driven Worker. Four ticks reveal four
small facts:

| Tick | Prediction focus | Actual execution |
| ---: | --- | --- |
| 1 | Can a Step remain current? | `prepare-soil → STAY` |
| 2 | What does DONE do? | `prepare-soil → DONE`; current Step advances |
| 3 | When does the next Step execute? | `grow-stem` enters on this later tick and returns `DONE` |
| 4 | How does the last Step finish a Flow? | `bloom → DONE`; Flow becomes `FINISHED` |

The spatial vocabulary is:

- the attached Engine is the garden's runtime;
- the Worker carries one tick to each active Flow;
- the Flow is one travelling seed;
- each Step is one explicit patch of work;
- the StepResult tells Flower whether that Flow stays, advances, or terminates.

The second tick advances the Flow's current Step to `grow-stem`, but Flower does
not enter or execute `grow-stem` until the third tick. This boundary is an
important part of the lesson: one Flow tick invokes at most one current Step.

The result panel must show the exact trace group between
`GARDEN.TICK_REQUESTED` and `GARDEN.TICK_COMPLETED`, including the real
StepResult. A flower animation alone never proves completion.

## 02. Verdant Signal Garden

Status: **AVAILABLE**

Mission: **Signal vs Timeout**

```text
Event → Signal → StepContext → ManualClock → StepResult
```

The player first arms a real `wait-for-yard-assignment` Step. That Step starts
a 30-second timeout and subscribes to the mission event. The player then
predicts which predicates the next tick will observe, changes the real run's
`ManualClock`, optionally publishes the real event, and asks the Flower Worker
to tick. The actual Step policy and `StepResult` then reveal the winner.

Three deterministic scenarios isolate the important distinctions:

| Scenario | Inputs before the deciding tick | Actual policy/result |
| --- | --- | --- |
| Signal at 29 seconds | Signal true, timeout false | `GOTO yard-move` |
| Timeout at 30 seconds | Signal false, timeout true | `GOTO timed-out` |
| Both ready at 30 seconds | Signal true, timeout true | `SIGNAL_THEN_TIMEOUT`, so `GOTO yard-move` |

The intended lesson is more precise than “the lowest trace sequence wins”:

1. `ADVANCE_TIME` changes the actual per-run `ManualClock`; it does not tick
   Flower.
2. `SEND_SIGNAL` publishes the actual subscribed event. Its callback marks the
   Step's Signal, but does not select a route.
3. On the next real `Worker.tickOnce()`, the waiting mission Step reads
   `hasSignal(...)` and `timedOut()`.
4. If both are true, this Flow definition's explicit
   `SIGNAL_THEN_TIMEOUT` check order decides precedence.
5. The Step returns the real `StepResult` that selects `yard-move` or
   `timed-out`; Flower applies that result.
6. Exiting the waiting Step disposes its subscription. A later Signal is
   recorded as ignored and cannot reopen that completed wait.

Trace sequence explains when commands and observations were recorded. The
`VERDANT.WAIT_EVALUATED` and `VERDANT.WAIT_DECIDED` records explain the
decision that the actual mission Step made. The result panel links that
decision to its Step source and deterministic Signal-first, Timeout-first, and
both-true tests.

## Why core-first

Starting with Signal/Timeout introduces a Worker tick, a current Step,
Step-local Signal state, a runtime clock, condition precedence, and a
StepResult at once. That recreates the recognition debt the game is intended to
reduce.

**The First Flow** makes Engine, Worker, Flow, Step, and StepResult concrete
first. **Signal vs Timeout** then focuses on input timing and explicit Flow
policy instead of reteaching the execution hierarchy.

## Growth rule

A world becomes `AVAILABLE` only when one complete vertical slice exists:

```text
prediction
→ real Flower command
→ recorded trace
→ world projection
→ 3D feedback
→ source and test evidence
```

Planned themes include checkpoint/recovery, Worker stopping,
retry/idempotency, incident response, and visual Flow design. Their commands
and infrastructure must not enter the current contract before a playable
mission needs them.
