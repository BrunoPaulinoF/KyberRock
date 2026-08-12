import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AdminShell,
  Badge,
  Button,
  ButtonGroup,
  ConfirmDialog,
  DataTable,
  Field,
  Fieldset,
  Modal,
  Note,
  PageHead,
  Panel,
  Stat,
  StatGrid
} from "./index";

interface Row {
  id: string;
  name: string;
  amount: number;
}

const ROWS: Row[] = [
  { id: "a", name: "Pedreira Serra Azul", amount: 90_000 },
  { id: "b", name: "Pedreira Morro Alto", amount: 120_000 }
];

describe("primitivos do console", () => {
  it("renderiza a casca com a secao ativa marcada", () => {
    const html = renderToStaticMarkup(
      <AdminShell
        sections={[
          { id: "companies", label: "Pedreiras", group: "Cadastros", count: 2 },
          { id: "financeiro", label: "Financeiro", group: "Plataforma" }
        ]}
        activeSection="financeiro"
        onSelectSection={() => {}}
        environmentLabel="vksihzfrgqoemcqpquit"
        headerActions={<Button size="sm">Sair</Button>}
      >
        <PageHead title="Financeiro" description="Mensalidade da plataforma" />
      </AdminShell>
    );

    expect(html).toContain("KyberRock Console");
    expect(html).toContain("vksihzfrgqoemcqpquit");
    expect(html).toContain('aria-current="page"');
    // O selo do grupo e a contagem tem que sair juntos com o item da trilha.
    expect(html).toContain("Cadastros");
    expect(html).toContain("adm-nav-count");
  });

  it("renderiza a tabela com alinhamento numerico e classe de linha", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[
          { key: "name", header: "Pedreira", render: (row: Row) => row.name },
          { key: "amount", header: "Valor", numeric: true, render: (row: Row) => row.amount },
          {
            key: "actions",
            header: "",
            actions: true,
            render: () => (
              <ButtonGroup>
                <Button size="sm">Editar</Button>
              </ButtonGroup>
            )
          }
        ]}
        rows={ROWS}
        rowKey={(row) => row.id}
        rowClassName={(row) => (row.id === "b" ? "adm-row-alert" : undefined)}
        empty="vazio"
      />
    );

    expect(html).toContain("Pedreira Serra Azul");
    expect(html).toContain("adm-num");
    expect(html).toContain("adm-actions-cell");
    expect(html).toContain("adm-row-alert");
  });

  it("mostra o texto de vazio no lugar de uma tabela sem linhas", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[{ key: "name", header: "Pedreira", render: (row: Row) => row.name }]}
        rows={[]}
        rowKey={(row) => row.id}
        empty="Nenhuma pedreira cadastrada."
      />
    );
    expect(html).toContain("Nenhuma pedreira cadastrada.");
    expect(html).not.toContain("<table");
  });

  it("renderiza painel, indicadores, selos, avisos e campos", () => {
    const html = renderToStaticMarkup(
      <Panel
        title="Faturas"
        description="Cobranca da plataforma"
        actions={<Button variant="primary">Rodar cobranca</Button>}
        toolbar={<input className="adm-input" aria-label="Buscar" />}
        footer={<span>4 fatura(s)</span>}
      >
        <StatGrid>
          <Stat label="Em aberto" value="R$ 900,00" hint="1 fatura" tone="accent" />
        </StatGrid>
        <Badge tone="danger" dot>
          Vencida
        </Badge>
        <Note tone="warn">Cadastro incompleto</Note>
        <Fieldset legend="Contrato">
          <Field label="Valor acertado" hint="Negociado caso a caso">
            <input className="adm-input" />
          </Field>
          <Field label="Vencimento" error="Data invalida">
            <input className="adm-input" />
          </Field>
        </Fieldset>
      </Panel>
    );

    expect(html).toContain("Faturas");
    expect(html).toContain("adm-panel-foot");
    expect(html).toContain("adm-stat-accent");
    expect(html).toContain("adm-badge-danger");
    expect(html).toContain("adm-note-warn");
    // Erro substitui a dica: mostrar os dois ao mesmo tempo confunde.
    expect(html).toContain("Data invalida");
    expect(html).toContain("Negociado caso a caso");
  });

  it("renderiza modal e confirmacao destrutiva", () => {
    const modal = renderToStaticMarkup(
      <Modal title="Ajustar fatura" description="Referencia 08/2026" onClose={() => {}}>
        <p>corpo</p>
      </Modal>
    );
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("Ajustar fatura");

    const confirm = renderToStaticMarkup(
      <ConfirmDialog
        title="Excluir fatura"
        message="A fatura some do historico."
        confirmLabel="Excluir"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(confirm).toContain("A fatura some do historico.");
    expect(confirm).toContain("nao pode ser desfeita");
  });
});
