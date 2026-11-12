import { expect, it } from "vitest";
import { mkdtemp, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { extractWarehouseFile } from "./warehouseFileExtraction";
async function file(ext: string, bytes: Buffer | string) {
  const dir = await mkdtemp(
    path.join(
      process.env.DRINKING_TIME_VITEST_TEMP_ROOT || tmpdir(),
      "extract-"
    )
  );
  const name = path.join(dir, `test.${ext}`);
  await writeFile(name, bytes);
  return name;
}
async function archive(ext: string, entries: Record<string, string>) {
  const name = await file(ext, "");
  execFileSync("python3", [
    "-c",
    "import sys,zipfile,json\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for k,v in json.loads(sys.argv[2]).items(): z.writestr(k,v)",
    name,
    JSON.stringify(entries),
  ]);
  return name;
}
it("reads bounded UTF8/UTF16 text and keeps unsupported/corrupt files", async () => {
  const text = "点彩世界";
  expect(
    await extractWarehouseFile(await file("md", text), "md", "text/markdown")
  ).toMatchObject({ extractedText: text, extractionStatus: "readable" });
  expect(
    (
      await extractWarehouseFile(
        await file(
          "txt",
          Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, "utf16le")])
        ),
        "txt",
        "text/plain"
      )
    ).extractedText
  ).toBe(text);
  expect(
    (
      await extractWarehouseFile(
        await file("csv", "x".repeat(40001)),
        "csv",
        "text/csv"
      )
    ).extractionStatus
  ).toBe("partial");
  expect(
    (
      await extractWarehouseFile(
        await file("bin", Buffer.from([0, 255])),
        "bin",
        "application/octet-stream"
      )
    ).extractionStatus
  ).toBe("stored");
  expect(
    (
      await extractWarehouseFile(
        await file("docx", "broken"),
        "docx",
        "application/octet-stream"
      )
    ).extractionStatus
  ).toBe("stored");
});
it("reads office text locally without executing formulas or XML entities", async () => {
  const doc = await archive("docx", {
    "word/document.xml": "<document><p><t>点彩</t></p></document>",
  });
  expect((await extractWarehouseFile(doc, "docx", "")).extractedText).toBe(
    "点彩"
  );
  const sheet = await archive("xlsx", {
    "xl/worksheets/sheet1.xml":
      '<worksheet><row><c r="A1"><f>HYPERLINK("https://example.test")</f><v>42</v></c></row></worksheet>',
  });
  const result = await extractWarehouseFile(sheet, "xlsx", "");
  expect(result.extractedText).toContain("A1: 42");
  expect(result.extractedText).not.toContain("HYPERLINK");
  const ppt = await archive("pptx", {
    "ppt/slides/slide1.xml": "<slide><t>云海</t></slide>",
  });
  expect((await extractWarehouseFile(ppt, "pptx", "")).extractedText).toContain(
    "云海"
  );
  const entity = await archive("docx", {
    "word/document.xml":
      '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><document>&x;</document>',
  });
  expect(
    (await extractWarehouseFile(entity, "docx", "")).extractionStatus
  ).toBe("stored");
});
it("lists archives without writing archive paths", async () => {
  const zip = await archive("zip", {
    "../escape.txt": "must not be extracted",
  });
  expect((await extractWarehouseFile(zip, "zip", "")).extractedText).toContain(
    "../escape.txt"
  );
  await expect(
    access(path.join(path.dirname(zip), "..", "escape.txt"))
  ).rejects.toThrow();
});
