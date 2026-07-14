import { useDeferredValue, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  FileText,
  HelpCircle,
  Laptop,
  ListChecks,
  Printer,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Users
} from "lucide-react";
import { MountainOutline } from "./MountainOutline";

interface DocumentationSection {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  icon: LucideIcon;
  steps: string[];
  details: string[];
  keywords: string[];
}

interface DocumentationFaq {
  question: string;
  answer: string;
  keywords: string[];
}

export const documentationSections: DocumentationSection[] = [
  {
    id: "overview",
    title: "Como o KyberRock funciona",
    eyebrow: "Visao geral",
    summary:
      "O sistema controla a operacao da balanca, registra entradas e saidas, imprime cupons, sincroniza com a cloud e envia dados ao OMIE quando configurado.",
    icon: Laptop,
    steps: [
      "Ative o desktop com o codigo da empresa/unidade.",
      "Configure balanca, impressora e cloud no botao de engrenagem do topo.",
      "Cadastre ou sincronize clientes, produtos, veiculos, motoristas, transportadoras e precos.",
      "Registre a entrada do caminhao em Nova entrada.",
      "Acompanhe o carregamento em Operacoes e feche a saida com peso capturado da balanca.",
      "Confira pendencias de sincronizacao no Painel, Insights ou Cloud."
    ],
    details: [
      "O desktop e offline-first: a operacao continua localmente mesmo sem internet e sincroniza depois.",
      "Pesos devem vir da balanca configurada. O sistema nao foi desenhado para lancamento manual de peso.",
      "Cada acao importante deixa rastro de auditoria: entrada, saida, cancelamento, reimpressao e sincronizacao."
    ],
    keywords: ["inicio", "primeiros passos", "desktop", "operacao", "offline", "auditoria"]
  },
  {
    id: "weighing",
    title: "Fluxo de pesagem",
    eyebrow: "Entrada, carregamento e saida",
    summary:
      "Use Nova entrada para abrir a operacao, Operacoes para acompanhar os carregamentos e o fechamento de saida para calcular o peso liquido.",
    icon: Truck,
    steps: [
      "Em Nova entrada, escolha o tipo da operacao: com nota fiscal ou interna.",
      "Selecione placa, cliente, motorista, produto, condicao de pagamento e tabela de preco quando aplicavel.",
      "Defina frete quando houver: por conta do cliente, da pedreira ou de terceiro.",
      "Aguarde o peso estabilizar e capture a entrada.",
      "Depois do carregamento, abra Operacoes, localize a placa e feche a saida.",
      "Confira peso liquido, valores, credito, frete e impressao antes de finalizar."
    ],
    details: [
      "O peso liquido e calculado pela diferenca entre saida e entrada. Saida menor ou igual a entrada deve ser corrigida antes do fechamento.",
      "Se a mesma placa ja estiver em aberto, o sistema alerta para evitar duplicidade.",
      "Cancelamentos exigem motivo e ficam registrados para auditoria."
    ],
    keywords: ["pesagem", "entrada", "saida", "placa", "frete", "peso liquido", "cancelar"]
  },
  {
    id: "scale",
    title: "Integrar balancas",
    eyebrow: "Configuracao de hardware",
    summary:
      "A balanca e configurada em Configuracoes > Balanca. Informe modelo, conexao, porta e regras de estabilidade para capturar pesos automaticamente.",
    icon: Scale,
    steps: [
      "Clique na engrenagem do topo e escolha Balanca.",
      "Selecione o adaptador/modelo disponivel para a sua unidade.",
      "Preencha host/IP, porta, timeout e intervalo de leitura conforme a instalacao da balanca.",
      "Ajuste estabilidade: tempo minimo estavel, variacao maxima, peso minimo e tentativas de reconexao.",
      "Salve a configuracao e teste a leitura antes de operar.",
      "Se precisar simular, use o adaptador virtual somente em ambiente de teste."
    ],
    details: [
      "O modelo Toledo TCP e o primeiro fluxo suportado pela arquitetura atual; novos modelos podem ser adicionados por adaptadores.",
      "Peso instavel normalmente indica oscilacao fisica, cabo/rede ruim, porta errada ou parametro de estabilidade muito sensivel.",
      "Quando a balanca falha, pare a operacao e corrija a conexao antes de capturar pesos."
    ],
    keywords: ["balanca", "toledo", "tcp", "porta", "ip", "host", "estabilidade", "peso"]
  },
  {
    id: "printing",
    title: "Integrar impressoras",
    eyebrow: "Cupons e relatorios",
    summary:
      "Configure impressoras do Windows em Configuracoes > Impressao para emitir cupom termico de 80 mm e relatorios A4.",
    icon: Printer,
    steps: [
      "Instale a impressora no Windows e confirme que ela aparece na lista do sistema.",
      "No KyberRock, clique na engrenagem do topo e escolha Impressao.",
      "Selecione a impressora desejada e crie/ative o perfil do documento.",
      "Use o teste de impressao para validar papel, margem e tamanho.",
      "Ao fechar uma pesagem, imprima o cupom e entregue ao motorista/cliente.",
      "Use reimpressao quando necessario; o cupom fica marcado como segunda via."
    ],
    details: [
      "Falha de impressao nao apaga nem desfaz a operacao fechada.",
      "O cupom mostra dados da pedreira, cliente, produto, pesos, valor, frete, veiculo, motorista e assinatura.",
      "Para relatorios, use os perfis A4 e confira a impressora padrao do Windows."
    ],
    keywords: ["impressora", "impressao", "cupom", "segunda via", "reimpressao", "a4", "80mm"]
  },
  {
    id: "cloud",
    title: "Integrar cloud e OMIE",
    eyebrow: "Sincronizacao",
    summary:
      "A cloud sincroniza operacoes e dados de referencia. O OMIE fica protegido nas Edge Functions e nunca deve ser configurado diretamente no desktop.",
    icon: Cloud,
    steps: [
      "Ative o desktop usando o codigo de 6 digitos da unidade.",
      "Clique na engrenagem do topo e abra Cloud para ver status, fila e sincronizacao.",
      "Use Sincronizar agora quando houver pendencias ou apos voltar a internet.",
      "Para OMIE, cadastre App Key e App Secret no painel administrativo/cloud, nao no computador da balanca.",
      "Aguarde a importacao de clientes, produtos, condicoes, transportadoras e financeiro.",
      "Monitore erros em Cloud, Insights e Logs do topo."
    ],
    details: [
      "A fila local reenvia automaticamente sem duplicar pedidos quando a chave de idempotencia e preservada.",
      "O desktop tem periodo de tolerancia offline para continuar operando apos uma validacao recente.",
      "Dados enviados: operacoes abertas, fechadas, canceladas, cupons, cadastros locais e pedidos para OMIE quando aplicavel."
    ],
    keywords: [
      "cloud",
      "supabase",
      "omie",
      "sincronizacao",
      "fila",
      "pendente",
      "offline",
      "ativacao"
    ]
  },
  {
    id: "registrations",
    title: "Cadastros e precos",
    eyebrow: "Dados mestres",
    summary:
      "A tela Cadastros centraliza clientes, produtos, condicoes, transporte, tabelas de preco e dados usados na operacao diaria.",
    icon: Users,
    steps: [
      "Abra Cadastros pela sidebar.",
      "Revise clientes sincronizados do OMIE ou crie clientes locais quando permitido.",
      "Confira produtos e condicoes de pagamento vindos do OMIE.",
      "Cadastre veiculos, motoristas, transportadoras e vinculos de transporte.",
      "Configure precos por cliente/produto para reduzir erro na entrada.",
      "Antes de operar, confirme documento, telefone, limite de credito e status financeiro do cliente."
    ],
    details: [
      "Campos controlados pelo OMIE podem ficar bloqueados para edicao local para evitar divergencia.",
      "O bloqueio financeiro considera limite, contas a receber e operacoes locais ainda nao sincronizadas.",
      "Credito pre-pago pode ser debitado no fechamento e estornado em cancelamentos quando aplicavel."
    ],
    keywords: [
      "cadastro",
      "cliente",
      "produto",
      "preco",
      "veiculo",
      "motorista",
      "transportadora",
      "credito"
    ]
  },
  {
    id: "loader",
    title: "Site do carregador",
    eyebrow: "Operacao de patio",
    summary:
      "O carregador usa a aplicacao web para ver os carregamentos em aberto da unidade, sem alterar pesos ou dados financeiros.",
    icon: ListChecks,
    steps: [
      "O administrador cria o usuario carregador vinculado a unidade correta.",
      "O carregador acessa o site, entra com login autorizado e ve somente sua unidade.",
      "A lista mostra placa, cliente, motorista, veiculo e produto em aberto.",
      "Quando o desktop atualiza a operacao, a tela do carregador reflete a mudanca pela cloud.",
      "Se uma operacao nao aparecer, confira internet, unidade vinculada e status de sincronizacao do desktop."
    ],
    details: [
      "O carregador tem acesso somente leitura.",
      "Dados sao segregados por empresa e unidade.",
      "Carregadores nao se cadastram sozinhos; o acesso e controlado pelo admin."
    ],
    keywords: ["carregador", "loader", "site", "web", "patio", "unidade", "login"]
  },
  {
    id: "reports",
    title: "Relatorios, insights e fechamento diario",
    eyebrow: "Gestao",
    summary:
      "Use Painel, Insights e Relatorios para acompanhar producao, faturamento, mix de produtos, operacoes canceladas e e-mails de fechamento.",
    icon: FileText,
    steps: [
      "Abra Painel para status operacional, pendencias e alertas rapidos.",
      "Use Insights para acompanhar indicadores e acionar sincronizacoes quando necessario.",
      "Abra Relatorios para cadastrar destinatarios do fechamento diario por e-mail.",
      "Exporte ou imprima relatorios quando o perfil de impressao estiver configurado.",
      "Compare dia, mes, ano, cliente, produto e operacoes internas/fiscais conforme a necessidade."
    ],
    details: [
      "O fechamento diario pode ser enviado automaticamente pela cloud aos destinatarios ativos.",
      "Relatorios dependem dos dados locais e sincronizados; pendencias podem atrasar consolidacoes externas.",
      "Operacoes canceladas devem ser analisadas com motivo e horario para controle interno."
    ],
    keywords: ["relatorio", "insight", "fechamento", "email", "pdf", "excel", "csv", "indicador"]
  },
  {
    id: "security",
    title: "Backup, acesso e seguranca",
    eyebrow: "Confiabilidade",
    summary:
      "O KyberRock protege credenciais, restringe acesso por unidade e mantem dados locais para operacao offline.",
    icon: ShieldCheck,
    steps: [
      "Mantenha o computador da balanca com usuario Windows restrito e energia estavel.",
      "Nao salve chaves OMIE, service role ou senhas em arquivos fora do painel correto.",
      "Confira logs quando houver erro de abertura, sincronizacao ou hardware.",
      "Use backup local antes de manutencoes, troca de computador ou reinstalacao.",
      "Atualize o desktop somente por pacote oficial e valide a versao apos instalar."
    ],
    details: [
      "O banco local fica em ProgramData e deve ser protegido contra copia indevida.",
      "O desktop usa ativacao por dispositivo e validacao periodica online.",
      "Electron roda com isolamento de contexto, sandbox e sem Node no renderer."
    ],
    keywords: ["backup", "seguranca", "acesso", "ativacao", "logs", "atualizacao", "banco"]
  }
];

