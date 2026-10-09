import { generateBilledStoryboardVoice } from "../services/storyboardVoiceBilling";
import { listUnsettledMediaOperations } from "../repositories/computeLedger";
import { getAccountBalance } from "../services/computeLedger";

// This worker only uses the disposable database selected by the test harness.
const userId = Number(process.argv[2]);
process.env.NODE_ENV = "production";
let calls = 0;
try {
  const result = await generateBilledStoryboardVoice({ userId, storyId: 1, key: `mysql-voice-${userId}`, text: "你好", provider: "test", voice: "test" }, async () => {
    calls++;
    return { audioUrl: "https://example.com/test.mp3", provider: "test", voice: "test" };
  });
  const pending = await listUnsettledMediaOperations();
  process.stdout.write(`MYSQL_WORKER_RESULT:${JSON.stringify({ result, calls, pending: pending.length, balance: await getAccountBalance(userId) })}\n`, () => process.exit(0));
} catch (error) {
  console.error(error);
  process.exit(1);
}
