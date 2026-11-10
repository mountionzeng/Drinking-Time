import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { LocalCaptureDraft } from "./materialCaptureDraft";

const mock = vi.hoisted(() => ({
  initial: [] as unknown[],
  store: vi.fn(), payload: vi.fn(), receive: vi.fn(), process: vi.fn(),
  refetch: vi.fn(), invalidate: vi.fn(),
}));
// Exercise hook callbacks with a hydrated collector, without a browser or real storage.
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof React>("react")),
  useState: (value: unknown) => [mock.initial.length ? mock.initial.shift() : value, vi.fn()],
  useRef: (value: unknown) => ({current: value}),
  useEffect: vi.fn(),
}));
vi.mock("./materialCaptureDraft", async () => ({
  ...(await vi.importActual<typeof import("./materialCaptureDraft")>("./materialCaptureDraft")),
  captureDraftStore: mock.store,
  captureFilePayload: mock.payload,
}));
vi.mock("@/lib/trpc", () => ({trpc: {
  materialCapture: {
    receive: {useMutation: () => ({mutateAsync: mock.receive})},
    process: {useMutation: () => ({mutateAsync: mock.process})},
    saveOriginal: {useMutation: () => ({mutateAsync: vi.fn()})},
    list: {useQuery: () => ({data: [],refetch: mock.refetch})},
    get: {useQuery: () => ({data: null,isError: false})},
  },
  useUtils: () => ({storyAgent: {storyList: {invalidate: mock.invalidate}}}),
}}));
import { useMaterialCapture } from "./useMaterialCapture";

beforeEach(() => {
  vi.resetAllMocks();
  mock.initial = [null, false, true, false, "", false];
  mock.store.mockResolvedValue(undefined);
  mock.payload.mockResolvedValue({id:"file",name:"photo.png",mime:"image/png",base64:"aW1hZ2U="});
  mock.receive.mockResolvedValue({id:"receipt"});
  mock.process.mockResolvedValue(undefined);
});
function setup() {
  const capture = useMaterialCapture(21);
  capture.addFiles([new File(["image"], "photo.png", {type:"image/png"})]);
  return capture;
}
function savedDraft() {
  return mock.store.mock.calls.at(-1)?.[3] as LocalCaptureDraft | undefined;
}

it("allows removing an unreadable file when upload never started", async () => {
  const capture = setup();
  mock.payload.mockRejectedValueOnce(new Error("无法读取photo.png"));
  await capture.submit();
  capture.removeFile(0);
  await vi.waitFor(() => expect(savedDraft()).toMatchObject({files:[],submitted:false}));
  expect(mock.receive).not.toHaveBeenCalled();
  expect(mock.process).not.toHaveBeenCalled();
});

it("unlocks a new batch after local persistence fails before upload", async () => {
  const capture = setup();
  await vi.waitFor(() => expect(savedDraft()?.files).toHaveLength(1));
  mock.store.mockRejectedValueOnce(new Error("storage full"));
  await capture.submit();
  capture.removeFile(0);
  await vi.waitFor(() => expect(savedDraft()).toMatchObject({files:[],submitted:false}));
  expect(mock.receive).not.toHaveBeenCalled();
});

it("keeps an uncertain uploaded batch immutable, even if the next local file read fails", async () => {
  const capture = setup();
  mock.receive.mockRejectedValueOnce(new Error("response lost"));
  await capture.submit();
  const uncertain = savedDraft();
  expect(uncertain).toMatchObject({submitted:true,files:[expect.any(File)]});
  mock.payload.mockRejectedValueOnce(new Error("unreadable on retry"));
  await capture.submit();
  capture.removeFile(0);
  await vi.waitFor(() => expect(savedDraft()).toEqual(uncertain));
  expect(mock.receive).toHaveBeenCalledTimes(1);
  expect(mock.process).not.toHaveBeenCalled();
});

it("allows replacing a file explicitly rejected by the server", async () => {
  const capture = setup();
  mock.receive.mockRejectedValueOnce({data:{code:"BAD_REQUEST"},message:"invalid image"});
  await capture.submit();
  capture.removeFile(0);
  await vi.waitFor(() => expect(savedDraft()).toMatchObject({submitted:false,files:[]}));
  expect(mock.process).not.toHaveBeenCalled();
});