export const documentationFaqs: DocumentationFaq[] = [
  {
    question: "A balanca nao conecta. O que verificar?",
    answer:
      "Confira se o IP/host e a porta estao corretos, se o cabo/rede esta funcionando, se o indicador aceita conexao TCP e se outro programa nao esta usando a mesma porta. Depois volte em Configuracoes > Balanca e teste novamente.",
    keywords: ["balanca", "tcp", "ip", "porta", "conexao", "host"]
  },
  {
    question: "O peso fica oscilando e nao estabiliza.",
    answer:
      "Verifique a balanca fisicamente, vento/vibracao, caminhao ainda em movimento e parametros de estabilidade. Aumente o tempo minimo estavel ou a tolerancia de variacao somente se a equipe tecnica validar.",
    keywords: ["peso", "estavel", "estabilidade", "oscilando", "captura"]
  },
  {
    question: "A impressora nao aparece na lista.",
    answer:
      "Instale ou reinstale a impressora no Windows, imprima uma pagina de teste pelo proprio Windows e reabra a tela Configuracoes > Impressao. Se for impressora de rede, confirme permissao e nome compartilhado.",
    keywords: ["impressora", "windows", "lista", "driver", "rede"]
  },
  {
    question: "A impressao falhou depois de fechar a operacao.",
    answer:
      "A operacao continua salva. Corrija papel, energia, driver ou perfil de impressao e use reimpressao. A segunda via fica registrada para auditoria.",
    keywords: ["impressora", "impressao", "cupom", "falhou", "reimpressao", "segunda via"]
  },
  {
    question: "Estou sem internet. Posso continuar operando?",
    answer:
      "Sim, se o desktop foi validado recentemente e estiver dentro do periodo de tolerancia offline. As operacoes ficam na fila local e sincronizam quando a internet voltar.",
    keywords: ["internet", "offline", "cloud", "fila", "sincronizacao"]
  },
  {
    question: "Por que uma operacao ficou pendente de cloud ou OMIE?",
    answer:
      "Pode haver internet instavel, credenciais OMIE ausentes, erro de validacao, dependencia nao sincronizada ou falha temporaria da API. Abra Cloud ou Logs, corrija a causa e tente sincronizar novamente.",
    keywords: ["pendente", "cloud", "omie", "sincronizar", "erro", "fila"]
  },
  {
    question: "Posso digitar peso manualmente?",
    answer:
      "Nao. O fluxo operacional foi desenhado para capturar peso direto da balanca configurada, reduzindo erro e fraude. Se a balanca falhar, corrija a integracao antes de operar.",
    keywords: ["manual", "peso", "digitar", "balanca"]
  },
  {
    question: "Como cancelar uma pesagem?",
    answer:
      "Abra Operacoes, localize a operacao e use a acao de cancelamento. Informe um motivo claro. O cancelamento e auditado e pode estornar credito quando aplicavel.",
    keywords: ["cancelar", "cancelamento", "motivo", "auditoria", "credito"]
  },
  {
    question: "O cliente esta bloqueado por credito.",
    answer:
      "Confira limite, contas a receber no OMIE, operacoes locais ainda pendentes e saldo pre-pago. Se o limite estiver zerado ou sem regra de bloqueio, revise o cadastro no OMIE/painel correto.",
    keywords: ["credito", "financeiro", "cliente", "bloqueado", "omie"]
  },
  {
    question: "O carregador nao ve a operacao no site.",
    answer:
      "Verifique se a operacao foi enviada para a cloud, se o carregador esta vinculado a unidade correta e se a internet esta ativa. Depois atualize o site do carregador.",
    keywords: ["carregador", "loader", "site", "unidade", "cloud"]
  },
  {
    question: "Onde encontro os logs tecnicos?",
    answer:
      "Use o botao de configuracoes/logs no topo para erros recentes. Quando o desktop nao abrir, confira o startup.log em AppData Local do KyberRock Desktop.",
    keywords: ["logs", "erro", "startup", "suporte", "desktop"]
  },
  {
    question: "O que fazer antes de trocar o computador da balanca?",
    answer:
      "Faca backup do banco local, confirme que a cloud esta sincronizada, registre a versao instalada e depois ative o novo dispositivo com o codigo da unidade.",
    keywords: ["backup", "computador", "troca", "ativacao", "banco"]
  }
];

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sectionSearchText(section: DocumentationSection): string {
  return [
    section.title,
    section.eyebrow,
    section.summary,
    ...section.steps,
    ...section.details,
    ...section.keywords
  ].join(" ");
}

