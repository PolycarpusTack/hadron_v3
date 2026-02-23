import React from "react";
import ReactDOM from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { getMsalInstance } from "./auth/msal";
import App from "./App";
import "./index.css";

async function bootstrap() {
  const devMode = import.meta.env.VITE_AUTH_MODE === "dev";

  if (devMode) {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } else {
    const msalInstance = await getMsalInstance();
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <MsalProvider instance={msalInstance}>
          <App />
        </MsalProvider>
      </React.StrictMode>,
    );
  }
}

bootstrap();
