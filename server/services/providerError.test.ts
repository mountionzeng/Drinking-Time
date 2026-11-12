import { describe, expect, it } from "vitest";
import { providerErrorFromBody, sanitizeProviderText, shortProviderReason } from "./providerError";

describe("provider error detail", () => {
  it("extracts the upstream reason code from Legnext/悠船 failures", () => {
    const detail = providerErrorFromBody("legnext", {
      code: 400,
      message: "failed to create task: invalid prompt parameter: upstream rejected the prompt parameters (reason: Invalid_Prompt_Parameter)",
    });
    expect(detail.code).toBe("Invalid_Prompt_Parameter");
    expect(shortProviderReason({ ...detail, httpStatus: 400 })).toBe("HTTP 400 · Invalid_Prompt_Parameter");
  });

  it("reads 302 err_code envelopes", () => {
    expect(providerErrorFromBody("302", { error: { err_code: -10003, message: "参数错误" } }, 400)).toEqual({
      provider: "302", httpStatus: 400, code: "-10003", message: "参数错误",
    });
  });

  it("never keeps URLs or credential-looking strings", () => {
    const text = sanitizeProviderText("see https://cdn.example.com/a?sig=abc key sk-abcdefghijklmnopqrstuvwxyz and " + "x".repeat(60));
    expect(text).not.toContain("https://");
    expect(text).not.toContain("sk-abcdefghijklmnop");
    expect(text).not.toContain("x".repeat(60));
  });

  it("drops upstream trace ids", () => {
    expect(sanitizeProviderText("The model is overloaded. tid:private-trace")).toBe("The model is overloaded.");
    expect(sanitizeProviderText("bad request, request_id=abc123")).toBe("bad request,");
  });
});
