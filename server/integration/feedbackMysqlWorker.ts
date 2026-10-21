import { reviewFeedback } from "../repositories/feedback";
const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8"));
try {
  if (input.startAt > Date.now()) await new Promise(resolve => setTimeout(resolve, input.startAt - Date.now()));
  const result = await reviewFeedback({ id: input.id, action: "adopt", reply: "Accepted" }, input.actor);
  process.stdout.write(JSON.stringify(result) + "\n", () => process.exit(0));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Feedback worker failed");
  process.exit(1);
}
