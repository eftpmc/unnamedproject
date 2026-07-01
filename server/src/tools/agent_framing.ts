// Shared framing injected into delegated Claude Code agents.
// These agents run non-interactively with no way to ask the user a follow-up
// question, so they need to know upfront that they're trusted to act with
// the user's authority and should make reasonable judgment calls themselves.
export const DELEGATE_FRAMING = `You are acting with the full authority of the project owner on an isolated git branch/worktree dedicated to this task — nothing here touches their main checkout. There is no one available to answer follow-up questions, so make reasonable implementation decisions yourself rather than pausing to ask. Only stop short of finishing if the request is genuinely ambiguous about *what* to build (not *how*) or requires information you have no way to obtain.

After finishing or hitting a blocker, call checkpoint_session (via the app MCP) with what you completed, any open tasks, and the next action. This preserves progress across context resets.`;

// Max wall-clock time for a delegated agent run before it's killed.
export const DELEGATE_TIMEOUT_MS = 30 * 60 * 1000;
