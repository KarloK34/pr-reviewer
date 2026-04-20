## Coding Guidelines

### Think Before Coding
- State assumptions explicitly. If a request is ambiguous, ask before implementing.
- If multiple approaches exist, present them — don't pick silently.
- Push back when a simpler solution exists.

### Simplicity First
- Minimum code that solves the problem. No speculative features.
- No abstractions for single-use code.
- No error handling for impossible scenarios.
- Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes
- Touch only what the task requires. Don't "improve" adjacent code.
- Match existing style (even if you'd do it differently).
- Remove imports/variables that *your* changes orphaned — don't remove pre-existing dead code.
- Every changed line should trace directly to the request.

### Goal-Driven Execution
- Transform vague tasks into verifiable goals before starting.
- For multi-step tasks, state a brief plan with a verify step for each item.
