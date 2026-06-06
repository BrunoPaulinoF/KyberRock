import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("creates the loader web component tree", () => {
    expect(App()).toBeTruthy();
  });
});
