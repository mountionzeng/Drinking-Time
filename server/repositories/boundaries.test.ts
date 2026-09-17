import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const directory = path.join(root, "server/repositories");
const files = readdirSync(directory).filter(
  file => file.endsWith(".ts") && !file.endsWith(".test.ts")
);
const parse = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );

describe("database repository boundaries", () => {
  it("keeps the legacy entry point limited to explicit compatibility exports", () => {
    const facade = parse(path.join(root, "server/db.ts"));
    for (const node of facade.statements) {
      expect(ts.isExportDeclaration(node)).toBe(true);
      if (ts.isExportDeclaration(node)) {
        expect(
          node.exportClause,
          "never expose repository internals with export *"
        ).toBeDefined();
      }
    }
  });

  it("keeps repository dependencies acyclic and independent of the legacy facade", () => {
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const dependencies: string[] = [];
      const source = parse(path.join(directory, file));
      for (const node of source.statements) {
        if (
          !ts.isImportDeclaration(node) ||
          !ts.isStringLiteral(node.moduleSpecifier)
        )
          continue;
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith(".")) continue;
        const target = path.resolve(directory, specifier + ".ts");
        expect(target, file).not.toBe(path.join(root, "server/db.ts"));
        if (path.dirname(target) === directory)
          dependencies.push(path.basename(target));
      }
      graph.set(file, dependencies);
    }
    expect(graph.get("runtime.ts")).toEqual([]);
    const visited = new Set<string>();
    function visit(file: string, stack: string[]) {
      expect(
        stack,
        `repository cycle: ${[...stack, file].join(" -> ")}`
      ).not.toContain(file);
      if (visited.has(file)) return;
      for (const dependency of graph.get(file) ?? [])
        visit(dependency, [...stack, file]);
      visited.add(file);
    }
    for (const file of files) visit(file, []);
  });

  it("keeps mutable runtime state private to repositories", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory()
          ? walk(file)
          : /\.[cm]?tsx?$/.test(file) && !/\.(test|spec)\./.test(file)
            ? [file]
            : [];
      });
    const offenders: string[] = [];
    for (const file of walk(path.join(root, "server"))) {
      if (
        path.dirname(file) === directory ||
        file === path.join(root, "server/db.ts")
      )
        continue;
      const source = parse(file);
      for (const node of source.statements) {
        if (
          (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
          !node.moduleSpecifier ||
          !ts.isStringLiteral(node.moduleSpecifier)
        )
          continue;
        const target = path.resolve(
          path.dirname(file),
          node.moduleSpecifier.text + ".ts"
        );
        if (
          target === path.join(directory, "runtime.ts") ||
          target === path.join(directory, "testing.ts")
        )
          offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
