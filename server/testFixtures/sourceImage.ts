import sharp from "sharp";

/** Distinct, decodable PNGs for tests which preserve reference identity through the renderer. */
export async function sourceImageFixture(label: string | number = 1): Promise<string> {
  const seed = Array.from(String(label)).reduce((sum,c)=>sum+c.charCodeAt(0),0);
  const color = {r: seed%251, g:seed*3%251, b:seed*7%251};
  const bytes = await sharp({create:{width:16,height:16,channels:3,background:color}}).png().toBuffer();
  return "data:image/png;base64," + bytes.toString("base64");
}
