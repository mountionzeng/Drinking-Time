import { afterEach, expect, it, vi } from "vitest";
import type { Request } from "express";
import { isLocalDictationRequest, transcribeLocalVoice } from "./localVoiceTranscription";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["development", "127.0.0.1", "localhost", "http://localhost:4317", true],
  ["development", "::1", "[::1]", "http://[::1]:3000", true],
  ["production", "127.0.0.1", "localhost", undefined, false],
  ["development", "192.0.2.1", "localhost", undefined, false],
  ["development", "127.0.0.1", "example.org", undefined, false],
  ["development", "127.0.0.1", "localhost", "https://example.org", false],
] as const)("checks the server mode, socket, host and origin (%s, %s, %s, %s)", (env, remoteAddress, hostname, origin, allowed) => {
  vi.stubEnv("NODE_ENV", env);
  const req = { hostname, socket: { remoteAddress }, headers: { origin } } as Request;
  expect(isLocalDictationRequest(req)).toBe(allowed);
});

it("rejects empty audio before starting a worker", async () => {
  expect(await transcribeLocalVoice("")).toEqual({ error: "请选择 8 MB 以内的录音。" });
});
