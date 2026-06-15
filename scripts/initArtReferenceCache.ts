import * as fs from "fs";
import * as path from "path";

interface ArtReferenceFeature {
  artStyle: string;
  artistReference?: string;
  dominantColors: string[];
  colorTone: string;
  lightingCharacter: string;
  mood: string[];
  composition: string;
  materials: string[];
  cameraAngle: string;
  visualDescription: string;
}

interface FeaturesCache {
  [filename: string]: ArtReferenceFeature;
}

const REFERENCES_DIR = path.join(process.cwd(), "art-repository", "references");
const CACHE_OUTPUT = path.join(process.cwd(), "art-repository", "features-cache.json");

async function analyzeImageWithVision(
  imageBuffer: Buffer,
  filename: string,
): Promise<ArtReferenceFeature> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const base64Image = imageBuffer.toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: `请分析这张参考图的美术特征，并以 JSON 格式返回。必须包含以下字段：

{
  "artStyle": "美术流派（如水彩、油画、素描、插画、摄影等）",
  "artistReference": "如果识别到特定艺术家风格则注明，否则留空",
  "dominantColors": ["主要色彩列表，格式如 '金色(暖亮)'"],
  "colorTone": "整体色调（warm/cool/neutral + light/dark, 如 'warm-light'）",
  "lightingCharacter": "光线特性（如 '侧光主光源清晰'）",
  "mood": ["情感基调数组，如 ['温暖', '安静']"],
  "composition": "构图信息简要描述",
  "materials": ["材质列表，如 ['布料', '木质']"],
  "cameraAngle": "镜头角度（俯视/平视/仰视等）",
  "visualDescription": "对整张图的自然语言描述（2-3句，用于 LLM 理解）"
}

请只返回 JSON 对象，不要其他文本。`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  try {
    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    const content = data.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Unexpected response format");
    }
    const jsonStr = content.text.trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error(`Failed to parse response for ${filename}:`, error);
    throw error;
  }
}

async function initializeCache() {
  const cache: FeaturesCache = {};

  // Get all jpg files in references directory
  const files = fs
    .readdirSync(REFERENCES_DIR)
    .filter((f) => f.toLowerCase().endsWith(".jpg") || f.toLowerCase().endsWith(".jpeg"))
    .sort();

  console.log(`Found ${files.length} reference images to analyze...`);

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(REFERENCES_DIR, filename);

    try {
      console.log(`[${i + 1}/${files.length}] Analyzing ${filename}...`);

      const imageBuffer = fs.readFileSync(filePath);
      const features = await analyzeImageWithVision(imageBuffer, filename);

      cache[filename] = features;
      console.log(`  ✓ ${filename} analyzed`);

      // Small delay to avoid rate limiting
      if (i < files.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`  ✗ Failed to analyze ${filename}:`, error);
      // Continue with next file instead of failing the whole script
    }
  }

  // Write cache to file
  fs.writeFileSync(CACHE_OUTPUT, JSON.stringify(cache, null, 2));
  console.log(`\n✓ Features cache generated: ${CACHE_OUTPUT}`);
  console.log(`✓ Total images analyzed: ${Object.keys(cache).length}/${files.length}`);

  return cache;
}

initializeCache().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
