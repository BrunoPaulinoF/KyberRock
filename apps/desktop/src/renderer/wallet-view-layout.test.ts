import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const walletSource = readFileSync(resolve(rendererDir, "WalletView.tsx"), "utf8");

function styleBlock(name: string): string {
  const start = walletSource.indexOf(`  ${name}: {`);
  expect(start, `estilo nao encontrado: ${name}`).toBeGreaterThan(-1);
  const end = walletSource.indexOf("\n  },", start);
  expect(end, `fim do estilo nao encontrado: ${name}`).toBeGreaterThan(-1);
  return walletSource.slice(start, end);
}

/**
 * A lista da Carteira nao pode "sumir" quando a pedreira inteira aparece nela.
 *
 * O container e uma coluna flex (e o que espaca os cards de cliente) com rolagem. Num
 * flex o filho encolhe por padrao: enquanto a tela mostrava so as vendas do proprio
 * computador cabia tudo e ninguem encolhia, mas com a carteira compartilhada entre as
 * balancas os cards passaram a ser espremidos ate virarem faixas vazias — os totais no
 * topo certos e nenhuma venda visivel. Estes testes prendem a decisao que evita isso.
 */
describe("layout da lista da Carteira", () => {
  it("rola o container em vez de espremer os cards de cliente", () => {
    const scroll = styleBlock("scroll");
    expect(scroll).toContain('overflow: "auto"');
    expect(scroll).toContain('flexDirection: "column"');
    // Sem minHeight: 0 o proprio container cresce e a rolagem vai parar na janela.
    expect(scroll).toContain("minHeight: 0");

    // A regra que faltava: cada card mantem a altura do seu conteudo.
    expect(styleBlock("groupCard")).toContain("flexShrink: 0");
  });

  it("lista todas as vendas de cada cliente, sem corte", () => {
    // O card so encolhia porque havia conteudo demais — a correcao e rolar, nunca
    // limitar o que a tela mostra.
    expect(walletSource).toContain("group.operations.map((operation) => (");
    expect(walletSource).not.toMatch(/group\.operations\.slice\(/);
  });
});
