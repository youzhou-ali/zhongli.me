import { createRoot } from "react-dom/client";
import { installPostBrowserBackTransition } from "@/lib/postTransition";
import App from "./App";
import "./index.css";

installPostBrowserBackTransition();
createRoot(document.getElementById("root")!).render(<App />);
