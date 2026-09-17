/**
 * 从用户确认的网页「渲染 1」确定性提取小程序动画所需的三个图层。
 *
 * 不生成或重绘视觉内容：背景、杯子和提示字的像素全部来自
 * login-hero-reference.jpg。运行：node miniprogram/scripts/build-render-one-layers.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "src/assets/brand/login-hero-reference.jpg");
const outputDir = path.join(root, "src/assets/brand");
const cupCrop = { left: 360, top: 230, width: 340, height: 440 };
const cupClearBounds = { left: 325, top: 230, right: 715, bottom: 675 };
const promptCrop = { left: 385, top: 685, width: 270, height: 75 };

function colorAt(data, width, channels, x, y) {
  const offset = (y * width + x) * channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function interpolate(left, right, ratio) {
  return left.map((channel, index) =>
    Math.round(channel + (right[index] - channel) * ratio),
  );
}

function colorDistance(actual, expected) {
  return Math.hypot(
    actual[0] - expected[0],
    actual[1] - expected[1],
    actual[2] - expected[2],
  );
}

const decoded = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data: source, info } = decoded;
const background = Buffer.from(source);

// 用杯子左右两侧的同一纸张背景逐行插值，只抹掉杯子原位。
for (let y = cupClearBounds.top; y < cupClearBounds.bottom; y += 1) {
  const from = colorAt(source, info.width, info.channels, cupClearBounds.left - 1, y);
  const to = colorAt(source, info.width, info.channels, cupClearBounds.right + 1, y);
  for (let x = cupClearBounds.left; x < cupClearBounds.right; x += 1) {
    const expected = interpolate(
      from,
      to,
      (x - cupClearBounds.left) / (cupClearBounds.right - cupClearBounds.left),
    );
    const offset = (y * info.width + x) * info.channels;
    const edge = Math.min(
      x - cupClearBounds.left,
      cupClearBounds.right - 1 - x,
      y - cupClearBounds.top,
      cupClearBounds.bottom - 1 - y,
    );
    const replacement = Math.min(1, Math.max(0, edge / 20));
    background[offset] = Math.round(source[offset] * (1 - replacement) + expected[0] * replacement);
    background[offset + 1] = Math.round(source[offset + 1] * (1 - replacement) + expected[1] * replacement);
    background[offset + 2] = Math.round(source[offset + 2] * (1 - replacement) + expected[2] * replacement);
  }
}

const cup = Buffer.alloc(cupCrop.width * cupCrop.height * 4);
for (let y = 0; y < cupCrop.height; y += 1) {
  const sourceY = cupCrop.top + y;
  const left = colorAt(source, info.width, info.channels, cupClearBounds.left - 1, sourceY);
  const right = colorAt(source, info.width, info.channels, cupClearBounds.right + 1, sourceY);
  for (let x = 0; x < cupCrop.width; x += 1) {
    const sourceX = cupCrop.left + x;
    const sourceOffset = (sourceY * info.width + sourceX) * info.channels;
    const outputOffset = (y * cupCrop.width + x) * 4;
    const actual = [source[sourceOffset], source[sourceOffset + 1], source[sourceOffset + 2]];
    const expected = interpolate(
      left,
      right,
      (sourceX - cupClearBounds.left) / (cupClearBounds.right - cupClearBounds.left),
    );
    const distance = colorDistance(actual, expected);
    cup[outputOffset] = actual[0];
    cup[outputOffset + 1] = actual[1];
    cup[outputOffset + 2] = actual[2];
    cup[outputOffset + 3] = Math.round(Math.min(1, Math.max(0, (distance - 18) / 20)) * 255);
  }
}

// 提示字单独成为最上层，确保杯子倾斜经过它时字也不会被遮住。
const prompt = Buffer.alloc(promptCrop.width * promptCrop.height * 4);
for (let y = 0; y < promptCrop.height; y += 1) {
  const sourceY = promptCrop.top + y;
  const left = colorAt(source, info.width, info.channels, promptCrop.left - 1, sourceY);
  const right = colorAt(source, info.width, info.channels, promptCrop.left + promptCrop.width, sourceY);
  for (let x = 0; x < promptCrop.width; x += 1) {
    const sourceX = promptCrop.left + x;
    const sourceOffset = (sourceY * info.width + sourceX) * info.channels;
    const outputOffset = (y * promptCrop.width + x) * 4;
    const actual = [source[sourceOffset], source[sourceOffset + 1], source[sourceOffset + 2]];
    const expected = interpolate(left, right, x / promptCrop.width);
    const distance = colorDistance(actual, expected);
    const isGoldInk = actual[0] > actual[1] && actual[1] > actual[2] && actual[0] - actual[2] > 24;
    prompt[outputOffset] = actual[0];
    prompt[outputOffset + 1] = actual[1];
    prompt[outputOffset + 2] = actual[2];
    prompt[outputOffset + 3] = isGoldInk
      ? Math.round(Math.min(1, Math.max(0, (distance - 8) / 18)) * 255)
      : 0;
  }
}

mkdirSync(outputDir, { recursive: true });
await sharp(background, {
  raw: { width: info.width, height: info.height, channels: info.channels },
}).png().toFile(path.join(outputDir, "render-one-background.png"));
await sharp(cup, {
  raw: { width: cupCrop.width, height: cupCrop.height, channels: 4 },
}).png().toFile(path.join(outputDir, "render-one-cup.png"));
await sharp(prompt, {
  raw: { width: promptCrop.width, height: promptCrop.height, channels: 4 },
}).png().toFile(path.join(outputDir, "render-one-prompt.png"));

console.log("wrote render-one-background.png, render-one-cup.png, render-one-prompt.png");
