import {
  getAdminUsersOverview,
  setAdminUserCategory,
} from "../repositories/adminUsers";
const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString());
const before = await getAdminUsersOverview("www.drinkingtime.top", new Date("2026-10-21T12:00:00Z"));
for (const action of input.actions ?? []) await setAdminUserCategory(action.userId, action.category, input.actor);
const result = await getAdminUsersOverview(
  "www.drinkingtime.top",
  new Date("2026-10-21T12:00:00Z")
);
console.log("MYSQL_WORKER_RESULT:" + JSON.stringify({ before, after: result }));
process.exit(0);
