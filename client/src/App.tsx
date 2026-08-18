/** 设计提醒：数字打字机日记——站点结构保持极简，让读者始终拥有清晰的回退和浏览路径。 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Article from "@/pages/Article";
import About from "@/pages/About";
import Home from "@/pages/Home";
import Posts from "@/pages/Posts";
import SearchPage from "@/pages/SearchPage";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";

function App() {
  return <ErrorBoundary><TooltipProvider><Toaster /><Switch><Route path="/" component={Home} /><Route path="/posts" component={Posts} /><Route path="/posts/:slug" component={Article} /><Route path="/about" component={About} /><Route path="/search" component={SearchPage} /><Route component={Posts} /></Switch></TooltipProvider></ErrorBoundary>;
}

export default App;
