import { describe, expect, it } from "vitest";

import { bankAccountOptions, MAX_BANK_MOVEMENT_ACCOUNTS, toggleBankAccount } from "./bank-accounts";

const itau = { code: 11455922417, name: "Itaú Unibanco" };
const santander = { code: 11455922450, name: "Santander" };
const caixinha = { code: 11455896303, name: "Caixinha" };

const loaded = [
  { ...caixinha, type: "CX", inactive: false },
  { ...itau, type: "CC", inactive: false },
  { ...santander, type: "CC", inactive: false },
  { code: 11455922454, name: "Sicoob", type: "CC", inactive: true }
];

describe("bankAccountOptions", () => {
  it("antes de buscar no OMIE mostra so o que ja esta escolhido", () => {
    expect(bankAccountOptions([santander], null)).toEqual([{ ...santander, note: null }]);
  });

  it("depois de buscar lista as contas do OMIE e marca a inativa", () => {
    const options = bankAccountOptions([], loaded);
    expect(options.map((option) => option.name)).toEqual([
      "Caixinha",
      "Itaú Unibanco",
      "Santander",
      "Sicoob"
    ]);
    expect(options[3]?.note).toBe("inativa no OMIE");
  });

  it("mantem no fim a conta escolhida que o OMIE nao devolveu mais", () => {
    const gone = { code: 99, name: "Conta encerrada" };
    expect(bankAccountOptions([gone], loaded).at(-1)).toEqual({
      ...gone,
      note: "não encontrada no OMIE"
    });
  });
});

describe("toggleBankAccount", () => {
  const options = bankAccountOptions([], loaded);

  it("marca na ordem das opcoes, nao na ordem do clique", () => {
    const afterSantander = toggleBankAccount([], options, santander);
    expect(toggleBankAccount(afterSantander, options, caixinha)).toEqual([caixinha, santander]);
  });

  it("desmarca a conta ja escolhida", () => {
    expect(toggleBankAccount([itau, santander], options, itau)).toEqual([santander]);
  });

  it("nao passa do teto", () => {
    const full = Array.from({ length: MAX_BANK_MOVEMENT_ACCOUNTS }, (_, i) => ({
      code: i + 1,
      name: `Conta ${i + 1}`
    }));
    expect(toggleBankAccount(full, options, itau)).toEqual(full);
  });
});
