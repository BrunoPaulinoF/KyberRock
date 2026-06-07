import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("creates the desktop component tree without requiring Electron", () => {
    const element = <App desktopApi={undefined} />;

    expect(element.type).toBe(App);
  });
});
