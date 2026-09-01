import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  isAuthenticated: true,
  loading: false,
  user: { id: 7, role: "user" },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => auth,
}));
vi.mock("@/pages/CreationPage", () => ({ default: () => "creation" }));
vi.mock("@/pages/EditingStudioPage", () => ({
  default: () => "desktop-editing",
}));
vi.mock("@/pages/LoginPage", () => ({ default: () => "login" }));
vi.mock("@/pages/MobileWorkspacePage", () => ({
  default: () => "mobile-workspace",
}));
vi.mock("@/pages/WelcomePreviewPage", () => ({ default: () => "welcome" }));
vi.mock("@/pages/NotFound", () => ({ default: () => "not-found" }));
vi.mock("@/pages/AdminInvitesPage", () => ({ default: () => "invites" }));
vi.mock("@/pages/AdminVisitsPage", () => ({ default: () => "visits" }));

import AppRouter from "./AppRouter";
import {
  mobileLoginHref,
  readMobileReturnPath,
  resolvePostLoginDestination,
} from "@/features/auth/mobileReturnPath";
import {
  resolveRootWorkspacePath,
  rootWorkspacePath,
} from "@/features/mobileWorkspace/mobileWorkspaceEntry";

type RouterResult = {
  html: string;
  redirectTo?: string;
};

function renderRoute(path: string): RouterResult {
  const ssrContext: { redirectTo?: string } = {};
  const html = renderToStaticMarkup(
    <Router ssrPath={path} ssrContext={ssrContext}>
      <AppRouter />
    </Router>
  );
  return { html, redirectTo: ssrContext.redirectTo };
}

function stubBrowser({
  userAgent,
  userAgentDataMobile,
  viewportWidth,
  coarsePointer,
  maxTouchPoints = 0,
  search = "",
  hasMatchMedia = true,
}: {
  userAgent: string;
  userAgentDataMobile?: boolean;
  viewportWidth: number;
  coarsePointer: boolean;
  maxTouchPoints?: number;
  search?: string;
  hasMatchMedia?: boolean;
}) {
  vi.stubGlobal("navigator", {
    userAgent,
    maxTouchPoints,
    ...(typeof userAgentDataMobile === "boolean"
      ? { userAgentData: { mobile: userAgentDataMobile } }
      : {}),
  });
  vi.stubGlobal("window", {
    innerWidth: viewportWidth,
    location: { search },
    ...(hasMatchMedia
      ? {
          matchMedia: () => ({ matches: coarsePointer }),
        }
      : {}),
  });
}

beforeEach(() => {
  auth.isAuthenticated = true;
  auth.loading = false;
  auth.user = { id: 7, role: "user" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("root workspace entry", () => {
  it("sends phone browsers from the original URL to the mobile workspace", () => {
    expect(
      resolveRootWorkspacePath({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        viewportWidth: 390,
        coarsePointer: true,
      })
    ).toBe("/m");
    expect(
      resolveRootWorkspacePath({
        userAgent: "reduced-agent",
        userAgentDataMobile: true,
        viewportWidth: 412,
        coarsePointer: true,
      })
    ).toBe("/m");
  });

  it("uses narrow touch signals only when user-agent data is unavailable", () => {
    expect(
      resolveRootWorkspacePath({
        userAgent: "reduced-agent",
        viewportWidth: 430,
        coarsePointer: true,
      })
    ).toBe("/m");
    expect(
      resolveRootWorkspacePath({
        userAgent: "reduced-agent",
        userAgentDataMobile: false,
        viewportWidth: 430,
        coarsePointer: true,
      })
    ).toBe("/editing");
  });

  it("reads real browser signals and falls back to maxTouchPoints", () => {
    stubBrowser({
      userAgent: "reduced-agent",
      viewportWidth: 390,
      coarsePointer: false,
      maxTouchPoints: 5,
      hasMatchMedia: false,
    });

    expect(rootWorkspacePath()).toBe("/m");
  });

  it("routes the mounted original URL by device while preserving deep links", () => {
    stubBrowser({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148",
      viewportWidth: 390,
      coarsePointer: true,
    });
    expect(renderRoute("/").redirectTo).toBe("/m");

    stubBrowser({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      userAgentDataMobile: false,
      viewportWidth: 390,
      coarsePointer: true,
    });
    expect(renderRoute("/").redirectTo).toBe("/editing");
    expect(renderRoute("/editing")).toMatchObject({
      html: "desktop-editing",
      redirectTo: undefined,
    });
  });
});

describe("mobile route and login return", () => {
  it("builds one canonical protected mobile return", () => {
    expect(mobileLoginHref("/m")).toBe("/login?returnTo=%2Fm");
    expect(readMobileReturnPath("?returnTo=%2Fm")).toBe("/m");
    expect(resolvePostLoginDestination("/m")).toBe("/m");
    expect(resolvePostLoginDestination(null)).toBe("/editing");
  });

  it("rejects open redirects and encoded normalization bypasses", () => {
    const unsafeSearches = [
      "?returnTo=https%3A%2F%2Fevil.example",
      "?returnTo=%2F%2Fevil.example",
      "?returnTo=%5C%5Cevil.example",
      "?returnTo=%252Fm",
      "?returnTo=%2Fm%252f..%252fadmin",
      "?returnTo=%2Fm%2F..%2Fadmin",
      "?returnTo=%2Fadmin%2Fusers",
      "?returnTo=%2Fm%2F",
      "?returnTo=%2Fm&returnTo=%2Fadmin",
      "?returnTo=%00%2Fm",
    ];

    for (const search of unsafeSearches) {
      expect(readMobileReturnPath(search), search).toBeNull();
    }
  });

  it("mounts the canonical mobile route before its legacy redirect", () => {
    expect(renderRoute("/m")).toMatchObject({
      html: "mobile-workspace",
      redirectTo: undefined,
    });
    expect(renderRoute("/m/legacy").redirectTo).toBe("/m");
  });

  it("keeps the mobile login return through the mounted auth guards", () => {
    auth.isAuthenticated = false;
    expect(renderRoute("/m").redirectTo).toBe("/login?returnTo=%2Fm");

    auth.isAuthenticated = true;
    stubBrowser({
      userAgent: "mobile",
      viewportWidth: 390,
      coarsePointer: true,
      search: "?returnTo=%2Fm",
    });
    expect(renderRoute("/login").redirectTo).toBe("/m");
  });
});
