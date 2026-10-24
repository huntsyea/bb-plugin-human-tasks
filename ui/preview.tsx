// "See an example": made-up tasks rendered entirely in the browser. Nothing is
// written to the server, and real tasks are untouched. Also used for the
// marketplace screenshots.
import { createContext, useContext } from "react";
import type { BotInfo, TaskStats, TodoView } from "../server";

export const PreviewContext = createContext(false);
export const usePreview = () => useContext(PreviewContext);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const BOTS: Record<string, BotInfo> = {
  billing: { id: "example-bot-billing", name: "Billing Engineer", role: "Engineer", color: "#6d5dfc", mainThreadId: null },
  seo: { id: "example-bot-seo", name: "SEO Lead", role: "Marketing", color: "#f5a524", mainThreadId: null },
};

function example(
  id: string,
  fields: Partial<TodoView> & Pick<TodoView, "title" | "instructions" | "kind">,
  relations: { project: string; thread: string; bot?: keyof typeof BOTS },
): TodoView {
  const now = Date.now();
  return {
    id: `example-${id}`,
    agentNeeds: null,
    blocking: false,
    replyPrompt: null,
    secrets: [],
    envFile: null,
    status: "open",
    sourceThreadId: null,
    sourceProjectId: null,
    sourceThreadTitle: relations.thread,
    sourceBotId: null,
    watcherThreadIds: [],
    handoffMethod: null,
    handoffSummary: null,
    handedBack: false,
    doneByAgent: false,
    handbackNote: null,
    agentNote: null,
    question: null,
    questionAt: null,
    dueAt: null,
    snoozedUntil: null,
    createdAt: now - 10 * MIN,
    updatedAt: now,
    completedAt: null,
    completionNote: null,
    notifyResult: null,
    notifyDetail: null,
    resumedAt: null,
    recurrence: { count: 0, agentDidSimilar: null },
    waitingInThread: false,
    thread: { id: `example-thread-${id}`, title: relations.thread, state: "live" },
    project: { id: `example-project-${relations.project}`, name: relations.project },
    bot: relations.bot ? { ...BOTS[relations.bot]!, via: "thread" } : null,
    ...fields,
  };
}

export function previewData(): { todos: TodoView[]; stats: TaskStats; bots: BotInfo[] } {
  const now = Date.now();
  const todos: TodoView[] = [
    example(
      "stripe",
      {
        title: "Create a restricted Stripe API key for the billing worker",
        kind: "access",
        blocking: true,
        waitingInThread: true,
        createdAt: now - 6 * MIN,
        instructions:
          "1. Open [Stripe → Developers → API keys](https://dashboard.stripe.com/apikeys).\n2. **Create restricted key** named `billing-worker`.\n3. Grant *Read* on Customers and *Write* on Invoices. Leave everything else off.\n4. Mark this done. I'll ask for the key in a secure form.",
        agentNeeds: "The Stripe MCP server or a Stripe CLI login (`stripe login`) on this machine. Either lets me create restricted keys myself, now and next time.",
        secrets: [{ name: "STRIPE_BILLING_KEY", description: "Restricted Stripe key for the billing worker" }],
        envFile: ".env.local",
      },
      { project: "acme-web", thread: "Move invoices to the worker", bot: "billing" },
    ),
    example(
      "dns",
      {
        title: "Add the TXT record to verify acme.dev in Search Console",
        kind: "setup",
        createdAt: now - 42 * MIN,
        instructions:
          "In [Cloudflare DNS](https://dash.cloudflare.com) for `acme.dev`, add:\n\n```\nType:  TXT\nName:  @\nValue: google-site-verification=3f9c1a\n```\n\nThen press **Verify** in Search Console.",
        agentNeeds: "A Cloudflare API token with DNS edit on acme.dev only. With it I can add records myself.",
        agentNote: "I checked: the TXT record isn't visible yet. Did you add it on the root (@) of acme.dev?",
      },
      { project: "acme-web", thread: "Launch checklist for acme.dev", bot: "seo" },
    ),
    example(
      "iphone",
      {
        title: "Check the onboarding animation on a real iPhone",
        kind: "review",
        createdAt: now - 3 * HOUR,
        replyPrompt: "Does it stutter, and on which card?",
        instructions: "Install TestFlight build **1.8.0 (212)** and run onboarding. Watch the card stack as you swipe.",
      },
      { project: "acme-mobile", thread: "Smooth the onboarding cards" },
    ),
    example(
      "domain",
      {
        title: "Renew the acme.dev domain",
        kind: "payment",
        createdAt: now - DAY,
        dueAt: now + 2 * DAY,
        instructions: "Renew [acme.dev](https://www.namecheap.com/myaccount/) for 2 years. Auto-renew is off.",
      },
      { project: "acme-web", thread: "Launch checklist for acme.dev", bot: "seo" },
    ),
    example(
      "prod-db",
      {
        title: "Rotate the production database password",
        kind: "access",
        createdAt: now - 5 * HOUR,
        instructions: "Rotate the password in the cloud console, then update `DATABASE_URL` in production secrets.",
        recurrence: { count: 1, agentDidSimilar: { taskId: "example-staging-db", method: "cli_login" } },
      },
      { project: "acme-api", thread: "Quarterly credential rotation" },
    ),
    example(
      "appstore",
      {
        title: "Upload the new screenshots to App Store Connect",
        kind: "setup",
        status: "in_progress",
        handedBack: true,
        handbackNote: "Use my bb browser, I'm signed in to App Store Connect.",
        agentNeeds: "Permission to use your signed-in bb browser for App Store Connect.",
        createdAt: now - 4 * HOUR,
        instructions: "Open [App Store Connect](https://appstoreconnect.apple.com), go to version 1.8.0, and replace the 6.7\" screenshots with the files in `store/screenshots/`.",
      },
      { project: "acme-mobile", thread: "Prepare the 1.8 release" },
    ),
    example(
      "post",
      {
        title: "Post the launch announcement on LinkedIn",
        kind: "communicate",
        createdAt: now - 2 * HOUR,
        snoozedUntil: now + 18 * HOUR,
        instructions: "Post the draft in `launch/linkedin.md` from your account at 9:00 tomorrow.",
      },
      { project: "acme-web", thread: "Launch checklist for acme.dev", bot: "seo" },
    ),
    example(
      "staging-db",
      {
        title: "Rotate the staging database password",
        kind: "access",
        status: "done",
        createdAt: now - 9 * DAY,
        completedAt: now - 9 * DAY + 20 * MIN,
        resumedAt: now - 9 * DAY + 21 * MIN,
        notifyResult: "notified",
        notifyDetail: "The requesting thread was told",
        handedBack: true,
        doneByAgent: true,
        completionNote: "Done by the agent: rotated it with the gcloud CLI and updated the staging secret.",
        handoffMethod: "cli_login",
        handoffSummary: "Rotated it with the gcloud CLI and updated the staging secret.",
        instructions: "Rotate the password in the cloud console and update the staging secret.",
      },
      { project: "acme-api", thread: "Quarterly credential rotation" },
    ),
  ];
  const open = todos.filter((todo) => todo.status !== "done" && todo.status !== "dismissed" && !todo.handedBack && !(todo.snoozedUntil && todo.snoozedUntil > now));
  return {
    todos,
    stats: { open: open.length, blocking: open.filter((todo) => todo.blocking).length, done: 1, doneByAgents: 1 },
    bots: Object.values(BOTS),
  };
}
