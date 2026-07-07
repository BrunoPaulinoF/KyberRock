/**
 * Configuracao do canal de atualizacao (GitHub Releases).
 *
 * O repositorio KyberRock e privado, entao o `electron-updater` precisa de um
 * token para ler e baixar os assets do release. O token abaixo e injetado pelo
 * pipeline `.github/workflows/desktop-release.yml` no momento do build, a partir
 * do secret `GH_UPDATER_TOKEN`.
 *
 * IMPORTANTE:
 * - NUNCA commitar um token real aqui — o valor fica vazio no repositorio e so e
 *   preenchido no build do CI.
 * - Use um token **fine-grained** com escopo apenas neste repositorio e permissao
 *   somente de leitura (`Contents: read`). Assim, se o token for extraido do app
 *   instalado, o impacto se limita a ler os releases deste repo.
 * - Em dev/local (`app.isPackaged === false`) o updater nem roda, entao o token
 *   vazio nao atrapalha.
 */
export const GITHUB_UPDATER_OWNER = "BrunoPaulinoF";
export const GITHUB_UPDATER_REPO = "KyberRock";
export const GITHUB_UPDATER_TOKEN = "";
