/** Closed mobile-workspace surface. Never forward arbitrary tRPC paths. */
export const GAME_WORKSPACE_OPERATIONS = [
  "account.read",
  "account.balance",
  "profile.read",
  "profile.save",
  "letters.list",
  "letters.rewrite",
  "letters.reread",
  "stories.list",
  "stories.create",
  "body.read",
  "body.initialize",
  "body.save",
  "chat.list",
  "chat.generate",
  "chat.status",
  "chat.append",
] as const;
export type GameWorkspaceOperation = (typeof GAME_WORKSPACE_OPERATIONS)[number];
export function isGameWorkspaceOperation(
  value: string
): value is GameWorkspaceOperation {
  return (GAME_WORKSPACE_OPERATIONS as readonly string[]).includes(value);
}
