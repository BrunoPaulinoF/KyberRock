import { describe, expect, it } from "vitest";
import {
  INTERNET_FAILURES_TO_GO_OFFLINE,
  forcedOfflineState,
  initialInternetState,
  nextInternetState
} from "./internet-status";

describe("nextInternetState", () => {
  it("comeca online quando a placa de rede esta ligada, offline quando nao", () => {
    expect(initialInternetState(true).online).toBe(true);
    expect(initialInternetState(false).online).toBe(false);
  });

  it("um teste falho sozinho nao trava a balanca", () => {
    const state = nextInternetState(initialInternetState(true), false);
    expect(state.online).toBe(true);
  });

  it("trava depois das falhas seguidas", () => {
    let state = initialInternetState(true);
    for (let i = 0; i < INTERNET_FAILURES_TO_GO_OFFLINE; i += 1) {
      state = nextInternetState(state, false);
    }
    expect(state.online).toBe(false);
  });

  it("um teste bom libera na hora", () => {
    const state = nextInternetState(forcedOfflineState(), true);
    expect(state).toEqual({ online: true, failures: 0 });
  });

  it("falha depois de uma recuperacao conta do zero", () => {
    let state = nextInternetState(initialInternetState(true), false);
    state = nextInternetState(state, true);
    state = nextInternetState(state, false);
    expect(state.online).toBe(true);
  });

  it("aviso da placa de rede trava na hora", () => {
    expect(forcedOfflineState().online).toBe(false);
    expect(nextInternetState(forcedOfflineState(), false).online).toBe(false);
  });
});
