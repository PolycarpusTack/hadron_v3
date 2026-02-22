import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { error as logError, attachConsole } from "@tauri-apps/plugin-log";
import "./styles.css";

// Forward uncaught JS errors to persistent Rust log file
window.onerror = (message, source, lineno, colno, err) => {
  const detail = `${message} at ${source}:${lineno}:${colno}`;
  logError(`[JS] Uncaught error: ${detail}${err?.stack ? `\n${err.stack}` : ""}`);
};

window.onunhandledrejection = (event) => {
  const reason = event.reason;
  const detail = reason instanceof Error
    ? `${reason.message}\n${reason.stack || ""}`
    : String(reason);
  logError(`[JS] Unhandled rejection: ${detail}`);
};

// Attach console bridge so console.log/warn/error also go to the log file
attachConsole();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