function faqSearchText(faq: DocumentationFaq): string {
  return [faq.question, faq.answer, ...faq.keywords].join(" ");
}

function matchesSearchQuery(searchText: string, query: string): boolean {
  const normalizedText = normalizeSearchText(searchText);
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);

  return terms.every((term) => normalizedText.includes(term));
}

export function filterDocumentationContent(query: string): {
  sections: DocumentationSection[];
  faqs: DocumentationFaq[];
} {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return { sections: documentationSections, faqs: documentationFaqs };
  }

  return {
    sections: documentationSections.filter((section) =>
      matchesSearchQuery(sectionSearchText(section), normalizedQuery)
    ),
    faqs: documentationFaqs.filter((faq) => matchesSearchQuery(faqSearchText(faq), normalizedQuery))
  };
}

export function DocumentationView() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const filteredContent = useMemo(
    () => filterDocumentationContent(deferredSearch),
    [deferredSearch]
  );
  const hasSearch = deferredSearch.trim().length > 0;
  const totalResults = filteredContent.sections.length + filteredContent.faqs.length;

  return (
    <section style={styles.page} aria-labelledby="documentation-title">
      <div style={styles.hero}>
        <MountainOutline
          opacity={0.45}
          style={{
            position: "absolute",
            right: "-6px",
            bottom: "-6px",
            width: "200px",
            height: "75px",
            pointerEvents: "none",
            zIndex: 0
          }}
        />
        <div style={{ ...styles.heroText, position: "relative", zIndex: 1 }}>
          <p style={styles.kicker}>Central de ajuda</p>
          <h1 id="documentation-title" style={styles.title}>
            Documentacao do KyberRock
          </h1>
          <p style={styles.subtitle}>
            Guia pratico para operar a balanca, configurar hardware, sincronizar com a cloud,
            resolver duvidas e treinar novos usuarios.
          </p>
        </div>
        <div style={styles.heroCard}>
          <CheckCircle2 size={22} />
          <strong>Use como checklist diario</strong>
          <span>
            Comece pelo fluxo de pesagem e procure por palavras como balanca, cupom ou OMIE.
          </span>
        </div>
      </div>

      <div style={styles.searchPanel}>
        <label style={styles.searchLabel} htmlFor="documentation-search">
          <Search size={16} />
          Buscar solucao por palavra-chave
        </label>
        <div style={styles.searchRow}>
          <input
            id="documentation-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex.: balanca nao conecta, reimpressao, cloud, credito, carregador..."
            style={styles.searchInput}
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} style={styles.clearButton}>
              Limpar
            </button>
          ) : null}
        </div>
        <p style={styles.searchHint}>
          {hasSearch
            ? `${totalResults} resultado(s) encontrado(s) para "${deferredSearch}".`
            : "A busca procura em passos, duvidas, termos tecnicos e descricoes."}
        </p>
      </div>

      {!hasSearch ? (
        <nav aria-label="Indice da documentacao" style={styles.indexGrid}>
          {documentationSections.map((section) => {
            const Icon = section.icon;
            return (
              <a key={section.id} href={`#doc-${section.id}`} style={styles.indexCard}>
                <span style={styles.indexIcon}>
                  <Icon size={18} />
                </span>
                <span style={styles.indexText}>
                  <strong>{section.title}</strong>
                  <small>{section.eyebrow}</small>
                </span>
              </a>
            );
          })}
        </nav>
      ) : null}

      {totalResults === 0 ? (
        <div style={styles.emptyState}>
          <AlertTriangle size={24} />
          <strong>Nenhum resultado encontrado.</strong>
          <span>
            Tente buscar por termos mais simples, como balanca, impressora, cloud ou cliente.
          </span>
        </div>
      ) : null}

      <div style={styles.contentGrid}>
        {filteredContent.sections.map((section) => (
          <DocumentationSectionCard key={section.id} section={section} />
        ))}
      </div>

      <div style={styles.faqPanel}>
        <div style={styles.sectionHeader}>
          <span style={styles.headerIcon}>
            <HelpCircle size={18} />
          </span>
          <div>
            <h2 style={styles.sectionTitle}>Duvidas comuns</h2>
            <p style={styles.sectionDescription}>
              Respostas rapidas para problemas de operacao, hardware, cloud e suporte.
            </p>
          </div>
        </div>
        <div style={styles.faqList}>
          {filteredContent.faqs.map((faq) => (
            <article key={faq.question} style={styles.faqCard}>
              <h3 style={styles.faqQuestion}>{faq.question}</h3>
              <p style={styles.faqAnswer}>{faq.answer}</p>
            </article>
          ))}
        </div>
      </div>

      <div style={styles.supportPanel}>
        <div style={styles.sectionHeader}>
          <span style={styles.headerIcon}>
            <Settings size={18} />
          </span>
          <div>
            <h2 style={styles.sectionTitle}>Checklist antes de chamar suporte</h2>
            <p style={styles.sectionDescription}>
              Colete estas informacoes para acelerar o diagnostico.
            </p>
          </div>
        </div>
        <div style={styles.checklistGrid}>
          {[
            "Nome da empresa, unidade e computador da balanca.",
            "Horario aproximado do problema e placa da operacao, se existir.",
            "Print ou texto do erro exibido no KyberRock.",
            "Status de internet, cloud, OMIE, balanca e impressora no Painel.",
            "Ultima acao feita antes da falha: entrada, saida, impressao ou sincronizacao.",
            "Se houve queda de energia, troca de cabo, troca de impressora ou alteracao de rede."
          ].map((item) => (
            <div key={item} style={styles.checklistItem}>
              <CheckCircle2 size={16} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DocumentationSectionCard({ section }: { section: DocumentationSection }) {
  const Icon = section.icon;

  return (
    <article id={`doc-${section.id}`} style={styles.sectionCard}>
      <div style={styles.sectionHeader}>
        <span style={styles.headerIcon}>
          <Icon size={18} />
        </span>
        <div>
          <p style={styles.cardEyebrow}>{section.eyebrow}</p>
          <h2 style={styles.sectionTitle}>{section.title}</h2>
          <p style={styles.sectionDescription}>{section.summary}</p>
        </div>
      </div>

      <div style={styles.cardColumns}>
        <div>
          <h3 style={styles.blockTitle}>Passo a passo</h3>
          <ol style={styles.stepList}>
            {section.steps.map((step) => (
              <li key={step} style={styles.stepItem}>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <div style={styles.detailBox}>
          <h3 style={styles.blockTitle}>Pontos importantes</h3>
          <ul style={styles.detailList}>
            {section.details.map((detail) => (
              <li key={detail} style={styles.detailItem}>
                {detail}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "12px",
    minHeight: 0
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1fr) minmax(220px, 320px)",
    gap: "14px",
    alignItems: "stretch",
    padding: "18px",
    borderRadius: "18px",
    background: "#1c1917",
    border: "1px solid #292524",
    color: "#ffffff",
    boxShadow: "0 18px 45px rgba(28, 25, 23, 0.2)"
  },
  heroText: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "6px"
  },
  kicker: {
    margin: 0,
    color: "#fde68a",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase"
  },
  title: {
    margin: 0,
    fontSize: "28px",
    lineHeight: 1.05,
    color: "#ffffff"
  },
  subtitle: {
    margin: 0,
    color: "#e7e5e4",
    fontSize: "14px",
    lineHeight: 1.45,
    maxWidth: "760px"
  },
  heroCard: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "14px",
    borderRadius: "16px",
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.22)",
    color: "#fafaf9",
    fontSize: "13px",
    lineHeight: 1.4
  },
  searchPanel: {
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  searchLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
    color: "var(--kr-text-strong)",
    fontWeight: 800,
    fontSize: "13px"
  },
  searchRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center"
  },
  searchInput: {
    flex: 1,
    minWidth: "180px",
    border: "1px solid var(--kr-input-border)",
    borderRadius: "12px",
    padding: "10px 12px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  clearButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    borderRadius: "10px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 800
  },
  searchHint: {
    margin: "8px 0 0 0",
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  indexGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "10px"
  },
  indexCard: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    color: "var(--kr-text-strong)",
    textDecoration: "none",
    boxShadow: "var(--kr-shadow)"
  },
  indexIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    borderRadius: "12px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flex: "0 0 auto"
  },
  indexText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "13px"
  },
  contentGrid: {
    display: "grid",
    gap: "12px"
  },
  sectionCard: {
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)",
    scrollMarginTop: "16px"
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px"
  },
  headerIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    borderRadius: "12px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flex: "0 0 auto"
  },
  cardEyebrow: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase"
  },
  sectionTitle: {
    margin: "2px 0 0 0",
    color: "var(--kr-text-strong)",
    fontSize: "16px"
  },
  sectionDescription: {
    margin: "4px 0 0 0",
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.45
  },
  cardColumns: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1.1fr) minmax(240px, 0.9fr)",
    gap: "12px",
    marginTop: "12px"
  },
  blockTitle: {
    margin: "0 0 8px 0",
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  stepList: {
    margin: 0,
    paddingLeft: "22px",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.55
  },
  stepItem: {
    paddingLeft: "4px",
    marginBottom: "4px"
  },
  detailBox: {
    padding: "12px",
    borderRadius: "14px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)"
  },
  detailList: {
    margin: 0,
    paddingLeft: "18px",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.55
  },
  detailItem: {
    marginBottom: "5px"
  },
  faqPanel: {
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  faqList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "10px",
    marginTop: "12px"
  },
  faqCard: {
    padding: "12px",
    borderRadius: "14px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)"
  },
  faqQuestion: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  faqAnswer: {
    margin: "6px 0 0 0",
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.45
  },
  supportPanel: {
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  checklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "8px",
    marginTop: "12px"
  },
  checklistItem: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    padding: "10px",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.4
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    alignItems: "center",
    justifyContent: "center",
    padding: "26px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    color: "var(--kr-muted)",
    textAlign: "center"
  }
};
