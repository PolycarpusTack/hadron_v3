/**
 * Azure AD / MSAL.js configuration for Hadron Web.
 *
 * Environment variables:
 *   VITE_AZURE_CLIENT_ID — Azure AD app registration client ID
 *   VITE_AZURE_TENANT_ID — Azure AD tenant ID
 *   VITE_AZURE_REDIRECT_URI — OAuth redirect URI (default: window.location.origin)
 */

import {
  PublicClientApplication,
  Configuration,
  LogLevel,
  AccountInfo,
  AuthenticationResult,
  InteractionRequiredAuthError,
} from "@azure/msal-browser";

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;
const redirectUri =
  import.meta.env.VITE_AZURE_REDIRECT_URI || window.location.origin;

if (!clientId || !tenantId) {
  console.warn(
    "Azure AD not configured. Set VITE_AZURE_CLIENT_ID and VITE_AZURE_TENANT_ID.",
  );
}

const msalConfig: Configuration = {
  auth: {
    clientId: clientId || "not-configured",
    authority: `https://login.microsoftonline.com/${tenantId || "common"}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (_level, message) => {
        console.debug("[MSAL]", message);
      },
    },
  },
};

// Scopes for the Hadron API
const apiScopes = [`api://${clientId}/access_as_user`];

// MSAL instance (singleton)
let msalInstance: PublicClientApplication | null = null;

export async function getMsalInstance(): Promise<PublicClientApplication> {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    // Handle redirect response (if returning from Azure AD login)
    await msalInstance.handleRedirectPromise();
  }
  return msalInstance;
}

/** Get the currently signed-in account, or null. */
export function getActiveAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  const accounts = msalInstance.getAllAccounts();
  return accounts.length > 0 ? accounts[0] : null;
}

/** Initiate login via redirect. */
export async function login(): Promise<void> {
  const instance = await getMsalInstance();
  await instance.loginRedirect({
    scopes: apiScopes,
  });
}

/** Sign out and redirect. */
export async function logout(): Promise<void> {
  const instance = await getMsalInstance();
  await instance.logoutRedirect();
}

/**
 * Acquire an access token silently, falling back to redirect if needed.
 * Returns the token string for use in Authorization headers.
 */
export async function acquireToken(): Promise<string> {
  const instance = await getMsalInstance();
  const account = getActiveAccount();

  if (!account) {
    throw new Error("No active account — user must log in");
  }

  try {
    const response: AuthenticationResult =
      await instance.acquireTokenSilent({
        scopes: apiScopes,
        account,
      });
    return response.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      // Token expired or consent required — redirect to login
      await instance.acquireTokenRedirect({
        scopes: apiScopes,
        account,
      });
      throw new Error("Redirecting to login...");
    }
    throw error;
  }
}
