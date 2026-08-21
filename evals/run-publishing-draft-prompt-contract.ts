import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PUBLISHING_DRAFT_PROMPT_CASES } from "./publishingDraftPromptCases";
import {
  PublishingDraftPromptCorpusError,
  evaluatePublishingDraftPromptCases,
  type PublishingDraftPromptContractReport,
} from "./publishingDraftPromptContract";

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function failureReport(error: unknown): PublishingDraftPromptContractReport & {
  error: string;
} {
  return {
    offline: true,
    provider_call_count: 0,
    fixture_schema_failures: 1,
    runtime_prompt_path_failures: 0,
    hard_invariant_failures: 0,
    required_task_path_count: 0,
    case_count: 0,
    prompt_character_count: 0,
    duplicate_instruction_count: 0,
    conflicting_instruction_count: 0,
    generic_template_risk_count: 0,
    unsupported_fact_risk_count: 0,
    instruction_precedence_risk_count: 0,
    cases: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

function main(): void {
  if (!process.argv.includes("--offline")) {
    console.log(
      JSON.stringify(
        failureReport(
          new Error("必须显式传入 --offline；该评测不允许调用线上文稿模型")
        )
      )
    );
    process.exitCode = 2;
    return;
  }

  try {
    const casesPath = flagValue("cases");
    const cases = casesPath
      ? (JSON.parse(readFileSync(resolve(casesPath), "utf8")) as unknown)
      : PUBLISHING_DRAFT_PROMPT_CASES;
    const report = evaluatePublishingDraftPromptCases(cases);
    console.log(JSON.stringify(report));
    if (
      report.provider_call_count > 0 ||
      report.fixture_schema_failures > 0 ||
      report.runtime_prompt_path_failures > 0 ||
      report.required_task_path_count < 4
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(JSON.stringify(failureReport(error)));
    process.exitCode =
      error instanceof PublishingDraftPromptCorpusError ? 2 : 1;
  }
}

main();
