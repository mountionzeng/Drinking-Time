import express from "express";
import { TRPCError } from "@trpc/server";
import { captureIdSchema, captureInputSchema } from "../../shared/materialCapture";
import { authenticateCaptureToken, readCaptureOriginal, receiveCapture } from "../services/materialCapture";
import { processCapture } from "../services/materialCaptureProcessing";
import { withComputeUser } from "../services/computeRequestAccess";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";
import { shortcutCaptureInput } from "../services/materialCaptureShortcut";

/** Cookie-free, create-only receiver. Bearer is never accepted in a query string. */
export function materialCaptureRoutes() {
  const router = express.Router();
  router.use((_req,res,next) => { res.setHeader("Cache-Control","private, no-store"); res.setHeader("X-Content-Type-Options","nosniff"); next(); });
  router.post("/receive", async (req,res,next) => {
    const token = req.headers.authorization?.match(/^Bearer (sgcapture_[A-Za-z0-9_-]{43})$/)?.[1];
    const userId = token ? await authenticateCaptureToken(token).catch(() => null) : null;
    if (!userId) { res.status(401).json({error:"分享绑定已失效，请在拾光重新绑定"}); return; }
    res.locals.captureUserId = userId;
    next();
  }, express.json({limit:"30mb"}), async (req,res) => {
    try {
      const userId = Number(res.locals.captureUserId);
      const input = req.body?.encodedItems !== undefined ? shortcutCaptureInput(userId,req.body) : captureInputSchema.parse(req.body);
      input.origin = "ios-shortcut";
      const receipt = await receiveCapture(userId,input);
      // Acknowledgement confirms originals persisted. The UI polls durable state.
      res.status(202).json({ id:receipt.id, status:receipt.status, message:receipt.status === "saved" ? "这份素材已经保存，可在拾光聊天里打开。" : "素材已保存，可回到拾光聊天查看整理进度。", path:`/m?captureId=${receipt.id}` });
      void withComputeUser(userId, () => processCapture(userId,receipt.id)).catch(() => { /* durable received/ready state is recoverable in chat */ });
    } catch (error) {
      const message=error instanceof TRPCError ? error.message : "未能接收素材，请保留原件并在拾光中重试";
      res.status(error instanceof TRPCError && error.code === "CONFLICT" ? 409 : 400).json({error:message,message});
    }
  });
  router.get("/:id/files/:sourceId", async (req,res) => {
    try {
      const userId = await resolveMediaRouteUserId(req);
      if (!userId) { res.sendStatus(401); return; }
      const {file,bytes} = await readCaptureOriginal(userId,captureIdSchema.parse(req.params.id),captureIdSchema.parse(req.params.sourceId));
      res.type(file.mime).setHeader("Content-Disposition",`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      res.setHeader("Accept-Ranges","bytes");
      const ranges=req.range(bytes.length);
      if(ranges) {
        if(typeof ranges === "number" || ranges.type !== "bytes" || ranges.length !== 1) {res.setHeader("Content-Range",`bytes */${bytes.length}`);res.sendStatus(416);return;}
        const {start,end}=ranges[0];
        res.status(206).setHeader("Content-Range",`bytes ${start}-${end}/${bytes.length}`);
        res.send(bytes.subarray(start,end+1));return;
      }
      res.send(bytes);
    } catch { res.sendStatus(404); }
  });
  return router;
}
