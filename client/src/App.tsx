/** 站点结构保持极简；非首屏页面按需加载，减少首次访问需要下载和解析的 JavaScript。 */
import { lazy, Suspense } from "react";
import Article from "@/pages/Article";
import Home from "@/pages/Home";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";

const Posts = lazy(() => import("@/pages/Posts"));
const About = lazy(() => import("@/pages/About"));
const SearchPage = lazy(() => import("@/pages/SearchPage"));

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<main className="site-rail page-loading" aria-live="polite">正在加载…</main>}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/posts" component={Posts} />
          <Route path="/posts/:slug" component={Article} />
          <Route path="/about" component={About} />
          <Route path="/search" component={SearchPage} />
          <Route component={Posts} />
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
