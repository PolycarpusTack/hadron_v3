export function SettingsView() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h2 className="text-xl font-semibold text-white">Settings</h2>

      {/* AI Configuration */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-300">
          AI Configuration
        </h3>
        <p className="text-sm text-slate-400">
          AI provider, model, and API key are managed by an admin.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Bring-your-own-key was removed to avoid storing API keys in the
          browser. Ask an admin to configure or change the shared AI
          configuration under the Admin panel.
        </p>
      </section>

      {/* OpenSearch Integration */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-300">
          OpenSearch Integration
        </h3>
        <p className="text-sm text-slate-400">
          OpenSearch is configured via the Admin panel.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          OpenSearch credentials (URL, index, username, password) are managed by
          an admin and are not editable here.
        </p>
      </section>

      {/* Jira Integration */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-300">
          Jira Integration
        </h3>
        <p className="text-sm text-slate-400">
          JIRA is configured via the Admin panel.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          JIRA credentials (URL, email, API token, project key) are managed by
          an admin under JIRA Poller settings and are not editable here.
        </p>
      </section>
    </div>
  );
}
