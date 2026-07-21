// Documento estatico (guia de instalacao/configuracao + manual de uso) servido a
// partir de `apps/loader-web/public`. O Vite copia o arquivo para o build e o
// nginx do loader-web o entrega em `/<arquivo>`. O atributo `download` do link
// faz o navegador salvar o PDF no computador do usuario.
export const documentationFileName = "guia-kyberrock-instalacao-e-uso.pdf";

export const documentationUrl = `/${documentationFileName}`;
