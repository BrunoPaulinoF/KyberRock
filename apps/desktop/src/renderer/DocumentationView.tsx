import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Copy,
  HelpCircle,
  LifeBuoy,
  ListChecks,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Wrench,
  X
} from "lucide-react";

import { DocumentationAssistant } from "./DocumentationAssistant";
import type { DocsAssistantBridge } from "./documentation-assistant";
import {
  buildSupportClipboardText,
  documentationFaqCategories,
  documentationFaqs,
  documentationGlossary,
  documentationSections,
  operationFlowStages,
  quickStartTasks,
  supportChecklist,
  troubleshootingFlows,
  type DocumentationFaqCategory,
  type DocumentationTabId
} from "./documentation-content";
import {
  filterFaqsByCategory,
  searchDocumentation,
  type DocumentationSearchResult
} from "./documentation-search";

// ---------------------------------------------------------------------------
// Central de ajuda do KyberRock.
//
// A tela e organizada em seis areas navegaveis (Comecar, Guias, Duvidas,
// Diagnostico, Glossario e Suporte), com uma busca global que atravessa todas
// elas, e o assistente flutuante no canto.
//
// O conteudo vive em `documentation-content.ts` e a busca em
// `documentation-search.ts`. Aqui fica so a interface: quem for corrigir um
// texto operacional nao precisa passar por este arquivo.
//
// O progresso do usuario (checklist de preparacao e passos dos guias) persiste
// em localStorage para a tela funcionar como material de treinamento, e nao
// apenas de leitura.
// ---------------------------------------------------------------------------

// Reexportados para nao quebrar quem ja importava daqui.
export type { DocumentationTabId, DocumentationFaqCategory };
export {
  buildSupportClipboardText,
  documentationFaqCategories,
  documentationFaqs,
  documentationGlossary,
  documentationSections,
  operationFlowStages,
  quickStartTasks,
  supportChecklist,
  troubleshootingFlows
};
export {
  filterDocumentationContent,
  filterFaqsByCategory,
  filterTroubleshootingFlows,
  searchDocumentation
} from "./documentation-search";

// ---------------------------------------------------------------------------
// Persistencia local do progresso (treinamento)
// ---------------------------------------------------------------------------

const QUICK_START_STORAGE_KEY = "kyberrock.docs.quickstart.v1";
const GUIDE_STEPS_STORAGE_KEY = "kyberrock.docs.guide-steps.v1";

function loadStoredJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function loadStoredStringArray(key: string): string[] {
  const stored = loadStoredJson(key);
  return Array.isArray(stored)
    ? stored.filter((item): item is string => typeof item === "string")
    : [];
}

function loadStoredNumberArrayRecord(key: string): Record<string, number[]> {
  const stored = loadStoredJson(key);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }

  const result: Record<string, number[]> = {};
  for (const [entryKey, entryValue] of Object.entries(stored)) {
    if (Array.isArray(entryValue)) {
      result[entryKey] = entryValue.filter((item): item is number => typeof item === "number");
    }
  }
  return result;
}

function storeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem localStorage (ou cheio): o progresso simplesmente nao persiste.
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

const documentationTabs: Array<{ id: DocumentationTabId; label: string; icon: LucideIcon }> = [
  { id: "start", label: "Comecar", icon: Rocket },
  { id: "guides", label: "Guias", icon: BookOpen },
  { id: "faq", label: "Duvidas", icon: HelpCircle },
  { id: "troubleshoot", label: "Diagnostico", icon: Wrench },
  { id: "glossary", label: "Glossario", icon: BookMarked },
  { id: "support", label: "Suporte", icon: LifeBuoy }
];

const RESULT_KIND_LABEL: Record<DocumentationSearchResult["kind"], string> = {
  section: "Guia",
  faq: "Duvida",
  flow: "Diagnostico",
  glossary: "Glossario"
};

const RESULT_KIND_ICON: Record<DocumentationSearchResult["kind"], LucideIcon> = {
  section: BookOpen,
  faq: HelpCircle,
  flow: Wrench,
  glossary: BookMarked
};

