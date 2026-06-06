import { loaderWebAppInfo } from "./app-info";

export function App() {
  return (
    <main>
      <h1>{loaderWebAppInfo.name}</h1>
      <p>Portal online do carregador para visualizacao de carregamentos em aberto.</p>
    </main>
  );
}
