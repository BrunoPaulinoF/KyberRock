import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, openSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ensureDesktopDataDirectories, type DesktopDataPaths } from "./paths.js";

/**
 * SID fixo do grupo local "Usuarios" (BUILTIN\Users). Usamos o SID, e nao o nome,
 * porque o Windows em portugues chama o grupo de "Usuarios" e o icacls falharia
 * ao receber o nome em ingles.
 */
const LOCAL_USERS_GROUP_SID = "*S-1-5-32-545";

/**
 * Falha de permissao na pasta de dados. Diferente das demais, esta e escrita para o
 * operador da balanca: `main.ts` mostra a mensagem sem stack, porque quem le e a
 * pessoa da pedreira e nao um desenvolvedor.
 */
export class DesktopDataAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopDataAccessError";
  }
}

export function isDesktopDataAccessError(error: unknown): error is DesktopDataAccessError {
  return error instanceof DesktopDataAccessError;
}

/**
 * Garante que a pasta de dados existe E que o usuario do Windows que abriu o app
 * consegue gravar nela.
 *
 * O banco vive em `%ProgramData%\KyberRock` de proposito: e a mesma base para todos
 * os usuarios da maquina da balanca. O efeito colateral e a ACL padrao do ProgramData
 * — quem cria a pasta vira dono e ganha controle total (CREATOR OWNER), enquanto os
 * demais usuarios herdam apenas leitura. Se a instalacao/primeira execucao foi feita
 * por outro usuario (o tecnico, ou "executar como administrador"), a operadora abre o
 * app e o SQLite responde "attempt to write a readonly database" ja no primeiro INSERT.
 *
 * Por isso: ao CRIAR a pasta damos controle total ao grupo Usuarios (podemos, somos o
 * dono naquele instante) e, quando a pasta ja existe sem permissao, tentamos o mesmo
 * reparo antes de desistir. So se o reparo tambem falhar — caso tipico de a operadora
 * nao ser dona da pasta — a mensagem com o comando administrativo sobe para a tela.
 */
export function ensureDesktopDataAccess(paths: DesktopDataPaths): void {
  const rootExisted = existsSync(paths.rootDirectory);

  ensureDesktopDataDirectories(paths);

  if (!rootExisted) {
    grantLocalUsersFullControl(paths.rootDirectory);
  }

  const failure = probeWriteAccess(paths);
  if (!failure) return;

  clearReadOnlyAttributes(paths.databasePath);
  grantLocalUsersFullControl(paths.rootDirectory);

  const remaining = probeWriteAccess(paths);
  if (!remaining) return;

  throw new DesktopDataAccessError(buildOperatorMessage(paths, remaining));
}

/**
 * Escreve de fato para saber se da para escrever. `fs.accessSync(W_OK)` nao serve no
 * Windows: ele so olha o atributo somente-leitura do arquivo e ignora a ACL, que e
 * exatamente o que quebra aqui.
 *
 * A pasta e testada junto com o arquivo porque o WAL cria `-wal`/`-shm` ao lado do
 * banco: sem permissao na pasta, um banco gravavel ainda assim nao abre para escrita.
 */
function probeWriteAccess(paths: DesktopDataPaths): string | null {
  const probePath = path.join(paths.dataDirectory, ".kyberrock-write-probe");
  try {
    writeFileSync(probePath, "");
    rmSync(probePath, { force: true });
  } catch (error) {
    return describeError(error);
  }

  if (!existsSync(paths.databasePath)) return null;

  try {
    const handle = openSync(paths.databasePath, "r+");
    closeSync(handle);
  } catch (error) {
    return describeError(error);
  }

  return null;
}

/** Concede controle total ao grupo Usuarios na arvore de dados. Best-effort. */
function grantLocalUsersFullControl(rootDirectory: string): void {
  if (process.platform !== "win32") return;

  try {
    execFileSync(
      "icacls",
      [rootDirectory, "/grant", `${LOCAL_USERS_GROUP_SID}:(OI)(CI)F`, "/T", "/C", "/Q"],
      { stdio: "ignore", windowsHide: true, timeout: 30_000 }
    );
  } catch {
    // Sem ser dono da pasta nao da para reescrever a ACL; a mensagem ao operador cobre o caso.
  }
}

/**
 * Tira o atributo somente-leitura do banco e dos arquivos do WAL. Acontece quando o
 * banco chega copiado de um pendrive ou restaurado de um backup.
 */
function clearReadOnlyAttributes(databasePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${databasePath}${suffix}`;
    if (!existsSync(target)) continue;
    try {
      chmodSync(target, 0o666);
    } catch {
      // Best-effort: o proximo probe decide se o app abre ou nao.
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

function buildOperatorMessage(paths: DesktopDataPaths, detail: string): string {
  const command = `icacls "${paths.rootDirectory}" /grant ${LOCAL_USERS_GROUP_SID}:(OI)(CI)F /T`;

  return [
    "Sem permissao para gravar no banco de dados local.",
    "",
    "O KyberRock guarda as operacoes em:",
    paths.databasePath,
    "",
    "O usuario do Windows aberto agora consegue ler essa pasta, mas nao gravar.",
    "Isso acontece quando o aplicativo foi instalado ou aberto pela primeira vez",
    "com outro usuario do Windows (ou com 'executar como administrador').",
    "",
    "Para liberar, abra o Prompt de Comando COMO ADMINISTRADOR e rode:",
    "",
    command,
    "",
    "Depois abra o KyberRock novamente. Nenhum dado e perdido: as operacoes ja",
    "gravadas continuam no arquivo acima.",
    "",
    `Detalhe tecnico: ${detail}`
  ].join("\n");
}
