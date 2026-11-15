import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatCompanionStatus } from "./ChatCompanionStatus";

describe("chat processing acknowledgement", () => {
  it("pins processing above background context without adding controls", () => {
    const html = renderToStaticMarkup(<ChatCompanionStatus messages={["Background render", "Current shot"]} priority="Received, processing · You can keep typing" />);
    expect(html).toContain("Received, processing · You can keep typing");
    expect(html).not.toContain("Current shot");
    expect(html).not.toContain("Background render");
    expect(html).not.toContain("<button");
    expect(html).toContain('role="status"');
  });
  it("restores the normal context when processing finishes", () => {
    const html = renderToStaticMarkup(<ChatCompanionStatus messages={["Current shot"]} />);
    expect(html).toContain("Current shot");
    expect(html).not.toContain("Received, processing");
  });
});
