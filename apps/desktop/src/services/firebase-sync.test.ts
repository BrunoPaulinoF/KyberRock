import { describe, expect, it } from "vitest";

import { initializeFirebase, isFirebaseInitialized } from "./firebase-sync";

describe("firebase sync", () => {
  it("initializes firebase without errors", () => {
    expect(() => initializeFirebase()).not.toThrow();
    expect(isFirebaseInitialized()).toBe(true);
  });
});
