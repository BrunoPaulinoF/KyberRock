import { describe, expect, it } from "vitest";

import { describeOmieFault } from "./omie-fault-guide";

const base = {
  customerName: "TAKEO ADEMAR NAKATI",
  customerDocument: "03848820803",
  isOnline: true
};

function guideFor(message: string | null, extra: Partial<typeof base> = {}) {
  return describeOmieFault({ ...base, ...extra, message });
}

describe("describeOmieFault", () => {
  it("UF faltando no OMIE: manda corrigir NO OMIE, mesmo com a recusa vindo como HTTP 500", () => {
    // Mensagem real de 05/11/2026 (Pedreira Ibiuna).
    const guide = guideFor(
      "OMIE HTTP 500 em IncluirPedido (/produtos/pedido/) - ERROR: Cliente sem a informação da UF no cadastro! - tag: [codigo_cliente] (HTTP 400)"
    );
    expect(guide?.id).toBe("customer_state");
    expect(guide?.place).toBe("omie");
    expect(guide?.where).toContain("OMIE");
    expect(guide?.steps.join(" ")).toContain("TAKEO ADEMAR NAKATI (038.488.208-03)");
    expect(guide?.steps.join(" ")).toContain("Endereco");
  });

  it("tag [estado] do cadastro tambem e o caso da UF", () => {
    expect(guideFor("ERROR: O preenchimento da tag [estado] é obrigatório!")?.id).toBe(
      "customer_state"
    );
  });

  it("UF da placa e 'insuficiente' nao viram o caso da UF do cliente", () => {
    expect(guideFor("ERROR: Tag [uf_placa] nao faz parte da estrutura")?.id).not.toBe(
      "customer_state"
    );
    expect(guideFor("Cadastro com saldo insuficiente")?.id).not.toBe("customer_state");
  });

  it("cidade nao encontrada vai para a ficha do cliente no OMIE", () => {
    expect(guideFor("ERROR: Cidade não encontrada!")?.id).toBe("customer_city");
  });

  it("CPF/CNPJ faltando se corrige no KyberRock (Editar itens)", () => {
    const guide = guideFor(
      "Cadastro do cliente recusado pelo OMIE (X). Falta preencher: CNPJ/CPF. Detalhe OMIE: ERROR: O preenchimento da tag [cnpj_cpf] é obrigatório!"
    );
    expect(guide?.id).toBe("customer_document");
    expect(guide?.place).toBe("kyberrock");
    expect(guide?.steps[0]).toContain("Editar itens");
  });

  it("e-mail e numero do endereco tem passo proprio", () => {
    expect(guideFor("ERROR: O preenchimento da tag [email] e obrigatorio!")?.id).toBe(
      "customer_email"
    );
    expect(guideFor("Falta Numero do Endereco do cliente.")?.id).toBe("customer_address_number");
  });

  it("recusa generica do cadastro pede para completar o que falta", () => {
    expect(
      guideFor("Cadastro do cliente recusado pelo OMIE (X). Detalhe OMIE: ERROR: algo")?.id
    ).toBe("customer_registration");
  });

  it("codigo do cliente apagado no OMIE: o sistema refaz sozinho", () => {
    expect(
      guideFor(
        "ERROR: Cliente não cadastrado para o Código [11455923765] ! - tag: [codigo_cliente]"
      )?.place
    ).toBe("wait");
    expect(guideFor("Codigo do cliente no OMIE nao existe mais (X).")?.id).toBe(
      "customer_missing_in_omie"
    );
  });

  it("codigo da transportadora e outro conserto", () => {
    expect(
      guideFor("ERROR: Cliente não cadastrado para o Código [777] ! - tag: [codigo_transportadora]")
        ?.id
    ).toBe("carrier");
  });

  it("limite do OMIE e queda de rede: nao precisa fazer nada", () => {
    expect(guideFor("ERROR: Consumo redundante detectado. Aguarde 48 segundos")?.place).toBe(
      "wait"
    );
    expect(guideFor("ERROR: API bloqueada por consumo indevido.")?.id).toBe("omie_rate_limit");
    expect(guideFor("OMIE HTTP 502 em IncluirPedido")?.id).toBe("omie_unavailable");
    expect(guideFor("fetch failed")?.id).toBe("omie_unavailable");
  });

  it("configuracao da integracao e chave de acesso vao para o suporte", () => {
    expect(guideFor("ERROR: - tag: [codigo_conta_corrente]")?.place).toBe("support");
    expect(guideFor("Credencial OMIE invalida")?.id).toBe("omie_credentials");
  });

  it("pedido apagado no OMIE explica que nao reenvia sozinho", () => {
    expect(guideFor("Pedido 123 nao existe mais no OMIE.")?.id).toBe("order_removed_in_omie");
  });

  it("sem internet: o guia e o da internet, seja qual for a mensagem", () => {
    expect(guideFor("ERROR: qualquer coisa", { isOnline: false })?.id).toBe("offline");
    expect(guideFor(null, { isOnline: false })?.id).toBe("offline");
  });

  it("sem recusa (so esperando a vez) nao mostra guia", () => {
    expect(guideFor(null)).toBeNull();
    expect(guideFor("   ")).toBeNull();
    expect(
      guideFor("Cliente cadastrado no OMIE. O fechamento sera reenviado na sincronizacao.")
    ).toBeNull();
  });

  it("mensagem desconhecida ainda diz o que fazer", () => {
    const guide = guideFor("ERROR: algo totalmente novo");
    expect(guide?.id).toBe("unknown");
    expect(guide?.steps.length).toBeGreaterThan(0);
  });
});
