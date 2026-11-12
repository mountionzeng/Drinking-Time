import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import type { WarehouseFile } from "../../shared/warehouseFiles";
const exec = promisify(execFile);
type Extraction = Pick<
  WarehouseFile,
  "extractedText" | "extractionStatus" | "extractionNote"
>;
const textExtensions = new Set(
  "txt md markdown csv tsv json jsonl yaml yml xml html htm css js jsx ts tsx py rb go rs java c cpp h sh sql toml ini log srt vtt ass rst tex rtf".split(
    " "
  )
);

// Reads bounded archive members in memory. Never extracts paths, imports modules from
// the document, runs macros, follows links, or executes the user's code.
const officeReader = String.raw`
import sys,zipfile,json,xml.etree.ElementTree as E
filename,kind=sys.argv[1:3]
out=[]
def add(s):
 if sum(map(len,out))<40000: out.append(s)
with zipfile.ZipFile(filename) as z:
 infos=z.infolist()
 if len(infos)>2000: raise ValueError('Too many archive entries')
 def xml(name):
  info=z.getinfo(name)
  if info.file_size>4000000 or info.flag_bits&1: raise ValueError('Large or encrypted member')
  data=z.read(info)
  if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError('XML entities are not supported')
  return E.fromstring(data)
 def texts(root): return [n.text or '' for n in root.iter() if n.tag.rsplit('}',1)[-1]=='t']
 if kind=='zip':
  for info in infos[:1000]: add(info.filename+' · '+str(info.file_size)+' bytes')
 elif kind=='docx':
  root=xml('word/document.xml')
  for p in root.iter():
   if p.tag.rsplit('}',1)[-1]=='p': add(''.join(texts(p)))
 elif kind=='pptx':
  names=sorted(n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml'))
  for name in names[:100]: add(name+'\n'+' '.join(texts(xml(name))))
 elif kind=='xlsx':
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   shared=[''.join(texts(n)) for n in xml('xl/sharedStrings.xml') if n.tag.rsplit('}',1)[-1]=='si']
  names=sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml'))
  for name in names[:20]:
   add(name)
   rows=[n for n in xml(name).iter() if n.tag.rsplit('}',1)[-1]=='row']
   for row in rows[:500]:
    vals=[]
    for cell in list(row)[:50]:
     value=next((n.text or '' for n in cell if n.tag.rsplit('}',1)[-1]=='v'),'')
     if cell.get('t')=='s': value=shared[int(value)] if value.isdigit() and int(value)<len(shared) else ''
     elif cell.get('t')=='inlineStr': value=''.join(texts(cell))
     vals.append(cell.get('r','')+': '+value)
    add(' | '.join(vals))
print(json.dumps({'text':'\n'.join(out)[:40000]},ensure_ascii=False))
`;

export async function extractWarehouseFile(
  filePath: string,
  extension: string,
  mime: string
): Promise<Extraction> {
  let text = "";
  let note = "";
  let partial = false;
  try {
    if (textExtensions.has(extension) || mime.startsWith("text/")) {
      const bytes = await readFile(filePath);
      text =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? bytes.subarray(2).toString("utf16le")
          : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("binary file");
      note = "已读取文本；代码仅作为文本 / Text read; code is not executed";
    } else if (extension === "pdf") {
      text = (
        await exec(
          process.env.PDFTOTEXT_PATH || "pdftotext",
          ["-f", "1", "-l", "80", "-layout", filePath, "-"],
          { timeout: 15000, maxBuffer: 1024 * 1024 }
        )
      ).stdout;
      note =
        "只读取前80页可提取文字，不含图片/OCR / Text from up to 80 pages; no OCR";
      partial = true;
    } else if (["docx", "xlsx", "pptx", "zip"].includes(extension)) {
      const result = await exec(
        process.env.PYTHON_PATH || "python3",
        ["-c", officeReader, filePath, extension],
        { timeout: 15000, maxBuffer: 1024 * 1024 }
      );
      text = JSON.parse(result.stdout).text;
      note =
        extension === "zip"
          ? "只读取文件清单，未解压分析内容 / File list only; contents not analyzed"
          : "已读取正文/单元格/幻灯片文字；不含嵌入图片、宏或公式计算 / Text/values only; no images, macros or formula evaluation";
      partial = true;
    } else
      return {
        extractedText: "",
        extractionStatus: "stored",
        extractionNote:
          "原文件已保存，当前格式暂不能直接读取 / Original saved; this format cannot be read yet",
      };
    const truncated = text.length > 40000;
    text = text.slice(0, 40000).trim();
    if (!text)
      return {
        extractedText: "",
        extractionStatus: "stored",
        extractionNote:
          "原件已保存，未取得可读文字；扫描件或加密文件需要另行处理 / Saved; no readable text found",
      };
    return {
      extractedText: text,
      extractionStatus: partial || truncated ? "partial" : "readable",
      extractionNote:
        note +
        (truncated ? "；文字只保留前40000字 / first 40,000 characters" : ""),
    };
  } catch {
    return {
      extractedText: "",
      extractionStatus: "stored",
      extractionNote:
        "原件已保存，文字解析未完成；可能是加密、格式损坏或解析器不可用 / Saved; text extraction unavailable",
    };
  }
}
