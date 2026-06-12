import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./themes/ThemeContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { ToastProvider } from "./components/ui/Toast";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <WorkspaceProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
