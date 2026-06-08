import { describe, expect, it } from "vitest";

import { getLoaderWebCapabilities, loaderWebAppInfo } from "./app-info";

describe("loaderWebAppInfo", () => {
  it("targets Docker on EasyPanel", () => {
    expect(loaderWebAppInfo.deploymentTarget).toBe("docker-easypanel");
  });
});

describe("getLoaderWebCapabilities", () => {
  it("is read-only for loading requests", () => {
    expect(getLoaderWebCapabilities()).toContain("supabase-rls-read-only");
  });
});
