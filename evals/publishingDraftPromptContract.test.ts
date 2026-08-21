import { describe, expect, it } from "vitest";

import {
  PUBLISHING_DRAFT_PROMPT_CASES,
  PUBLISHING_DRAFT_PROMPT_TASK_PATHS,
} from "./publishingDraftPromptCases";
import {
  PublishingDraftPromptCorpusError,
  compilePublishingDraftPromptCases,
  evaluateCompiledPublishingDraftPromptCases,
  evaluatePublishingDraftPromptCases,
} from "./publishingDraftPromptContract";

describe("publishing draft prompt corpus", () => {
  it("keeps the approved 4/3/4/1 task-path strata and no local-data references", () => {
    const counts = Object.fromEntries(
      PUBLISHING_DRAFT_PROMPT_TASK_PATHS.map(taskPath => [
        taskPath,
        PUBLISHING_DRAFT_PROMPT_CASES.filter(
          promptCase => promptCase.taskPath === taskPath
        ).length,
      ])
    );

    expect(counts).toEqual({
      initial_generation: 4,
      platform_conversion: 3,
      instructed_revision: 4,
      structural_repair: 1,
    });

    const serialized = JSON.stringify(PUBLISHING_DRAFT_PROMPT_CASES);
    expect(serialized).not.toContain(".webdev");
    expect(serialized).not.toMatch(/1[3-9]\d{9}/);
    expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  });

  it("fails closed for empty, damaged, or incomplete fixtures", () => {
    expect(() => evaluatePublishingDraftPromptCases([])).toThrow(
      PublishingDraftPromptCorpusError
    );

    const missingField = structuredClone(PUBLISHING_DRAFT_PROMPT_CASES);
    delete (missingField[0] as { input?: unknown }).input;
    expect(() => evaluatePublishingDraftPromptCases(missingField)).toThrow(
      /input/
    );

    const damagedField = structuredClone(PUBLISHING_DRAFT_PROMPT_CASES);
    const first = damagedField[0];
    if (first.input.kind === "generate") {
      first.input.conversation = [];
    }
    expect(() => evaluatePublishingDraftPromptCases(damagedField)).toThrow(
      /首次生成/
    );
  });
});

describe("publishing draft prompt contract evaluation", () => {
  it("compiles all cases through production prompt builders without provider calls", () => {
    const report = evaluatePublishingDraftPromptCases(
      PUBLISHING_DRAFT_PROMPT_CASES
    );

    expect(report.provider_call_count).toBe(0);
    expect(report.fixture_schema_failures).toBe(0);
    expect(report.runtime_prompt_path_failures).toBe(0);
    expect(report.case_count).toBe(12);
    expect(report.required_task_path_count).toBe(4);
    expect(report.prompt_character_count).toBeGreaterThan(0);
    expect(report.cases).toHaveLength(12);
    expect(
      report.cases
        .filter(
          result =>
            result.id.includes("preserve-manual-title") ||
            result.taskPath === "structural_repair"
        )
        .flatMap(result => result.hardFailures)
    ).not.toContain("preserve_applied_title");
  });

  it("detects an injected regression instead of producing a decorative score", () => {
    const artifacts = compilePublishingDraftPromptCases(
      PUBLISHING_DRAFT_PROMPT_CASES
    );
    const baseline = evaluateCompiledPublishingDraftPromptCases({ artifacts });
    const mutant = artifacts.map(artifact => ({
      ...artifact,
      request: {
        ...artifact.request,
        systemPrompt: artifact.request.systemPrompt.replaceAll("JSON", "结构"),
      },
    }));
    const regressed = evaluateCompiledPublishingDraftPromptCases({
      artifacts: mutant,
    });

    expect(regressed.hard_invariant_failures).toBeGreaterThan(
      baseline.hard_invariant_failures
    );
    expect(
      regressed.cases.every(result =>
        result.hardFailures.includes("strict_json")
      )
    ).toBe(true);
  });
});
