import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Schema = {
  $ref?: string;
  const?: string | number | boolean | null;
  enum?: Array<string | number | boolean | null>;
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
};

type ContractSchema = {
  schemaVersion: number;
  $defs: Record<string, Schema>;
};

export type GenerateOptions = {
  schemaPath: string;
  serverOutput: string;
  clientOutput: string;
  check?: boolean;
};

const SUPPORTED_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const SUPPORTED_KEYS = new Set([
  "$ref", "const", "enum", "type", "properties", "required", "additionalProperties",
  "items", "minLength", "maxLength", "pattern", "minimum", "maximum",
]);

function assertSchema(node: Schema, location: string, definitions: Record<string, Schema>): void {
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYS.has(key)) throw new Error(`Unsupported schema keyword ${key} at ${location}`);
  }
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  for (const type of types) {
    if (!SUPPORTED_TYPES.has(type)) throw new Error(`Unsupported schema type ${type} at ${location}`);
  }
  if (node.$ref && !/^#\/\$defs\/[A-Za-z][A-Za-z0-9]*$/.test(node.$ref)) {
    throw new Error(`Unsupported schema ref at ${location}`);
  }
  if (node.$ref && !Object.hasOwn(definitions, node.$ref.split("/").at(-1)!)) {
    throw new Error(`Unknown schema ref at ${location}`);
  }
  if (node.type === "object" && node.additionalProperties !== false) {
    throw new Error(`Object schemas must set additionalProperties=false at ${location}`);
  }
  if (node.type === "object") {
    const properties = node.properties ?? {};
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(properties, key)) throw new Error(`Required property ${key} does not exist at ${location}`);
    }
  }
  if (node.type === "array" && !node.items) throw new Error(`Array schema needs items at ${location}`);
  for (const [key, child] of Object.entries(node.properties ?? {})) assertSchema(child, `${location}.${key}`, definitions);
  if (node.items) assertSchema(node.items, `${location}[]`, definitions);
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

function typeFor(node: Schema): string {
  if (node.$ref) return node.$ref.split("/").at(-1)!;
  if (Object.hasOwn(node, "const")) return literal(node.const);
  if (node.enum) return node.enum.map(literal).join(" | ");
  if (Array.isArray(node.type)) return node.type.map(type => typeFor({ ...node, type })).join(" | ");
  switch (node.type) {
    case "string": return "string";
    case "number":
    case "integer": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "array": return `Array<${typeFor(node.items!)}>`;
    case "object": {
      const required = new Set(node.required ?? []);
      return `{ ${Object.entries(node.properties ?? {}).map(([key, child]) => `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${typeFor(child)};`).join(" ")} }`;
    }
    default: throw new Error("Schema node needs type, enum, const, or $ref");
  }
}

function render(schema: ContractSchema): string {
  const json = JSON.stringify(schema.$defs, null, 2);
  const types = Object.entries(schema.$defs)
    .map(([name, definition]) => `export type ${name} = ${typeFor(definition)};`)
    .join("\n\n");
  return `/* eslint-disable */\n// GENERATED FILE. Run scripts/generate-miniprogram-contract.ts; do not edit.\nexport const WORKSPACE_CONTRACT_VERSION = ${schema.schemaVersion} as const;\n\n${types}\n\nexport type WorkspaceContractName = ${Object.keys(schema.$defs).map(literal).join(" | ")};\nexport type ContractValidation = { ok: true } | { ok: false; issues: string[] };\n\ntype RuntimeSchema = {\n  $ref?: string; const?: unknown; enum?: unknown[]; type?: string | string[];\n  properties?: Record<string, RuntimeSchema>; required?: string[]; additionalProperties?: boolean;\n  items?: RuntimeSchema; minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number;\n};\nconst DEFINITIONS: Record<string, RuntimeSchema> = ${json};\n\nfunction validateNode(schema: RuntimeSchema, value: unknown, at: string, issues: string[]): void {\n  if (schema.$ref) {\n    const target = DEFINITIONS[schema.$ref.split("/").pop() || ""];\n    if (!target) { issues.push(at + ": unknown schema reference"); return; }\n    validateNode(target, value, at, issues); return;\n  }\n  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) issues.push(at + ": unexpected constant");\n  if (schema.enum && !schema.enum.includes(value)) issues.push(at + ": value is not in enum");\n  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];\n  if (types.length && !types.some(type => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value) : type === "object" ? typeof value === "object" && value !== null && !Array.isArray(value) : typeof value === type)) {\n    issues.push(at + ": wrong type"); return;\n  }\n  if (typeof value === "string") {\n    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(at + ": too short");\n    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(at + ": too long");\n    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push(at + ": pattern mismatch");\n  }\n  if (typeof value === "number") {\n    if (schema.minimum !== undefined && value < schema.minimum) issues.push(at + ": below minimum");\n    if (schema.maximum !== undefined && value > schema.maximum) issues.push(at + ": above maximum");\n  }\n  if (Array.isArray(value) && schema.items) value.forEach((item, index) => validateNode(schema.items!, item, at + "[" + index + "]", issues));\n  if (schema.type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {\n    const record = value as Record<string, unknown>; const properties = schema.properties || {};\n    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(record, key)) issues.push(at + "." + key + ": required");\n    for (const key of Object.keys(record)) {\n      if (!Object.prototype.hasOwnProperty.call(properties, key)) { if (schema.additionalProperties === false) issues.push(at + "." + key + ": unknown field"); }\n      else validateNode(properties[key], record[key], at + "." + key, issues);\n    }\n  }\n}\n\nexport function validateWorkspaceContract(name: string, value: unknown): ContractValidation {\n  const schema = DEFINITIONS[name];\n  if (!schema) return { ok: false, issues: ["$: unknown contract " + name] };\n  const issues: string[] = []; validateNode(schema, value, "$", issues);\n  return issues.length === 0 ? { ok: true } : { ok: false, issues };\n}\n`;
}

export async function generateWorkspaceContracts(options: GenerateOptions): Promise<void> {
  const raw = JSON.parse(await readFile(options.schemaPath, "utf8")) as Partial<ContractSchema>;
  if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion! < 1 || !raw.$defs || typeof raw.$defs !== "object") {
    throw new Error("Contract schema needs a positive integer schemaVersion and $defs");
  }
  for (const [name, definition] of Object.entries(raw.$defs)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`Invalid contract name ${name}`);
    assertSchema(definition, `$defs.${name}`, raw.$defs);
  }
  const output = render(raw as ContractSchema);
  for (const target of [options.serverOutput, options.clientOutput]) {
    if (options.check) {
      const current = await readFile(target, "utf8").catch(() => "");
      if (current !== output) throw new Error(`Generated contract is out of date: ${path.basename(target)}`);
    } else {
      await writeFile(target, output, "utf8");
    }
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  await generateWorkspaceContracts({
    schemaPath: path.join(root, "shared/miniprogramWorkspace.schema.json"),
    serverOutput: path.join(root, "shared/miniprogramWorkspace.ts"),
    clientOutput: path.join(root, "miniprogram/src/contracts/workspace.ts"),
    check: process.argv.includes("--check"),
  });
}
