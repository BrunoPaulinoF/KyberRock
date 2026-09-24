import "./documentation.css";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  Rocket,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Wrench,
  X
} from "lucide-react";

import {
  buildSupportClipboardText,
  documentationFaqCategories,
  documentationGlossary,
  documentationSections,
  operationFlowStages,
  quickStartTasks,
  supportChecklist,
  troubleshootingFlows,
  type DocumentationFaqCategory,
  type DocumentationTabId
} from "../lib/documentation-content";
import {
  filterFaqsByCategory,
  searchDocumentation,
  type DocumentationSearchResult
} from "../lib/documentation-search";

// ---------------------------------------------------------------------------
// Central de ajuda do KyberRock — a tela "Documentacao" do desktop
// (`apps/desktop/src/renderer/DocumentationView.tsx`), com as mesmas seis areas (Comecar, Guias,
// Duvidas, Diagnostico, Glossario e Suporte) e a mesma busca global.
//
// O conteudo e a busca sao COPIAS dos arquivos do desktop (`lib/documentation-content.ts` e
// `lib/documentation-search.ts`); `lib/documentation-sync.test.ts` falha se divergirem. Corrigir
// um texto de ajuda e corrigir la e copiar para ca.
//
// De fora: o assistente flutuante de IA. A Edge Function `docs-assistant` so aceita o token da
// BALANCA (`deviceId`/`deviceToken`), nao o login do site.
// ---------------------------------------------------------------------------

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

