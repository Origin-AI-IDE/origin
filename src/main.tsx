import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./themes/ThemeContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { ToastProvider } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { DebugProvider } from "./context/DebugContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <WorkspaceProvider>
          <ToastProvider>
            <DebugProvider>
              <App />
            </DebugProvider>
          </ToastProvider>
        </WorkspaceProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
