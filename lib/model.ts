// Constants shared by the server and the browser bundle. Keep this file free
// of Node and server imports: app code imports it at runtime.

/** What sort of human-only work a task is. */
export const KINDS = ["access", "setup", "payment", "review", "communicate", "physical", "other"] as const;

/** How a chore can be handed to agents. */
export const HANDOFF_METHODS = ["mcp", "api_access", "cli_login", "browser", "new_tool", "skill", "schedule", "other"] as const;
