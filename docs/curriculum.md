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

Status: **PLANNED · LOCKED**

Mission: **Signal vs Timeout**

This mission has no executable runtime commands or canonical trace in v1. It
will be unlocked only after its real Flower Flow, tests, projection, and
evidence are implemented.

The intended lesson is more precise than “the lowest sequence wins”:

1. Signal publication and logical time advancement create inputs.
2. On a real Worker tick, the waiting mission Step checks
   `hasSignal(...)` and `timedOut()`.
3. The Step's explicit check order defines precedence if both predicates are
   true.
4. The Step returns the StepResult that selects the downstream path.
5. Flower applies that result; a later input cannot reopen the exited wait.

Trace sequence explains when commands and observations were recorded. The
actual mission Step decision explains the winner. The future result panel must
cite that Step source and deterministic tests, including a case where both
predicates are true on the same tick.

## Why core-first

Starting with Signal/Timeout introduces a Worker tick, a current Step,
Step-local Signal state, a runtime clock, condition precedence, and a
StepResult at once. That recreates the recognition debt the game is intended to
reduce.

**The First Flow** makes Engine, Worker, Flow, Step, and StepResult concrete
first. **Signal vs Timeout** can later focus on input timing and explicit Flow
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
