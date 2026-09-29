import {
  Ban,
  ClipboardList,
  Moon,
  Package,
  Pencil,
  Plus,
  Printer,
  Sun,
  Truck,
  Users
} from "lucide-react";
import { useState } from "react";

import { DeskPanel, IconAction, PlateBadge, SearchBar, SectionHead } from "../components/desk";
import {
  ActionMenu,
  Alert,
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  HelpTip,
  Modal,
  PageHeader,
  PageSkeleton,
  Pill,
  Skeleton,
  SkeletonRows,
  Tabs,
  useConfirm,
  useDiscardGuard,
  useToast
} from "../components/ui";
import { maskCep, maskDocument, maskPhone, maskPlate } from "../lib/masks";
import { useTheme } from "../lib/theme";

/**
 * Vitrine do kit de pecas (`/kit`, so no `npm run dev`). Mostra cada peca de `components/ui.tsx`
 * e `components/desk.tsx` como ela aparece nas telas, para quem desenvolve copiar certo e para
 * conferir os dois temas de uma vez. Nao le a nuvem: tudo aqui e exemplo.
 */

const SAMPLE_ROWS = [
  { id: "1", plate: "RKX2B47", customer: "Construtora Serra Azul", product: "Brita 1", tons: 18.4 },
  { id: "2", plate: "QPD7F12", customer: "Areial Ribeirão", product: "Pó de pedra", tons: 21.1 },
  { id: "3", plate: "MTA4C90", customer: "Prefeitura de Ibiúna", product: "Pedrisco", tons: 12.7 }
];

type Tab = "abertas" | "canceladas" | "concluidas";

