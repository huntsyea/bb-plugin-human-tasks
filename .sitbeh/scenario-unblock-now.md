# Unblock now

**Situation:** builder mid-flow on other work; an agent hits a human-only step;
wants to unblock it in minutes.

**Limitations:** while focused on another thread; taking no more than a few
minutes; often without the context of the conversation that asked.

**Actions:** notice the request → understand exactly what to do and where →
do it (often in a web console) → hand back the result (a value, a credential,
"done") → be confident the agent continued.

**Thinking:** "Which agent wants this, and why?" · "I'll do it later" (and
forgets) · "Where is that setting again?" · "Can I just paste the key here?"
· "Did it even get my answer?"

**Feelings:** interrupted, mildly anxious about secrets, impatient.

| Action | Barrier | Reason | Mechanism |
| --- | --- | --- | --- |
| Notice | Don't know | Request buried in a busy thread | M1 badge, toast, system notification, home list, thread banner; blocking tasks as native thread form (push) |
| Understand | Can't | Steps lack context | M2 instructions + project/bot/thread links; M3 "Ask the agent" without completing |
| Do it | Can't | Hunting for the right page | M4 primary "Open <site>" button from the first link, on the collapsed row |
| Do it | Don't want | Feels like the agent's job | M10 "Let the agent do it this time": hand it back with access (MCP, key, browser) |
| Hand back | Can't | A value or file is needed | M5 reply prompt; checkbox opens the answer box when a reply is required |
| Hand back | Don't know | Pasting a key into chat is unsafe | M6 secret form via `bb secret request`; note guard |
| Confidence | Don't know | Silent after "done" | M7 "Agent resumed" confirmation from thread activity; M8 agent can reopen with a reason if it isn't done |

**Reinforce:** done → toast with who resumed, "Agent resumed" on the card.
Dropped → badge stays red while blocking; banner in the waiting thread.
