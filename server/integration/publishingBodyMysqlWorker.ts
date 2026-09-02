import {
  getPublishingBodyDocument,
  savePublishingBodyDocument,
  writePublishingDraftState,
} from "../services/publishingPersistence";

type WorkerInput =
  | { action: "initialize"; storyId: number; userId: number }
  | {
      action: "save";
      storyId: number;
      userId: number;
      versionId: string;
      platform: "xiaohongshu";
      baseBodyRevision: number;
      body: string;
    };

function decodeInput(value: string | undefined): WorkerInput {
  if (!value) throw new Error("publishing body worker input is required");
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as WorkerInput;
}

async function finish(payload: unknown, exitCode = 0): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(
      `MYSQL_WORKER_RESULT:${JSON.stringify(payload)}\n`,
      error => error ? reject(error) : resolve()
    );
  });
  process.exit(exitCode);
}

try {
  const input = decodeInput(process.argv[2]);
  if (input.action === "initialize") {
    await writePublishingDraftState({
      storyId: input.storyId,
      userId: input.userId,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: {
          facts: ["事实"],
          thesis: "判断",
          emotion: "克制",
          voiceTraits: ["直接"],
          visualConcept: "居中的人物",
        },
        content: {
          title: "原标题",
          body: "原正文",
          tags: ["原标签"],
        },
        basePublishingRevision: 0,
      },
    });
    await finish(await getPublishingBodyDocument(input.storyId, input.userId));
  } else {
    await finish(await savePublishingBodyDocument(input));
  }
} catch (error) {
  const value = error as Error & {
    reason?: string;
    latestDocument?: unknown;
  };
  await finish({
    error: {
      name: value.name,
      message: value.message,
      reason: value.reason,
      latestDocument: value.latestDocument,
    },
  }, 1);
}