export function KitShowcase() {
  const toast = useToast();
  const confirm = useConfirm();
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>("abertas");
  const [section, setSection] = useState("clientes");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [plate, setPlate] = useState("");
  const [doc, setDoc] = useState("");
  const [phone, setPhone] = useState("");
  const [cep, setCep] = useState("");
  const [note, setNote] = useState("");
  const guard = useDiscardGuard(note !== "");

  return (
    <main className="kit">
      <DeskPanel>
        <PageHeader
          kicker="Kit de peças"
          title="Vitrine do KyberRock Web"
          help="Cada peça desta página é a mesma usada nas telas. Tela nova usa estas peças em vez de criar outra parecida."
          meta={<Pill tone="info">Só em desenvolvimento</Pill>}
          description="Topo de tela, abas, etiquetas, listas, avisos, janelas e carregamento — um jeito só de fazer cada coisa."
          actions={
            <button type="button" className="btn" onClick={toggle}>
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
              {theme === "light" ? "Tema escuro" : "Tema claro"}
            </button>
          }
        />

        <SectionHead title="Abas" description="Sublinhadas para seções; redondas para filtros." />
        <Tabs
          label="Seções de exemplo"
          active={section}
          onChange={setSection}
          tabs={[
            { id: "clientes", label: "Clientes", icon: Users },
            { id: "produtos", label: "Produtos", icon: Package },
            { id: "transporte", label: "Transporte", icon: Truck, count: 12 },
            { id: "bloqueada", label: "Bloqueada", icon: ClipboardList, disabled: true }
          ]}
        />
        <div className="kit-row">
          <Tabs<Tab>
            label="Filtro de exemplo"
            variant="pill"
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "abertas", label: "Abertas", count: 3 },
              { id: "canceladas", label: "Canceladas", count: 0 },
              { id: "concluidas", label: "Concluídas", count: 128 }
            ]}
          />
        </div>

        <SectionHead title="Etiquetas e botões" />
        <div className="kit-row">
          <Pill>Neutra</Pill>
          <Pill tone="success">OMIE</Pill>
          <Pill tone="warning">Enviando ao OMIE</Pill>
          <Pill tone="danger">Recusada</Pill>
          <Pill tone="info">LOCAL</Pill>
          <Badge kind="ok">Badge = Pill</Badge>
          <PlateBadge plate="RKX-2B47" />
        </div>
        <div className="kit-row">
          <button type="button" className="btn primary">
            <Plus size={16} />
            Principal
          </button>
          <button type="button" className="btn">
            Comum
          </button>
          <button type="button" className="btn danger">
            Perigo
          </button>
          <button type="button" className="btn ghost-danger">
            Perigo leve
          </button>
          <button type="button" className="btn small">
            Pequeno
          </button>
          <button type="button" className="btn link">
            Link
          </button>
          <button type="button" className="btn" disabled>
            Desligado
          </button>
          <IconAction icon="edit" label="Alterar" onClick={() => undefined} />
          <IconAction icon="check" label="Fechar" tone="primary" onClick={() => undefined} />
          <IconAction icon="trash" label="Excluir" tone="danger" onClick={() => undefined} />
          <HelpTip text="Ajuda que abre no mouse, no teclado e no toque do celular." />
        </div>

        <SectionHead title="Mensagens e confirmação" />
        <div className="kit-row">
          <button type="button" className="btn" onClick={() => toast.push("Cliente salvo.")}>
            Sucesso
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => toast.push("Pedido enviado; a balança registra em instantes.", "info")}
          >
            Informação
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => toast.push("Cliente salvo, mas o OMIE não respondeu.", "warn")}
          >
            Aviso
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => toast.push("A web-api recusou: preço fora da tabela.", "error")}
          >
            Erro (fica até fechar)
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              toast.push("Carga concluída.", "ok", {
                action: { label: "Desfazer", onClick: () => toast.push("Carga reaberta.") }
              })
            }
          >
            Com “Desfazer”
          </button>
          <button
            type="button"
            className="btn ghost-danger"
            onClick={async () => {
              const ok = await confirm({
                title: "Remover destinatário?",
                message: "O relatório diário deixa de ser enviado para este e-mail.",
                confirmLabel: "Remover",
                tone: "danger",
                irreversible: true
              });
              toast.push(ok ? "Removido." : "Nada foi removido.", ok ? "ok" : "info");
            }}
          >
            Confirmação
          </button>
          <button type="button" className="btn" onClick={() => setModal(true)}>
            Janela
          </button>
        </div>
        <div className="kit-stack">
          <Alert kind="info">Informação: a balança executora registra os pedidos do site.</Alert>
          <Alert kind="warn">Aviso: cadastro salvo, mas falta a inscrição estadual.</Alert>
          <Alert kind="error">Erro: sem conexão com a nuvem.</Alert>
          <ErrorState
            message="Falha ao carregar os clientes."
            onRetry={() => toast.push("Tentando de novo...", "info")}
          />
        </div>

        <SectionHead title="Campos" />
        <div className="grid-2">
          <Field label="Placa" hint="Com ou sem traço.">
            <input
              className="input"
              value={plate}
              onChange={(e) => setPlate(maskPlate(e.target.value))}
            />
          </Field>
          <Field label="CNPJ/CPF" hint="Aceita CNPJ com letras.">
            <input
              className="input"
              value={doc}
              onChange={(e) => setDoc(maskDocument(e.target.value))}
            />
          </Field>
          <Field label="Telefone">
            <input
              className="input"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
            />
          </Field>
          <Field label="CEP" hint="Completo, preenche o endereço.">
            <input
              className="input"
              inputMode="numeric"
              value={cep}
              onChange={(e) => setCep(maskCep(e.target.value))}
            />
          </Field>
          <Field label="E-mail do destinatário">
            <input className="input" type="email" required />
          </Field>
          <Field label="CNPJ" error="CNPJ inválido: confira os dois últimos dígitos.">
            <input className="input" defaultValue="12.ABC.345/01DE-00" />
          </Field>
          <Field label="Forma de pagamento">
            <select className="select" defaultValue="pix">
              <option value="pix">Pix</option>
              <option value="boleto">Boleto</option>
            </select>
          </Field>
        </div>

        <SectionHead title="Lista" count={SAMPLE_ROWS.length} />
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Buscar placa ou cliente..."
          onRefresh={() => undefined}
        />
        <DataTable
          rows={SAMPLE_ROWS.filter((row) =>
            `${row.plate} ${row.customer}`.toLowerCase().includes(search.toLowerCase())
          )}
          rowKey={(row) => row.id}
          empty="Nenhuma pesagem encontrada."
          emptyHint="Tente outra placa ou limpe a busca."
          columns={[
            {
              key: "plate",
              header: "Placa",
              sortValue: (row) => row.plate,
              render: (row) => <PlateBadge plate={row.plate} />
            },
            {
              key: "customer",
              header: "Cliente",
              sortValue: (row) => row.customer,
              render: (row) => row.customer
            },
            {
              key: "product",
              header: "Produto",
              sortValue: (row) => row.product,
              render: (row) => row.product
            },
            {
              key: "tons",
              header: "Toneladas",
              numeric: true,
              sortValue: (row) => row.tons,
              render: (row) => row.tons.toLocaleString("pt-BR")
            },
            {
              key: "acoes",
              header: "",
              render: (row) => (
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn small primary"
                    onClick={() => toast.push(`Fechar ${row.plate}`, "info")}
                  >
                    Fechar
                  </button>
                  <ActionMenu
                    actions={[
                      { label: "Alterar pesagem", icon: Pencil, onClick: () => undefined },
                      { label: "Reimprimir cupom", icon: Printer, onClick: () => undefined },
                      {
                        label: "Cancelar venda",
                        icon: Ban,
                        tone: "danger",
                        onClick: () => undefined
                      }
                    ]}
                  />
                </div>
              )
            }
          ]}
        />

        <SectionHead title="Lista vazia e carregando" />
        <div className="kit-grid">
          <EmptyState
            title="Nenhuma carga aguardando"
            hint="Quando uma operação entrar na fila, ela aparece aqui."
          />
          <div className="kit-stack">
            <Skeleton width="60%" height={14} />
            <Skeleton width="90%" />
            <Skeleton width="75%" />
          </div>
        </div>
        <DataTable
          loading
          rows={[] as typeof SAMPLE_ROWS}
          rowKey={(row) => row.id}
          columns={[
            { key: "a", header: "Placa", render: () => null },
            { key: "b", header: "Cliente", render: () => null },
            { key: "c", header: "Produto", render: () => null },
            { key: "d", header: "Toneladas", render: () => null }
          ]}
        />
        <SkeletonRows rows={2} columns={3} />
      </DeskPanel>

      <div className="kit-page-skeleton">
        <PageSkeleton />
      </div>

      {modal && (
        <Modal
          title="Alterar pesagem"
          description="A balança executora registra a alteração."
          onClose={() => {
            setModal(false);
            setNote("");
          }}
          dirty={note !== ""}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void guard(() => {
                    setModal(false);
                    setNote("");
                  })
                }
              >
                Cancelar
              </button>
              <button type="button" className="btn primary" onClick={() => setModal(false)}>
                Salvar
              </button>
            </>
          }
        >
          <Field label="Produto">
            <input className="input" defaultValue="Brita 1" required />
          </Field>
          <Field label="Observação" hint="Digite algo e tente fechar: o site pergunta antes.">
            <textarea
              className="textarea"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </Modal>
      )}
    </main>
  );
}