export function DocumentationView({ desktopApi }: { desktopApi?: DocsAssistantBridge | null }) {
  const [activeTab, setActiveTab] = useState<DocumentationTabId>("start");
  const [activeSectionId, setActiveSectionId] = useState(documentationSections[0]?.id ?? "");
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [faqCategory, setFaqCategory] = useState<DocumentationFaqCategory | "all">("all");
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [doneQuickStart, setDoneQuickStart] = useState<string[]>(() =>
    loadStoredStringArray(QUICK_START_STORAGE_KEY)
  );
  const [doneGuideSteps, setDoneGuideSteps] = useState<Record<string, number[]>>(() =>
    loadStoredNumberArrayRecord(GUIDE_STEPS_STORAGE_KEY)
  );

  useEffect(() => {
    storeJson(QUICK_START_STORAGE_KEY, doneQuickStart);
  }, [doneQuickStart]);

  useEffect(() => {
    storeJson(GUIDE_STEPS_STORAGE_KEY, doneGuideSteps);
  }, [doneGuideSteps]);

  // A busca so roda quando a consulta muda: o indice e estatico, entao repetir
  // a varredura a cada marcacao de checkbox seria trabalho jogado fora.
  const searchResults = useMemo(
    () => searchDocumentation(searchQuery, { limit: 24 }),
    [searchQuery]
  );
  const searching = searchQuery.trim().length > 0;

  const openGuide = (sectionId: string) => {
    setActiveSectionId(sectionId);
    setActiveTab("guides");
    setSearchQuery("");
  };

  const openResult = (result: DocumentationSearchResult) => {
    setSearchQuery("");
    if (result.kind === "section") {
      setActiveSectionId(result.id);
      setActiveTab("guides");
      return;
    }
    if (result.kind === "faq") {
      setFaqCategory("all");
      setExpandedFaq(result.id);
      setActiveTab("faq");
      return;
    }
    if (result.kind === "flow") {
      setActiveFlowId(result.id);
      setActiveTab("troubleshoot");
      return;
    }
    // Glossario: abre o guia relacionado quando existe, senao a propria aba.
    if (result.sectionId) {
      setActiveSectionId(result.sectionId);
      setActiveTab("guides");
      return;
    }
    setActiveTab("glossary");
  };

  const toggleQuickStartTask = (taskId: string) => {
    setDoneQuickStart((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    );
  };

  const toggleGuideStep = (sectionId: string, stepIndex: number) => {
    setDoneGuideSteps((current) => {
      const done = current[sectionId] ?? [];
      const next = done.includes(stepIndex)
        ? done.filter((index) => index !== stepIndex)
        : [...done, stepIndex];
      return { ...current, [sectionId]: next };
    });
  };

  const resetGuideSteps = (sectionId: string) => {
    setDoneGuideSteps((current) => ({ ...current, [sectionId]: [] }));
  };

  // A folha de estilo entra uma unica vez no <head> e fica la. Quando ela era
  // renderizada dentro da tela (<style> no meio da arvore), abrir e fechar a
  // documentacao inseria/removia um stylesheet, e cada insercao obriga o
  // navegador a recalcular o estilo do app inteiro — era isso que travava o
  // clique e remexia os itens do menu lateral.
  useLayoutEffect(() => {
    ensureDocumentationStyles();
  }, []);

  return (
    <section style={styles.page} aria-labelledby="documentation-title">
      {/*
        Faixa de busca simples, em linha. O cabecalho escuro que existia aqui
        tinha altura propria e era esmagado pelo grid da area de conteudo — o
        titulo aparecia cortado e a caixa de busca junto. Como o titulo ja esta
        no menu lateral, ele saiu inteiro em vez de ser remendado: sobrou o que
        precisa de espaco garantido, que e o campo de busca.
      */}
      <div style={styles.searchBar}>
        <label style={styles.searchLabel} htmlFor="documentation-search">
          <Search size={15} />
          <span id="documentation-title">Buscar na documentacao</span>
        </label>
        <input
          id="documentation-search"
          ref={searchInputRef}
          className="krdoc-input"
          style={styles.searchInput}
          type="search"
          value={searchQuery}
          placeholder='Digite sua duvida: "como emitir nota fiscal", "a balanca nao conecta"...'
          autoComplete="off"
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && searchQuery) {
              event.stopPropagation();
              setSearchQuery("");
            }
          }}
        />
        {searching ? (
          <>
            <span style={styles.searchCount}>
              {searchResults.length} {searchResults.length === 1 ? "resultado" : "resultados"}
            </span>
            <button
              type="button"
              className="krdoc-ghost-btn"
              style={styles.clearButton}
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
            >
              <X size={13} />
              Limpar
            </button>
          </>
        ) : null}
      </div>

      <nav aria-label="Areas da documentacao" style={styles.tabBar} role="tablist">
        {documentationTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = !searching && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? "krdoc-tab krdoc-tab-active" : "krdoc-tab"}
              onClick={() => {
                setSearchQuery("");
                setActiveTab(tab.id);
              }}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {searching ? (
        <SearchResultsPanel
          query={searchQuery}
          results={searchResults}
          onOpenResult={openResult}
          onClear={() => {
            setSearchQuery("");
            searchInputRef.current?.focus();
          }}
        />
      ) : (
        <>
          {activeTab === "start" ? (
            <StartTab
              doneTasks={doneQuickStart}
              onToggleTask={toggleQuickStartTask}
              onOpenGuide={openGuide}
            />
          ) : null}
          {activeTab === "guides" ? (
            <GuidesTab
              activeSectionId={activeSectionId}
              onSelectSection={setActiveSectionId}
              doneSteps={doneGuideSteps}
              onToggleStep={toggleGuideStep}
              onResetSteps={resetGuideSteps}
            />
          ) : null}
          {activeTab === "faq" ? (
            <FaqTab
              category={faqCategory}
              onSelectCategory={(next) => {
                setFaqCategory(next);
                setExpandedFaq(null);
              }}
              expandedQuestion={expandedFaq}
              onToggleQuestion={(question) =>
                setExpandedFaq((current) => (current === question ? null : question))
              }
              onOpenGuide={openGuide}
            />
          ) : null}
          {activeTab === "troubleshoot" ? (
            <TroubleshootTab
              activeFlowId={activeFlowId}
              onSelectFlow={setActiveFlowId}
              onOpenSupport={() => setActiveTab("support")}
            />
          ) : null}
          {activeTab === "glossary" ? <GlossaryTab onOpenGuide={openGuide} /> : null}
          {activeTab === "support" ? <SupportTab /> : null}
        </>
      )}

      <DocumentationAssistant
        bridge={desktopApi ?? null}
        onOpenSection={openGuide}
        onOpenSupport={() => {
          setSearchQuery("");
          setActiveTab("support");
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Resultados da busca
// ---------------------------------------------------------------------------

function SearchResultsPanel({
  query,
  results,
  onOpenResult,
  onClear
}: {
  query: string;
  results: DocumentationSearchResult[];
  onOpenResult: (result: DocumentationSearchResult) => void;
  onClear: () => void;
}) {
  if (results.length === 0) {
    return (
      <section style={styles.emptyState} aria-live="polite">
        <Search size={22} />
        <strong style={styles.emptyTitle}>Nada encontrado para &ldquo;{query.trim()}&rdquo;</strong>
        <span>
          Tente outras palavras (por exemplo &ldquo;nota&rdquo; em vez de &ldquo;NF&rdquo;), ou
          pergunte ao assistente no canto da tela — ele procura na documentacao inteira e, se nao
          souber, te encaminha ao suporte.
        </span>
        <button
          type="button"
          className="krdoc-ghost-btn"
          style={styles.pagerButton}
          onClick={onClear}
        >
          <X size={13} />
          Limpar busca
        </button>
      </section>
    );
  }

  return (
    <section style={styles.resultGroup} aria-live="polite" aria-label="Resultados da busca">
      <h2 style={styles.resultGroupTitle}>
        <Search size={15} />
        Resultados para &ldquo;{query.trim()}&rdquo;
      </h2>
      <div style={styles.resultList}>
        {results.map((result) => {
          const Icon = RESULT_KIND_ICON[result.kind];
          return (
            <button
              key={`${result.kind}-${result.id}`}
              type="button"
              className="krdoc-result"
              onClick={() => onOpenResult(result)}
            >
              <span style={styles.resultIcon}>
                <Icon size={17} />
              </span>
              <span style={styles.resultText}>
                <span style={styles.resultKind}>{RESULT_KIND_LABEL[result.kind]}</span>
                <strong>{result.title}</strong>
                <small style={styles.resultSnippet}>{result.snippet}</small>
              </span>
              <ArrowRight size={15} style={{ flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aba Comecar
// ---------------------------------------------------------------------------

function StartTab({
  doneTasks,
  onToggleTask,
  onOpenGuide
}: {
  doneTasks: string[];
  onToggleTask: (taskId: string) => void;
  onOpenGuide: (sectionId: string) => void;
}) {
  const doneCount = quickStartTasks.filter((task) => doneTasks.includes(task.id)).length;
  const progressPercent = Math.round((doneCount / quickStartTasks.length) * 100);

  return (
    <div style={styles.startGrid}>
      <section style={styles.panel} aria-labelledby="quickstart-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Rocket size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="quickstart-title" style={styles.panelTitle}>
              Preparacao da unidade
            </h2>
            <p style={styles.panelDescription}>
              Marque cada etapa concluida. O progresso fica salvo neste computador.
            </p>
          </div>
          <span style={styles.progressBadge}>
            {doneCount}/{quickStartTasks.length}
          </span>
        </div>
        <div
          style={styles.progressTrack}
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da preparacao"
        >
          <div style={{ ...styles.progressFill, width: `${progressPercent}%` }} />
        </div>
        <ul style={styles.taskList}>
          {quickStartTasks.map((task) => {
            const done = doneTasks.includes(task.id);
            return (
              <li key={task.id}>
                <div className={done ? "krdoc-task krdoc-task-done" : "krdoc-task"}>
                  <label style={styles.taskLabel}>
                    <input
                      type="checkbox"
                      className="krdoc-check"
                      checked={done}
                      onChange={() => onToggleTask(task.id)}
                    />
                    <span style={styles.taskText}>
                      <strong style={done ? styles.taskTitleDone : styles.taskTitle}>
                        {task.label}
                      </strong>
                      <small style={styles.taskDescription}>{task.description}</small>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="krdoc-ghost-btn"
                    style={styles.taskGuideButton}
                    onClick={() => onOpenGuide(task.sectionId)}
                  >
                    Ver guia
                    <ArrowRight size={13} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section style={styles.panel} aria-labelledby="flow-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Truck size={18} />
          </span>
          <div>
            <h2 id="flow-title" style={styles.panelTitle}>
              Ciclo de uma pesagem
            </h2>
            <p style={styles.panelDescription}>
              Toda operacao passa por estas etapas. Clique em uma etapa para abrir o guia.
            </p>
          </div>
        </div>
        <ol style={styles.flowList}>
          {operationFlowStages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <li key={stage.id} style={styles.flowItem}>
                <button
                  type="button"
                  className="krdoc-flow-stage"
                  onClick={() => onOpenGuide(stage.sectionId)}
                >
                  <span style={styles.flowStep}>{index + 1}</span>
                  <span style={styles.flowIcon}>
                    <Icon size={17} />
                  </span>
                  <span style={styles.flowText}>
                    <strong>{stage.title}</strong>
                    <small>{stage.description}</small>
                  </span>
                </button>
                {index < operationFlowStages.length - 1 ? (
                  <span style={styles.flowConnector} aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
        <div style={styles.startHintCard}>
          <CheckCircle2 size={16} />
          <span>
            Com problema agora? Abra a aba <strong>Diagnostico</strong> e siga as verificacoes
            guiadas antes de chamar o suporte.
          </span>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Guias
// ---------------------------------------------------------------------------

function GuidesTab({
  activeSectionId,
  onSelectSection,
  doneSteps,
  onToggleStep,
  onResetSteps
}: {
  activeSectionId: string;
  onSelectSection: (sectionId: string) => void;
  doneSteps: Record<string, number[]>;
  onToggleStep: (sectionId: string, stepIndex: number) => void;
  onResetSteps: (sectionId: string) => void;
}) {
  const activeIndex = Math.max(
    0,
    documentationSections.findIndex((section) => section.id === activeSectionId)
  );
  const activeSection = documentationSections[activeIndex];
  const previousSection = documentationSections[activeIndex - 1];
  const nextSection = documentationSections[activeIndex + 1];
  const sectionDone = doneSteps[activeSection.id] ?? [];
  const doneCount = activeSection.steps.filter((_, index) => sectionDone.includes(index)).length;
  const Icon = activeSection.icon;

  return (
    <div style={styles.guidesGrid}>
      <nav aria-label="Guias disponiveis" style={styles.guideNav}>
        {documentationSections.map((section) => {
          const SectionIcon = section.icon;
          const isActive = section.id === activeSection.id;
          const sectionSteps = doneSteps[section.id] ?? [];
          const completed =
            section.steps.filter((_, index) => sectionSteps.includes(index)).length ===
            section.steps.length;
          return (
            <button
              key={section.id}
              type="button"
              className={isActive ? "krdoc-nav-item krdoc-nav-item-active" : "krdoc-nav-item"}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSelectSection(section.id)}
            >
              <span style={styles.navIcon}>
                <SectionIcon size={16} />
              </span>
              <span style={styles.navText}>
                <strong>{section.title}</strong>
                <small>{section.eyebrow}</small>
              </span>
              {completed ? (
                <CheckCircle2 size={15} style={{ color: "var(--kr-success)", flexShrink: 0 }} />
              ) : null}
            </button>
          );
        })}
      </nav>

      <article style={styles.guideContent} aria-labelledby={`guide-${activeSection.id}`}>
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Icon size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={styles.cardEyebrow}>{activeSection.eyebrow}</p>
            <h2 id={`guide-${activeSection.id}`} style={styles.panelTitle}>
              {activeSection.title}
            </h2>
            <p style={styles.panelDescription}>{activeSection.summary}</p>
          </div>
        </div>

        <div style={styles.guideStepsHeader}>
          <h3 style={styles.blockTitle}>Passo a passo</h3>
          <div style={styles.guideStepsMeta}>
            <span style={styles.guideStepsCount}>
              {doneCount} de {activeSection.steps.length} passos conferidos
            </span>
            {doneCount > 0 ? (
              <button
                type="button"
                className="krdoc-ghost-btn"
                style={styles.resetButton}
                onClick={() => onResetSteps(activeSection.id)}
              >
                <RotateCcw size={13} />
                Reiniciar
              </button>
            ) : null}
          </div>
        </div>

        <ol style={styles.guideStepList}>
          {activeSection.steps.map((step, index) => {
            const done = sectionDone.includes(index);
            return (
              <li key={step}>
                <label className={done ? "krdoc-step krdoc-step-done" : "krdoc-step"}>
                  <input
                    type="checkbox"
                    className="krdoc-check"
                    checked={done}
                    onChange={() => onToggleStep(activeSection.id, index)}
                  />
                  <span style={styles.stepNumber}>{index + 1}</span>
                  <span style={done ? styles.stepTextDone : styles.stepText}>{step}</span>
                </label>
              </li>
            );
          })}
        </ol>

        <div style={styles.detailBox}>
          <h3 style={styles.blockTitle}>Pontos importantes</h3>
          <ul style={styles.detailList}>
            {activeSection.details.map((detail) => (
              <li key={detail} style={styles.detailItem}>
                {detail}
              </li>
            ))}
          </ul>
        </div>

        <div style={styles.guidePager}>
          {previousSection ? (
            <button
              type="button"
              className="krdoc-ghost-btn"
              style={styles.pagerButton}
              onClick={() => onSelectSection(previousSection.id)}
            >
              <ArrowLeft size={14} />
              {previousSection.title}
            </button>
          ) : (
            <span />
          )}
          {nextSection ? (
            <button
              type="button"
              className="krdoc-ghost-btn"
              style={styles.pagerButton}
              onClick={() => onSelectSection(nextSection.id)}
            >
              {nextSection.title}
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Duvidas (FAQ)
// ---------------------------------------------------------------------------

function FaqTab({
  category,
  onSelectCategory,
  expandedQuestion,
  onToggleQuestion,
  onOpenGuide
}: {
  category: DocumentationFaqCategory | "all";
  onSelectCategory: (category: DocumentationFaqCategory | "all") => void;
  expandedQuestion: string | null;
  onToggleQuestion: (question: string) => void;
  onOpenGuide: (sectionId: string) => void;
}) {
  const faqs = filterFaqsByCategory(category);

  return (
    <section style={styles.panel} aria-labelledby="faq-title">
      <div style={styles.panelHeader}>
        <span style={styles.headerIcon}>
          <HelpCircle size={18} />
        </span>
        <div>
          <h2 id="faq-title" style={styles.panelTitle}>
            Duvidas comuns
          </h2>
          <p style={styles.panelDescription}>
            Clique em uma pergunta para ver a resposta. Filtre por assunto, ou use a busca la em
            cima para procurar pela frase inteira.
          </p>
        </div>
      </div>

      <div style={styles.categoryRow} role="group" aria-label="Filtrar duvidas por assunto">
        {documentationFaqCategories.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === category ? "krdoc-chip krdoc-chip-active" : "krdoc-chip"}
            aria-pressed={option.id === category}
            onClick={() => onSelectCategory(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div style={styles.faqList}>
        {faqs.map((faq) => {
          const expanded = expandedQuestion === faq.question;
          return (
            <div key={faq.question} className="krdoc-faq-item">
              <button
                type="button"
                className="krdoc-faq-question"
                aria-expanded={expanded}
                onClick={() => onToggleQuestion(faq.question)}
              >
                <span style={styles.faqQuestionText}>{faq.question}</span>
                <ChevronDown
                  size={16}
                  style={{
                    flexShrink: 0,
                    transition: "transform 0.15s ease",
                    transform: expanded ? "rotate(180deg)" : "none"
                  }}
                />
              </button>
              {expanded ? (
                <div style={styles.faqAnswerBox}>
                  <p style={styles.faqAnswer}>{faq.answer}</p>
                  {faq.sectionId ? (
                    <button
                      type="button"
                      className="krdoc-ghost-btn"
                      style={styles.faqGuideButton}
                      onClick={() => onOpenGuide(faq.sectionId as string)}
                    >
                      Ver o guia completo
                      <ArrowRight size={13} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aba Diagnostico
// ---------------------------------------------------------------------------

function TroubleshootTab({
  activeFlowId,
  onSelectFlow,
  onOpenSupport
}: {
  activeFlowId: string | null;
  onSelectFlow: (flowId: string | null) => void;
  onOpenSupport: () => void;
}) {
  // As verificacoes do diagnostico sao por incidente, entao o estado e
  // proposital nao persistido: cada novo problema comeca do zero.
  const [doneChecks, setDoneChecks] = useState<Record<string, number[]>>({});
  const activeFlow = troubleshootingFlows.find((flow) => flow.id === activeFlowId) ?? null;

  if (!activeFlow) {
    return (
      <section style={styles.panel} aria-labelledby="troubleshoot-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Wrench size={18} />
          </span>
          <div>
            <h2 id="troubleshoot-title" style={styles.panelTitle}>
              Diagnostico guiado
            </h2>
            <p style={styles.panelDescription}>
              Escolha o problema que esta acontecendo para seguir as verificacoes na ordem certa.
            </p>
          </div>
        </div>
        <div style={styles.flowGrid}>
          {troubleshootingFlows.map((flow) => {
            const Icon = flow.icon;
            return (
              <button
                key={flow.id}
                type="button"
                className="krdoc-problem-card"
                onClick={() => onSelectFlow(flow.id)}
              >
                <span style={styles.resultIcon}>
                  <Icon size={17} />
                </span>
                <span style={styles.resultText}>
                  <strong>{flow.title}</strong>
                  <small>{flow.symptom}</small>
                </span>
                <ArrowRight size={15} style={{ flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const flowDone = doneChecks[activeFlow.id] ?? [];
  const FlowIcon = activeFlow.icon;

  const toggleCheck = (index: number) => {
    setDoneChecks((current) => {
      const done = current[activeFlow.id] ?? [];
      const next = done.includes(index) ? done.filter((item) => item !== index) : [...done, index];
      return { ...current, [activeFlow.id]: next };
    });
  };

  return (
    <section style={styles.panel} aria-labelledby="troubleshoot-flow-title">
      <button
        type="button"
        className="krdoc-ghost-btn"
        style={styles.backButton}
        onClick={() => onSelectFlow(null)}
      >
        <ArrowLeft size={14} />
        Todos os problemas
      </button>

      <div style={styles.panelHeader}>
        <span style={styles.headerIcon}>
          <FlowIcon size={18} />
        </span>
        <div>
          <h2 id="troubleshoot-flow-title" style={styles.panelTitle}>
            {activeFlow.title}
          </h2>
          <p style={styles.panelDescription}>{activeFlow.symptom}</p>
        </div>
      </div>

      <p style={styles.troubleshootHint}>
        Siga as verificacoes na ordem e marque as que ja fez. Teste o sistema apos cada passo.
      </p>

      <ol style={styles.guideStepList}>
        {activeFlow.checks.map((check, index) => {
          const done = flowDone.includes(index);
          return (
            <li key={check}>
              <label className={done ? "krdoc-step krdoc-step-done" : "krdoc-step"}>
                <input
                  type="checkbox"
                  className="krdoc-check"
                  checked={done}
                  onChange={() => toggleCheck(index)}
                />
                <span style={styles.stepNumber}>{index + 1}</span>
                <span style={done ? styles.stepTextDone : styles.stepText}>{check}</span>
              </label>
            </li>
          );
        })}
      </ol>

      <div style={styles.escalationBox}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={styles.escalationTitle}>Nao resolveu?</strong>
          <p style={styles.escalationText}>{activeFlow.escalation}</p>
          <button
            type="button"
            className="krdoc-ghost-btn"
            style={styles.pagerButton}
            onClick={onOpenSupport}
          >
            <LifeBuoy size={14} />
            Abrir checklist de suporte
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aba Glossario
// ---------------------------------------------------------------------------

function GlossaryTab({ onOpenGuide }: { onOpenGuide: (sectionId: string) => void }) {
  return (
    <section style={styles.panel} aria-labelledby="glossary-title">
      <div style={styles.panelHeader}>
        <span style={styles.headerIcon}>
          <BookMarked size={18} />
        </span>
        <div>
          <h2 id="glossary-title" style={styles.panelTitle}>
            Glossario
          </h2>
          <p style={styles.panelDescription}>
            O que cada termo do sistema quer dizer, na linguagem da pedreira.
          </p>
        </div>
      </div>
      <div style={styles.glossaryGrid}>
        {documentationGlossary.map((entry) => (
          <div key={entry.term} style={styles.glossaryItem}>
            <strong style={styles.glossaryTerm}>{entry.term}</strong>
            <span style={styles.glossaryDefinition}>{entry.definition}</span>
            {entry.sectionId ? (
              <button
                type="button"
                className="krdoc-ghost-btn"
                style={styles.glossaryLink}
                onClick={() => onOpenGuide(entry.sectionId as string)}
              >
                Ver guia
                <ArrowRight size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Aba Suporte
// ---------------------------------------------------------------------------

function SupportTab() {
  const [copied, setCopied] = useState(false);

  const copyChecklist = async () => {
    const text = buildSupportClipboardText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para contextos sem a Clipboard API (ex.: janela sem foco).
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } finally {
        textarea.remove();
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={styles.supportGrid}>
      <section style={styles.panel} aria-labelledby="support-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <LifeBuoy size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="support-title" style={styles.panelTitle}>
              Antes de chamar o suporte
            </h2>
            <p style={styles.panelDescription}>
              Colete estas informacoes para acelerar o diagnostico do problema.
            </p>
          </div>
          <button
            type="button"
            className="krdoc-ghost-btn"
            style={styles.copyButton}
            onClick={() => void copyChecklist()}
          >
            {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            {copied ? "Copiado!" : "Copiar modelo"}
          </button>
        </div>
        <div style={styles.checklistGrid}>
          {supportChecklist.map((item) => (
            <div key={item} style={styles.checklistItem}>
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p style={styles.supportFootnote}>
          O botao Copiar modelo gera um texto pronto para preencher e enviar ao suporte por e-mail
          ou mensagem.
        </p>
      </section>

      <section style={styles.panel} aria-labelledby="logs-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <Settings size={18} />
          </span>
          <div>
            <h2 id="logs-title" style={styles.panelTitle}>
              Onde encontrar os logs
            </h2>
            <p style={styles.panelDescription}>
              Os logs ajudam o suporte a entender exatamente o que aconteceu.
            </p>
          </div>
        </div>
        <ul style={styles.detailList}>
          <li style={styles.detailItem}>
            <strong>Erros recentes:</strong> use o botao de logs no menu da engrenagem (F10) para
            ver falhas de sincronizacao, balanca e impressao.
          </li>
          <li style={styles.detailItem}>
            <strong>Desktop nao abre:</strong> consulte o arquivo startup.log em AppData Local, na
            pasta do KyberRock Desktop.
          </li>
          <li style={styles.detailItem}>
            <strong>Faturamento recusado:</strong> copie tambem a mensagem exibida pelo OMIE — e ela
            que nomeia o campo que faltou no cadastro.
          </li>
          <li style={styles.detailItem}>
            <strong>Antes de reinstalar:</strong> sempre faca backup do banco local. A operacao
            fechada nunca deve ser perdida.
          </li>
        </ul>
        <div style={styles.startHintCard}>
          <ShieldCheck size={16} />
          <span>
            Nunca envie chaves do OMIE, senhas ou o arquivo do banco de dados por canais inseguros.
          </span>
        </div>
      </section>

      <section style={styles.panel} aria-labelledby="assistant-title">
        <div style={styles.panelHeader}>
          <span style={styles.headerIcon}>
            <ListChecks size={18} />
          </span>
          <div>
            <h2 id="assistant-title" style={styles.panelTitle}>
              Assistente da documentacao
            </h2>
            <p style={styles.panelDescription}>
              O botao no canto inferior direito abre um chat que responde com base nesta
              documentacao.
            </p>
          </div>
        </div>
        <ul style={styles.detailList}>
          <li style={styles.detailItem}>
            Pergunte com as suas palavras: ele entende a frase inteira, nao so palavra-chave.
          </li>
          <li style={styles.detailItem}>
            Toda resposta mostra as fontes usadas, e cada fonte abre o guia correspondente.
          </li>
          <li style={styles.detailItem}>
            Sem internet ele continua respondendo, usando a documentacao instalada neste computador.
          </li>
          <li style={styles.detailItem}>
            O que a documentacao nao cobre ele nao inventa: ele avisa e encaminha voce ao suporte.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

export const DOCUMENTATION_STYLE_ELEMENT_ID = "kyberrock-documentation-styles";

/**
 * Injeta a folha de estilo da documentacao no `<head>` uma unica vez por sessao.
 * Idempotente: chamadas repetidas (reabrir a tela) nao mexem no DOM.
 */
export function ensureDocumentationStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(DOCUMENTATION_STYLE_ELEMENT_ID)) return;

  const style = document.createElement("style");
  style.id = DOCUMENTATION_STYLE_ELEMENT_ID;
  style.textContent = documentationCss;
  document.head.appendChild(style);
}

// Estados interativos (hover/focus) nao sao possiveis com style inline, entao
// os componentes clicaveis usam classes com o prefixo krdoc-.
const documentationCss = `
  .krdoc-input:focus {
    outline: none;
    border-color: var(--kr-accent);
    box-shadow: 0 0 0 3px var(--kr-focus-ring);
  }
  .krdoc-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    color: var(--kr-muted);
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-tab:hover {
    background: var(--kr-card-hover);
    color: var(--kr-text-strong);
  }
  .krdoc-tab-active,
  .krdoc-tab-active:hover {
    background: var(--kr-primary-strong);
    border-color: var(--kr-primary-strong);
    color: var(--kr-primary-text);
  }
  .krdoc-ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    color: var(--kr-text-strong);
    border-radius: 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-ghost-btn:hover {
    background: var(--kr-card-hover);
    border-color: var(--kr-accent);
  }
  .krdoc-check {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin: 2px 0 0 0;
    accent-color: var(--kr-accent);
    cursor: pointer;
  }
  .krdoc-task {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    transition: border-color 0.12s ease;
  }
  .krdoc-task:hover {
    border-color: var(--kr-accent);
  }
  .krdoc-task-done {
    border-color: var(--kr-success-border);
    background: var(--kr-success-soft);
  }
  .krdoc-nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--kr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-nav-item:hover {
    background: var(--kr-card-hover);
  }
  .krdoc-nav-item-active,
  .krdoc-nav-item-active:hover {
    background: var(--kr-accent-soft);
    border-color: var(--kr-accent-border);
  }
  .krdoc-step {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    cursor: pointer;
    transition: border-color 0.12s ease;
  }
  .krdoc-step:hover {
    border-color: var(--kr-accent);
  }
  .krdoc-step-done {
    border-color: var(--kr-success-border);
    background: var(--kr-success-soft);
  }
  .krdoc-chip {
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface);
    color: var(--kr-muted);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .krdoc-chip:hover {
    color: var(--kr-text-strong);
    border-color: var(--kr-accent);
  }
  .krdoc-chip-active,
  .krdoc-chip-active:hover {
    background: var(--kr-accent-soft);
    border-color: var(--kr-accent-border);
    color: var(--kr-info-text);
  }
  .krdoc-faq-item {
    border: 1px solid var(--kr-border);
    border-radius: 12px;
    background: var(--kr-surface-soft);
    overflow: hidden;
  }
  .krdoc-faq-question {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 11px 12px;
    border: none;
    background: transparent;
    color: var(--kr-text-strong);
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
  }
  .krdoc-faq-question:hover {
    background: var(--kr-card-hover);
  }
  .krdoc-result,
  .krdoc-problem-card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 11px 12px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    color: var(--kr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease;
  }
  .krdoc-result:hover,
  .krdoc-problem-card:hover {
    border-color: var(--kr-accent);
    background: var(--kr-card-hover);
  }
  .krdoc-flow-stage {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid var(--kr-border);
    background: var(--kr-surface-soft);
    color: var(--kr-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease;
  }
  .krdoc-flow-stage:hover {
    border-color: var(--kr-accent);
  }
`;

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "12px",
    minHeight: 0,
    alignContent: "start"
  },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    padding: "10px 12px",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  searchLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    color: "var(--kr-text-strong)",
    fontWeight: 800,
    fontSize: "13px",
    flexShrink: 0
  },
  searchInput: {
    flex: 1,
    minWidth: "220px",
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "9px 11px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  searchCount: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    fontWeight: 700,
    flexShrink: 0
  },
  clearButton: {
    padding: "8px 11px",
    flexShrink: 0
  },
  tabBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px"
  },
  resultGroup: {
    display: "grid",
    gap: "10px",
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  resultGroupTitle: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  resultList: {
    display: "grid",
    gap: "6px"
  },
  resultIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0
  },
  resultText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "13px",
    lineHeight: 1.4
  },
  resultKind: {
    color: "var(--kr-muted)",
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.07em",
    textTransform: "uppercase"
  },
  resultSnippet: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    lineHeight: 1.45
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    alignItems: "center",
    justifyContent: "center",
    padding: "30px 26px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.5,
    textAlign: "center"
  },
  emptyTitle: {
    color: "var(--kr-text-strong)",
    fontSize: "14px"
  },
  startGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "12px",
    alignItems: "start"
  },
  panel: {
    display: "grid",
    gap: "12px",
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)",
    alignContent: "start"
  },
  panelHeader: {
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
  panelTitle: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "16px"
  },
  panelDescription: {
    margin: "4px 0 0 0",
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.45
  },
  cardEyebrow: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase"
  },
  progressBadge: {
    flexShrink: 0,
    padding: "4px 10px",
    borderRadius: "999px",
    background: "var(--kr-accent-soft)",
    border: "1px solid var(--kr-accent-border)",
    color: "var(--kr-info-text)",
    fontSize: "12px",
    fontWeight: 900
  },
  progressTrack: {
    height: "8px",
    borderRadius: "999px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    borderRadius: "999px",
    background: "var(--kr-accent)",
    transition: "width 0.25s ease"
  },
  taskList: {
    display: "grid",
    gap: "8px",
    margin: 0,
    padding: 0,
    listStyle: "none"
  },
  taskLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    flex: 1,
    minWidth: 0,
    cursor: "pointer"
  },
  taskText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0
  },
  taskTitle: {
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  taskTitleDone: {
    color: "var(--kr-muted)",
    fontSize: "13px",
    textDecoration: "line-through"
  },
  taskDescription: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    lineHeight: 1.4
  },
  taskGuideButton: {
    padding: "6px 9px",
    flexShrink: 0,
    alignSelf: "center"
  },
  flowList: {
    display: "grid",
    gap: "4px",
    margin: 0,
    padding: 0,
    listStyle: "none"
  },
  flowItem: {
    display: "grid",
    gap: "4px"
  },
  flowStep: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    borderRadius: "999px",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    fontSize: "12px",
    fontWeight: 900,
    flexShrink: 0,
    marginTop: "4px"
  },
  flowIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0
  },
  flowText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    fontSize: "13px",
    lineHeight: 1.4,
    minWidth: 0
  },
  flowConnector: {
    width: "2px",
    height: "10px",
    marginLeft: "20px",
    background: "var(--kr-border)"
  },
  startHintCard: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "var(--kr-info-bg)",
    border: "1px solid var(--kr-info-border)",
    color: "var(--kr-info-text)",
    fontSize: "12px",
    lineHeight: 1.45
  },
  guidesGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
    gap: "12px",
    alignItems: "start"
  },
  guideNav: {
    position: "sticky",
    top: 0,
    display: "grid",
    gap: "4px",
    padding: "8px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)"
  },
  navIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "10px",
    background: "var(--kr-info-bg)",
    color: "var(--kr-info-text)",
    flexShrink: 0
  },
  navText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    fontSize: "12px",
    lineHeight: 1.35
  },
  guideContent: {
    display: "grid",
    gap: "12px",
    padding: "14px",
    borderRadius: "16px",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    boxShadow: "var(--kr-shadow)",
    alignContent: "start",
    minWidth: 0
  },
  guideStepsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap"
  },
  guideStepsMeta: {
    display: "flex",
    alignItems: "center",
    gap: "8px"
  },
  guideStepsCount: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    fontWeight: 700
  },
  resetButton: {
    padding: "5px 9px"
  },
  guideStepList: {
    display: "grid",
    gap: "6px",
    margin: 0,
    padding: 0,
    listStyle: "none"
  },
  stepNumber: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "999px",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    fontSize: "11px",
    fontWeight: 900,
    flexShrink: 0,
    marginTop: "1px"
  },
  stepText: {
    flex: 1,
    minWidth: 0,
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.5
  },
  stepTextDone: {
    flex: 1,
    minWidth: 0,
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.5,
    textDecoration: "line-through"
  },
  blockTitle: {
    margin: 0,
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  detailBox: {
    display: "grid",
    gap: "8px",
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
  guidePager: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap"
  },
  pagerButton: {
    padding: "8px 11px"
  },
  categoryRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px"
  },
  faqList: {
    display: "grid",
    gap: "8px"
  },
  faqQuestionText: {
    flex: 1,
    minWidth: 0
  },
  faqAnswerBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "8px",
    padding: "0 12px 11px 12px"
  },
  faqAnswer: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "13px",
    lineHeight: 1.5
  },
  faqGuideButton: {
    padding: "6px 10px"
  },
  flowGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "8px"
  },
  backButton: {
    justifySelf: "start",
    padding: "7px 10px"
  },
  troubleshootHint: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "12px"
  },
  escalationBox: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "14px",
    background: "var(--kr-warning-soft)",
    border: "1px solid var(--kr-warning-border)",
    color: "var(--kr-warning)"
  },
  escalationTitle: {
    display: "block",
    fontSize: "13px"
  },
  escalationText: {
    margin: "4px 0 10px 0",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.5
  },
  glossaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "8px"
  },
  glossaryItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "5px",
    padding: "11px 12px",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)"
  },
  glossaryTerm: {
    color: "var(--kr-text-strong)",
    fontSize: "13px"
  },
  glossaryDefinition: {
    color: "var(--kr-muted)",
    fontSize: "12px",
    lineHeight: 1.5
  },
  glossaryLink: {
    padding: "5px 9px",
    fontSize: "11px"
  },
  supportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "12px",
    alignItems: "start"
  },
  copyButton: {
    padding: "8px 11px",
    flexShrink: 0
  },
  checklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "8px"
  },
  checklistItem: {
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    padding: "10px",
    borderRadius: "12px",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)",
    color: "var(--kr-text)",
    fontSize: "13px",
    lineHeight: 1.4
  },
  supportFootnote: {
    margin: 0,
    color: "var(--kr-muted)",
    fontSize: "12px"
  }
};
