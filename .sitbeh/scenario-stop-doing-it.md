# Stop doing it

**Situation:** builder notices they keep doing the same chore for agents.

**Limitations:** without time for a project; often without knowing which
integration exists; wary of giving agents broad access.

**Actions:** notice the repetition → see what an agent would need → choose the
cheapest hand-off (MCP server, API key, CLI login, browser session, new
tool/API, skill, schedule) → grant it safely → confirm agents now do it.

**Thinking:** "Is there even an API for this?" · "I don't want to give it my
whole account" · "Setting this up takes longer than doing it" · "Will it break
something?"

**Feelings:** curious but cautious; impatient with setup.

| Action | Barrier | Reason | Mechanism |
| --- | --- | --- | --- |
| Notice | Don't know | Repetition is invisible | Recurring ×N badge; "Hand-off exists" for similar tasks |
| See what's needed | Don't know | Agent's reasoning lost | Requesting agent's hint shown in the hand-off dialog |
| Choose | Can't | Unknown integrations | Every task carries the agent's own `agent_needs` ("a Cloudflare token with DNS edit on acme.dev"); no separate planning step |
| Grant safely | Don't want | Fear of over-broad access | Secrets via secret form; planner must ask before building or touching credentials; scoped keys recommended |
| This time | Don't want | Setup can wait | M10 "Let the agent do it": the agent asks in its thread for exactly that access, does it, completes with the method it used |
| Confirm | Don't know | No record of hand-offs | "Done by agent · method" on the task; "Done by agents" counter |

**Reinforce:** "Handed to agents" counter; similar future tasks are flagged so
the agent tries the hand-off first. Dropped → recurring badge keeps nudging.

## Decision (2026-10-24)

A planning thread plus a "record the result" menu was too complicated. The
user's model is simpler and now the design: the agent always says what it
needs; the user either does the task or lets the agent do it, and the agent
negotiates the access in its own thread (MCP, key via the secret form, CLI
login, browser). Recording happens implicitly when the agent completes the task
with the method it used.
