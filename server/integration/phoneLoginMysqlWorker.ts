import { consumePhoneChallenge } from "../repositories/phoneLogin";

const input = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8")) as {
  phone: string; digest: string; startAtMs: number;
};
if (input.startAtMs > Date.now()) await new Promise(resolve => setTimeout(resolve, input.startAtMs - Date.now()));
const consumed = await consumePhoneChallenge(input.phone, row => row.codeHash === input.digest);
process.stdout.write(`MYSQL_WORKER_RESULT:${JSON.stringify(consumed)}\n`, () => process.exit(0));
