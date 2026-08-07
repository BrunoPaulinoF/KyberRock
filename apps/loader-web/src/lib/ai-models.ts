// ---------------------------------------------------------------------------
// Modelos oferecidos no seletor do painel administrativo.
//
// A lista e de INTERFACE, nao de validacao: o `admin-api` aceita qualquer texto
// nao vazio como modelo. Isso e proposital — a OpenAI lanca modelo novo com
// frequencia, e uma lista fechada no backend transformaria "quero usar o modelo
// que saiu ontem" em deploy. Aqui a lista so evita que alguem digite o nome
// errado no dia a dia; a opcao "Outro" continua abrindo a porta.
//
// A tarefa do assistente e reescrever em linguagem natural os trechos que o
// desktop ja selecionou, com um briefing do sistema para o que a documentacao
// nao cobre. Isso pesa mais em seguir instrucao do que em raciocinio profundo,
// entao os modelos pequenos entregam bem — por isso o padrao e um deles.
// ---------------------------------------------------------------------------

export interface AiModelOption {
  id: string;
  label: string;
  hint: string;
}

/** Valor do <select> que libera o campo de texto livre. */
export const AI_MODEL_CUSTOM = "__custom__";

export const DEFAULT_AI_MODEL = "gpt-4.1-mini";

export const AI_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini (recomendado)",
    hint: "Melhor equilibrio para o assistente: segue bem as instrucoes, responde rapido e custa pouco."
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    hint: "Mais capaz nas perguntas complicadas, com custo e tempo de resposta maiores."
  },
  {
    id: "gpt-4.1-nano",
    label: "GPT-4.1 nano",
    hint: "O mais barato e rapido. Bom para duvidas simples; erra mais nas que exigem raciocinio."
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    hint: "Geracao anterior do modelo pequeno. Use se a conta ainda nao tiver acesso aos GPT-4.1."
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    hint: "Geracao anterior do modelo grande."
  }
];

export function isKnownAiModel(model: string): boolean {
  return AI_MODEL_OPTIONS.some((option) => option.id === model);
}

export function findAiModelHint(model: string): string {
  return AI_MODEL_OPTIONS.find((option) => option.id === model)?.hint ?? "";
}
