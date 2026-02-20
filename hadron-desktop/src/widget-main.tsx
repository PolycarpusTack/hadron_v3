import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./components/ErrorBoundary";
import WidgetApp from "./components/widget/WidgetApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <WidgetApp />
    </AppErrorBoundary>
  </React.StrictMode>
);
