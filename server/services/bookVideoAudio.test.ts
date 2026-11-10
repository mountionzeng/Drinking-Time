import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, expect, it, vi } from "vitest";
import { planBookAudioPacing } from "../../shared/bookVideoAudio";
import { bookAudioText } from "../../shared/bookAudioBlock";
const mocks = vi.hoisted(() => ({ assets: vi.fn(), imports: vi.fn() }));
vi.mock("./storyAudioAssets", () => ({
  listOwnedStoryAudioAssets: mocks.assets,
}));
vi.mock("./storyAudioImport", () => ({ importAudioBytes: mocks.imports }));
const { musicFilter, narrationFilter, prepareBookVideoAudio } = await import(
  "./bookVideoAudio"
);
const run = promisify(execFile);
const dir = await mkdtemp(path.join(os.tmpdir(), "book-audio-test-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

it("rejects stale whole-book speech before creating any assets", async () => {
  mocks.assets.mockResolvedValue([
    {
      id: 5,
      status: "ready",
      provenance: {
        textHash: "old",
        bookTarget: { wholeBook: { kind: "storyboard", dialogueOnly: true } },
      },
    },
  ]);
  await expect(
    prepareBookVideoAudio({
      storyId: 7,
      userId: 8,
      chapters: [
        { blocks: { body: bookAudioText(7, 5, "台词", "narration") } },
      ],
      shots: [{ draftShotId: "a", voiceText: "更新的台词" }],
      musicAssetIds: [],
    })
  ).rejects.toThrow("当前稿件不一致");
  expect(mocks.imports).not.toHaveBeenCalled();
});

it("does not turn unrelated library narration into this book's voice", async () => {
  mocks.assets.mockResolvedValue([
    {
      id: 5,
      status: "ready",
      provenance: {
        bookTarget: { wholeBook: { kind: "storyboard", dialogueOnly: true } },
      },
    },
  ]);
  expect(
    await prepareBookVideoAudio({
      storyId: 7,
      userId: 8,
      chapters: [],
      shots: [{ draftShotId: "a", voiceText: "台词" }],
      musicAssetIds: [],
    })
  ).toBeUndefined();
});

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const available =
  spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
it.skipIf(!available)(
  "renders slower speech with real silence and a crossfaded full-length music bed",
  async () => {
    const source = path.join(dir, "source.wav");
    await run(
      ffmpeg,
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=24000:duration=3",
        "-y",
        source,
      ],
      { timeout: 5000 }
    );
    const plan = planBookAudioPacing(
      [{ draftShotId: "a", durationSec: 10, voiceText: "一\n二" }],
      [
        {
          text: "一",
          start: 0.1,
          end: 1.1,
          cutStart: 0.05,
          cutEnd: 1.2,
          probability: 1,
        },
        {
          text: "二",
          start: 1.9,
          end: 2.9,
          cutStart: 1.8,
          cutEnd: 3,
          probability: 1,
        },
      ]
    );
    const samples: Buffer[] = [];
    for (const [name, graph] of [
      ["voice", narrationFilter(plan)],
      ["music", musicFilter(3, plan.durationFrames)],
    ]) {
      const filterPath = path.join(dir, `${name}.txt`),
        output = path.join(dir, `${name}.pcm`);
      await writeFile(filterPath, graph);
      await run(
        ffmpeg,
        [
          "-nostdin",
          "-v",
          "error",
          "-i",
          source,
          "-filter_complex_script",
          filterPath,
          "-map",
          "[out]",
          "-ar",
          "24000",
          "-ac",
          "1",
          "-f",
          "s16le",
          "-y",
          output,
        ],
        { timeout: 5000 }
      );
      const pcm = await readFile(output);
      expect(pcm.length / 2 / 24000).toBeCloseTo(10, 2);
      samples.push(pcm);
    }
    const amplitude = (pcm: Buffer, seconds: number) => {
      const start = Math.round(seconds * 24000) * 2;
      let sum = 0;
      for (let i = start; i < start + 480; i += 2)
        sum += Math.abs(pcm.readInt16LE(i));
      return sum / 240;
    };
    expect(
      amplitude(samples[0], plan.lines[0].startFrame / 30 + 0.2)
    ).toBeGreaterThan(100);
    expect(
      amplitude(
        samples[0],
        (plan.lines[0].audioStartFrame + plan.lines[0].audioFrames) / 30 + 0.2
      )
    ).toBe(0);
    expect(
      amplitude(samples[0], plan.lines[1].startFrame / 30 + 0.2)
    ).toBeGreaterThan(100);
    expect(amplitude(samples[1], 8)).toBeGreaterThan(100);
    expect(amplitude(samples[1], 9.95)).toBeLessThan(amplitude(samples[1], 8));
  },
  20_000
);
