import {
  guardComputeFetch,
  withComputeUser,
} from "../services/computeRequestAccess";

const ids = JSON.parse(
  Buffer.from(process.argv[2], "base64url").toString()
) as number[];
process.env.NODE_ENV = "production";
let requests = 0;
const fetcher = guardComputeFetch(async () => {
  requests++;
  return new Response("test-only");
});
const outcomes = await Promise.all(
  ids.map(id =>
    withComputeUser(id, async () => {
      try {
        await fetcher("https://supplier.invalid", { method: "POST" });
        return "allowed";
      } catch (error) {
        return error instanceof Error ? error.message : "error";
      }
    })
  )
);
console.log("MYSQL_WORKER_RESULT:" + JSON.stringify({ outcomes, requests }));
process.exit(0);