export function Documentation() {
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

  return (
    <section className="krdoc-page" aria-labelledby="documentation-title">
      <div className="krdoc-search-bar">
        <label className="krdoc-search-label" htmlFor="documentation-search">
          <Search size={15} />
          <span id="documentation-title">Buscar na documentacao</span>
        </label>
        <input
          id="documentation-search"
          ref={searchInputRef}
          className="krdoc-input"
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
            <span className="krdoc-search-count">
              {searchResults.length} {searchResults.length === 1 ? "resultado" : "resultados"}
            </span>
            <button
              type="button"
              className="krdoc-ghost-btn"
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

      <nav aria-label="Areas da documentacao" className="krdoc-tab-bar" role="tablist">
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
      <section className="krdoc-empty-state" aria-live="polite">
        <Search size={22} />
        <strong className="krdoc-empty-title">
          Nada encontrado para &ldquo;{query.trim()}&rdquo;
        </strong>
        {/* O desktop ainda sugere o assistente do canto da tela, que o site nao tem. */}
        <span>
          Tente outras palavras (por exemplo &ldquo;nota&rdquo; em vez de &ldquo;NF&rdquo;), ou abra
          a aba Suporte para saber o que enviar ao suporte.
        </span>
        <button type="button" className="krdoc-ghost-btn" onClick={onClear}>
          <X size={13} />
          Limpar busca
        </button>
      </section>
    );
  }

  return (
    <section className="krdoc-result-group" aria-live="polite" aria-label="Resultados da busca">
      <h2 className="krdoc-result-group-title">
        <Search size={15} />
        Resultados para &ldquo;{query.trim()}&rdquo;
      </h2>
      <div className="krdoc-result-list">
        {results.map((result) => {
          const Icon = RESULT_KIND_ICON[result.kind];
          return (
            <button
              key={`${result.kind}-${result.id}`}
              type="button"
              className="krdoc-result"
              onClick={() => onOpenResult(result)}
            >
              <span className="krdoc-result-icon">
                <Icon size={17} />
              </span>
              <span className="krdoc-result-text">
                <span className="krdoc-result-kind">{RESULT_KIND_LABEL[result.kind]}</span>
                <strong>{result.title}</strong>
                <small className="krdoc-result-snippet">{result.snippet}</small>
              </span>
              <ArrowRight size={15} className="krdoc-shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pecas comuns
// ---------------------------------------------------------------------------

function PanelHeader({
  icon: Icon,
  titleId,
  title,
  description,
  eyebrow,
  children
}: {
  icon: LucideIcon;
  titleId: string;
  title: string;
  description: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <div className="krdoc-panel-header">
      <span className="krdoc-header-icon">
        <Icon size={18} />
      </span>
      <div className="krdoc-panel-header-text">
        {eyebrow ? <p className="krdoc-card-eyebrow">{eyebrow}</p> : null}
        <h2 id={titleId} className="krdoc-panel-title">
          {title}
        </h2>
        <p className="krdoc-panel-description">{description}</p>
      </div>
      {children}
    </div>
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
    <div className="krdoc-start-grid">
      <section className="krdoc-panel" aria-labelledby="quickstart-title">
        <PanelHeader
          icon={Rocket}
          titleId="quickstart-title"
          title="Preparacao da unidade"
          description="Marque cada etapa concluida. O progresso fica salvo neste computador."
        >
          <span className="krdoc-progress-badge">
            {doneCount}/{quickStartTasks.length}
          </span>
        </PanelHeader>
        <div
          className="krdoc-progress-track"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da preparacao"
        >
          <div className="krdoc-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <ul className="krdoc-task-list">
          {quickStartTasks.map((task) => {
            const done = doneTasks.includes(task.id);
            return (
              <li key={task.id}>
                <div className={done ? "krdoc-task krdoc-task-done" : "krdoc-task"}>
                  <label className="krdoc-task-label">
                    <input
                      type="checkbox"
                      className="krdoc-check"
                      checked={done}
                      onChange={() => onToggleTask(task.id)}
                    />
                    <span className="krdoc-task-text">
                      <strong className="krdoc-task-title">{task.label}</strong>
                      <small className="krdoc-task-description">{task.description}</small>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="krdoc-ghost-btn krdoc-btn-sm"
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

      <section className="krdoc-panel" aria-labelledby="flow-title">
        <PanelHeader
          icon={Truck}
          titleId="flow-title"
          title="Ciclo de uma pesagem"
          description="Toda operacao passa por estas etapas. Clique em uma etapa para abrir o guia."
        />
        <ol className="krdoc-flow-list">
          {operationFlowStages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <li key={stage.id} className="krdoc-flow-item">
                <button
                  type="button"
                  className="krdoc-flow-stage"
                  onClick={() => onOpenGuide(stage.sectionId)}
                >
                  <span className="krdoc-flow-step">{index + 1}</span>
                  <span className="krdoc-flow-icon">
                    <Icon size={17} />
                  </span>
                  <span className="krdoc-flow-text">
                    <strong>{stage.title}</strong>
                    <small>{stage.description}</small>
                  </span>
                </button>
                {index < operationFlowStages.length - 1 ? (
                  <span className="krdoc-flow-connector" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="krdoc-hint-card">
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

  return (
    <div className="krdoc-guides-grid">
      <nav aria-label="Guias disponiveis" className="krdoc-guide-nav">
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
              <span className="krdoc-nav-icon">
                <SectionIcon size={16} />
              </span>
              <span className="krdoc-nav-text">
                <strong>{section.title}</strong>
                <small>{section.eyebrow}</small>
              </span>
              {completed ? <CheckCircle2 size={15} className="krdoc-nav-done" /> : null}
            </button>
          );
        })}
      </nav>

      <article className="krdoc-panel" aria-labelledby={`guide-${activeSection.id}`}>
        <PanelHeader
          icon={activeSection.icon}
          titleId={`guide-${activeSection.id}`}
          eyebrow={activeSection.eyebrow}
          title={activeSection.title}
          description={activeSection.summary}
        />

        <div className="krdoc-guide-steps-header">
          <h3 className="krdoc-block-title">Passo a passo</h3>
          <div className="krdoc-guide-steps-meta">
            <span className="krdoc-guide-steps-count">
              {doneCount} de {activeSection.steps.length} passos conferidos
            </span>
            {doneCount > 0 ? (
              <button
                type="button"
                className="krdoc-ghost-btn krdoc-btn-xs"
                onClick={() => onResetSteps(activeSection.id)}
              >
                <RotateCcw size={13} />
                Reiniciar
              </button>
            ) : null}
          </div>
        </div>

        <ol className="krdoc-step-list">
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
                  <span className="krdoc-step-number">{index + 1}</span>
                  <span className="krdoc-step-text">{step}</span>
                </label>
              </li>
            );
          })}
        </ol>

        <div className="krdoc-detail-box">
          <h3 className="krdoc-block-title">Pontos importantes</h3>
          <ul className="krdoc-detail-list">
            {activeSection.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </div>

        <div className="krdoc-guide-pager">
          {previousSection ? (
            <button
              type="button"
              className="krdoc-ghost-btn"
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
    <section className="krdoc-panel" aria-labelledby="faq-title">
      <PanelHeader
        icon={HelpCircle}
        titleId="faq-title"
        title="Duvidas comuns"
        description="Clique em uma pergunta para ver a resposta. Filtre por assunto, ou use a busca la em cima para procurar pela frase inteira."
      />

      <div className="krdoc-category-row" role="group" aria-label="Filtrar duvidas por assunto">
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

      <div className="krdoc-faq-list">
        {faqs.map((faq) => {
          const expanded = expandedQuestion === faq.question;
          const sectionId = faq.sectionId;
          return (
            <div key={faq.question} className="krdoc-faq-item">
              <button
                type="button"
                className="krdoc-faq-question"
                aria-expanded={expanded}
                onClick={() => onToggleQuestion(faq.question)}
              >
                <span className="krdoc-faq-question-text">{faq.question}</span>
                <ChevronDown size={16} className="krdoc-faq-chevron" />
              </button>
              {expanded ? (
                <div className="krdoc-faq-answer-box">
                  <p className="krdoc-faq-answer">{faq.answer}</p>
                  {sectionId ? (
                    <button
                      type="button"
                      className="krdoc-ghost-btn krdoc-btn-faq"
                      onClick={() => onOpenGuide(sectionId)}
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
      <section className="krdoc-panel" aria-labelledby="troubleshoot-title">
        <PanelHeader
          icon={Wrench}
          titleId="troubleshoot-title"
          title="Diagnostico guiado"
          description="Escolha o problema que esta acontecendo para seguir as verificacoes na ordem certa."
        />
        <div className="krdoc-flow-grid">
          {troubleshootingFlows.map((flow) => {
            const Icon = flow.icon;
            return (
              <button
                key={flow.id}
                type="button"
                className="krdoc-problem-card"
                onClick={() => onSelectFlow(flow.id)}
              >
                <span className="krdoc-result-icon">
                  <Icon size={17} />
                </span>
                <span className="krdoc-result-text">
                  <strong>{flow.title}</strong>
                  <small>{flow.symptom}</small>
                </span>
                <ArrowRight size={15} className="krdoc-shrink-0" />
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  const flowDone = doneChecks[activeFlow.id] ?? [];

  const toggleCheck = (index: number) => {
    setDoneChecks((current) => {
      const done = current[activeFlow.id] ?? [];
      const next = done.includes(index) ? done.filter((item) => item !== index) : [...done, index];
      return { ...current, [activeFlow.id]: next };
    });
  };

  return (
    <section className="krdoc-panel" aria-labelledby="troubleshoot-flow-title">
      <button
        type="button"
        className="krdoc-ghost-btn krdoc-btn-back"
        onClick={() => onSelectFlow(null)}
      >
        <ArrowLeft size={14} />
        Todos os problemas
      </button>

      <PanelHeader
        icon={activeFlow.icon}
        titleId="troubleshoot-flow-title"
        title={activeFlow.title}
        description={activeFlow.symptom}
      />

      <p className="krdoc-troubleshoot-hint">
        Siga as verificacoes na ordem e marque as que ja fez. Teste o sistema apos cada passo.
      </p>

      <ol className="krdoc-step-list">
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
                <span className="krdoc-step-number">{index + 1}</span>
                <span className="krdoc-step-text">{check}</span>
              </label>
            </li>
          );
        })}
      </ol>

      <div className="krdoc-escalation-box">
        <AlertTriangle size={16} className="krdoc-escalation-icon" />
        <div className="krdoc-panel-header-text">
          <strong className="krdoc-escalation-title">Nao resolveu?</strong>
          <p className="krdoc-escalation-text">{activeFlow.escalation}</p>
          <button type="button" className="krdoc-ghost-btn" onClick={onOpenSupport}>
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
    <section className="krdoc-panel" aria-labelledby="glossary-title">
      <PanelHeader
        icon={BookMarked}
        titleId="glossary-title"
        title="Glossario"
        description="O que cada termo do sistema quer dizer, na linguagem da pedreira."
      />
      <div className="krdoc-glossary-grid">
        {documentationGlossary.map((entry) => {
          const sectionId = entry.sectionId;
          return (
            <div key={entry.term} className="krdoc-glossary-item">
              <strong className="krdoc-glossary-term">{entry.term}</strong>
              <span className="krdoc-glossary-definition">{entry.definition}</span>
              {sectionId ? (
                <button
                  type="button"
                  className="krdoc-ghost-btn krdoc-btn-glossary"
                  onClick={() => onOpenGuide(sectionId)}
                >
                  Ver guia
                  <ArrowRight size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
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
      // Fallback para contextos sem a Clipboard API (ex.: pagina fora de HTTPS).
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

  // O cartao "Assistente da documentacao" do desktop fica de fora: ele descreve o chat do
  // canto da tela, que o site nao tem (a `docs-assistant` so aceita o token da balanca).
  return (
    <div className="krdoc-support-grid">
      <section className="krdoc-panel" aria-labelledby="support-title">
        <PanelHeader
          icon={LifeBuoy}
          titleId="support-title"
          title="Antes de chamar o suporte"
          description="Colete estas informacoes para acelerar o diagnostico do problema."
        >
          <button type="button" className="krdoc-ghost-btn" onClick={() => void copyChecklist()}>
            {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            {copied ? "Copiado!" : "Copiar modelo"}
          </button>
        </PanelHeader>
        <div className="krdoc-checklist-grid">
          {supportChecklist.map((item) => (
            <div key={item} className="krdoc-checklist-item">
              <CheckCircle2 size={16} className="krdoc-checklist-icon" />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p className="krdoc-support-footnote">
          O botao Copiar modelo gera um texto pronto para preencher e enviar ao suporte por e-mail
          ou mensagem.
        </p>
      </section>

      <section className="krdoc-panel" aria-labelledby="logs-title">
        <PanelHeader
          icon={Settings}
          titleId="logs-title"
          title="Onde encontrar os logs"
          description="Os logs ajudam o suporte a entender exatamente o que aconteceu."
        />
        <ul className="krdoc-detail-list">
          <li>
            <strong>Erros recentes:</strong> use o botao de logs no menu da engrenagem (F10) para
            ver falhas de sincronizacao, balanca e impressao.
          </li>
          <li>
            <strong>Desktop nao abre:</strong> consulte o arquivo startup.log em AppData Local, na
            pasta do KyberRock Desktop.
          </li>
          <li>
            <strong>Faturamento recusado:</strong> copie tambem a mensagem exibida pelo OMIE — e ela
            que nomeia o campo que faltou no cadastro.
          </li>
          <li>
            <strong>Antes de reinstalar:</strong> sempre faca backup do banco local. A operacao
            fechada nunca deve ser perdida.
          </li>
        </ul>
        <div className="krdoc-hint-card">
          <ShieldCheck size={16} />
          <span>
            Nunca envie chaves do OMIE, senhas ou o arquivo do banco de dados por canais inseguros.
          </span>
        </div>
      </section>
    </div>
  );
}
