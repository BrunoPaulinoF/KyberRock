import { describe, expect, it } from "vitest";

import {
  DEVICE_COLOR_PALETTE as sharedPalette,
  pickNextDeviceColor as sharedPick
} from "../../../packages/shared/src/device-colors";
import { DEVICE_COLOR_PALETTE, pickNextDeviceColor } from "./device-colors";

describe("device-colors (copia Deno)", () => {
  it("mantem a paleta identica a packages/shared (invariante documentada nos dois arquivos)", () => {
    expect(DEVICE_COLOR_PALETTE).toEqual(sharedPalette);
  });

  it("atribui cores na mesma ordem que o desktop", () => {
    expect(pickNextDeviceColor([])).toBe(sharedPick([]));
    const used = [DEVICE_COLOR_PALETTE[0], DEVICE_COLOR_PALETTE[1]];
    expect(pickNextDeviceColor(used)).toBe(sharedPick(used));
    expect(pickNextDeviceColor([...DEVICE_COLOR_PALETTE])).toBe(
      sharedPick([...DEVICE_COLOR_PALETTE])
    );
  });
});
