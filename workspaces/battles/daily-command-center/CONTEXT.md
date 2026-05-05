# Daily Command Center Context

## Purpose
This is Battles' execution cockpit. It is for deciding what matters now, reducing chaos into a short action list, tracking unresolved loops, and recording operating decisions that should shape the next conversation.

## Route Here When
- The user asks what to do next.
- The user is overwhelmed, scattered, or switching between too many priorities.
- A task needs to become a daily plan, priority stack, or next-action list.
- Jarvis needs to reconcile business, personal, content, and production commitments.
- There is a decision that should be remembered for near-term execution.

## Read First
1. `current-state.md` when present.
2. `priorities.md`
3. `open-loops.md`
4. `decisions-log.md`
5. The target workspace `CONTEXT.md` only if the plan depends on a specific domain.

## Prefer
- Short plans with 1-5 concrete actions.
- "Smallest next step" framing when the user sounds overloaded.
- Explicit tradeoffs: what gets attention now, what waits, and why.
- Updating existing daily files instead of creating many one-off notes.
- Capturing decisions in plain English with dates.

## Skip Unless Needed
- Full business folders unless a specific business decision is being made.
- Personal-life details unless the schedule or emotional load matters.
- Research folders unless a plan depends on factual evidence.
- Code files unless the next action is implementation.

## Pipeline
1. Capture the user's raw input.
2. Sort it into priority, open loop, decision, or later.
3. Pick the smallest useful next step.
4. Name the blocker or missing context.
5. Record durable decisions or open loops.

## Files
- `current-state.md` - short living snapshot of what Jarvis should know right now.
- `priorities.md` - current focus areas and priority stack.
- `open-loops.md` - unresolved tasks, questions, blockers, and follow-ups.
- `decisions-log.md` - day-to-day operating decisions worth remembering.

## Output Formats
Use one of these formats unless the user asks otherwise:

### Daily Plan
- Top priority:
- Next action:
- Blocker:
- Later:

### Open Loop
- Date:
- Loop:
- Owner:
- Next check:
- Destination workspace:

### Decision
- Date:
- Decision:
- Why:
- Follow-up:

## Approval Boundaries
Do not schedule events, send messages, spend money, make commitments, or alter external systems from this workspace without explicit approval.

## Handoff Back To PRIME
Return the selected priority, the next action, any updated file, and any workspace that should receive follow-up work.
