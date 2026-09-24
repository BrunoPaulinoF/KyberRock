import {
  Building2,
  Car,
  CreditCard,
  Package,
  Truck,
  User,
  Users,
  type LucideIcon
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { DeskPanel, IconTabs, SectionHead } from "../components/desk";
import { Alert, DataTable } from "../components/ui";
import { useUser } from "../lib/auth";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import { CarriersSection, DriversSection, VehiclesSection } from "./Cadastros";
import { CustomersSection } from "./Customers";
import { ProductsSection } from "./Products";

/**
 * A tela Cadastros do desktop: um cartao so, com as abas por icone Clientes, Produtos,
 * Pagamento e Transporte — e dentro de Transporte, Motoristas, Transportadoras e Placas. A aba
 * fica no endereco (`/cadastros/transporte/placas`) para o link levar direto a ela.
 */

type Tab = "clientes" | "produtos" | "pagamento" | "transporte";
type TransportTab = "motoristas" | "transportadoras" | "placas";

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "produtos", label: "Produtos", icon: Package },
  { id: "pagamento", label: "Pagamento", icon: CreditCard },
  { id: "transporte", label: "Transporte", icon: Truck }
];

const TRANSPORT_TABS: Array<{ id: TransportTab; label: string; icon: LucideIcon }> = [
  { id: "motoristas", label: "Motoristas", icon: User },
  { id: "transportadoras", label: "Transportadoras", icon: Building2 },
  { id: "placas", label: "Placas", icon: Car }
];

function isTab(value: string | undefined): value is Tab {
  return TABS.some((tab) => tab.id === value);
}

function isTransportTab(value: string | undefined): value is TransportTab {
  return TRANSPORT_TABS.some((tab) => tab.id === value);
}

export function Registrations() {
  const params = useParams();
  const navigate = useNavigate();
  const tab: Tab = isTab(params.tab) ? params.tab : "clientes";
  const sub: TransportTab = isTransportTab(params.sub) ? params.sub : "motoristas";

  return (
    <DeskPanel>
      <h1 className="desk-title">Cadastros</h1>
      <IconTabs
        label="Cadastros"
        tabs={TABS}
        active={tab}
        onChange={(next) => navigate(`/cadastros/${next}`)}
      />
      <p className="desk-muted">
        Cadastros: clientes, produtos, condicoes de pagamento e transporte.
      </p>
      {tab === "clientes" && <CustomersSection />}
      {tab === "produtos" && <ProductsSection />}
      {tab === "pagamento" && <PaymentSection />}
      {tab === "transporte" && (
        <>
          <IconTabs
            label="Transporte"
            tabs={TRANSPORT_TABS}
            active={sub}
            onChange={(next) => navigate(`/cadastros/transporte/${next}`)}
          />
          {sub === "motoristas" && <DriversSection />}
          {sub === "transportadoras" && <CarriersSection />}
          {sub === "placas" && <VehiclesSection />}
        </>
      )}
    </DeskPanel>
  );
}

/**
 * Aba Pagamento: formas, contas e condicoes. So consulta — o cadastro delas vem do OMIE e e
 * ajustado na balanca principal (`PaymentRegistrationsView` do desktop).
 */
function PaymentSection() {
  const user = useUser();
  const { data, loading, error } = useAsync(
    () =>
      Promise.all([
        q.paymentMethods(user.companyId),
        q.accounts(user.companyId),
        q.paymentTerms(user.companyId)
      ]),
    [user.companyId]
  );
  const [methods, accounts, terms] = data ?? [[], [], []];
  const status = (active: boolean) => (active ? "Ativa" : "Inativa");

  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}
      <SectionHead
        title="Formas de pagamento"
        count={methods.length}
        description="As formas vem do OMIE na sincronizacao (nome e codigo). Ativar, apelidar e vincular a conta e feito na balanca principal."
      />
      <DataTable
        rows={methods}
        rowKey={(row) => row.id}
        rowClassName={(row) => (row.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhuma forma de pagamento."}
        columns={[
          {
            key: "name",
            header: "Forma",
            render: (row) => (
              <>
                <strong>{row.alias || row.name}</strong>
                <span className="cell-sub">
                  {row.is_wallet
                    ? "Em carteira | recebimento definido no fechamento"
                    : row.is_customer_credit
                      ? "Credito do cliente"
                      : row.alias
                        ? row.name
                        : "-"}
                </span>
              </>
            )
          },
          { key: "omie", header: "Cod. OMIE", render: (row) => row.omie_code || "-" },
          { key: "status", header: "Status", render: (row) => status(row.is_active) }
        ]}
      />
      <SectionHead
        title="Contas"
        count={accounts.length}
        description="As contas correntes vem do OMIE na sincronizacao (nome e codigo)."
      />
      <DataTable
        rows={accounts}
        rowKey={(row) => row.id}
        rowClassName={(row) => (row.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhuma conta."}
        columns={[
          { key: "name", header: "Conta", render: (row) => <strong>{row.name}</strong> },
          { key: "omie", header: "Cod. OMIE", render: (row) => row.omie_code || "-" },
          { key: "status", header: "Status", render: (row) => status(row.is_active) }
        ]}
      />
      <SectionHead
        title="Condicoes de pagamento"
        count={terms.length}
        description="Cadastradas no padrao de parcelas do OMIE: 10/20/30/40, A Vista/40/60, Para 93 dias, 50 Parcelas ou periodo (s+20, d+20, q+20, m+20)."
      />
      <DataTable
        rows={terms}
        rowKey={(row) => row.id}
        empty={loading ? "Carregando..." : "Nenhuma condicao."}
        columns={[
          { key: "name", header: "Condicao", render: (row) => <strong>{row.name}</strong> },
          { key: "omie", header: "Cod. OMIE", render: (row) => row.omie_code || "-" },
          { key: "status", header: "Status", render: (row) => status(row.is_active) }
        ]}
      />
    </>
  );
}
