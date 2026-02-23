import { useEffect, useState } from "react";
import { api, PatternRule, PatternMatch } from "../../services/api";
import { useToast } from "../Toast";

export function PatternManager() {
  const toast = useToast();
  const [rules, setRules] = useState<PatternRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PatternRule | null>(null);
  const [testContent, setTestContent] = useState("");
  const [testErrorType, setTestErrorType] = useState("");
  const [testResults, setTestResults] = useState<PatternMatch[] | null>(null);

  useEffect(() => {
    api
      .listPatterns()
      .then(setRules)
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to load patterns"),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const emptyRule: PatternRule = {
    id: "",
    name: "",
    pattern: "",
    patternType: "contains",
    severity: null,
    component: null,
    description: null,
    enabled: true,
  };

  const handleSave = async (rule: PatternRule) => {
    try {
      let updated: PatternRule[];
      if (rule.id && rules.some((r) => r.id === rule.id)) {
        updated = await api.updatePattern(rule.id, rule);
      } else {
        updated = await api.createPattern({
          ...rule,
          id: rule.id || crypto.randomUUID(),
        });
      }
      setRules(updated);
      setEditing(null);
      toast.success("Pattern saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save pattern");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deletePattern(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Pattern deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete pattern");
    }
  };

  const handleTest = async () => {
    try {
      const results = await api.testPatterns(
        testContent,
        testErrorType || undefined,
      );
      setTestResults(results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-slate-400">
        Loading patterns...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rules list */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Pattern Rules</h3>
        <button
          onClick={() => setEditing(emptyRule)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          No pattern rules configured.
        </p>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800 px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${r.enabled ? "text-slate-200" : "text-slate-500 line-through"}`}
                  >
                    {r.name}
                  </span>
                  <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">
                    {r.patternType}
                  </span>
                  {r.severity && (
                    <span className="text-xs text-red-400">{r.severity}</span>
                  )}
                  {r.component && (
                    <span className="text-xs text-blue-400">
                      {r.component}
                    </span>
                  )}
                </div>
                <code className="mt-0.5 block text-xs text-slate-500">
                  {r.pattern}
                </code>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(r)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      {editing && (
        <PatternForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Test panel */}
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <h4 className="mb-2 text-sm font-semibold text-slate-300">
          Test Patterns
        </h4>
        <textarea
          value={testContent}
          onChange={(e) => setTestContent(e.target.value)}
          placeholder="Paste log content to test against patterns..."
          className="mb-2 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
          rows={4}
        />
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={testErrorType}
            onChange={(e) => setTestErrorType(e.target.value)}
            placeholder="Error type (optional)"
            className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
          />
          <button
            onClick={handleTest}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
          >
            Test
          </button>
        </div>
        {testResults && (
          <div className="mt-3">
            {testResults.length === 0 ? (
              <p className="text-xs text-slate-500">No patterns matched.</p>
            ) : (
              <div className="space-y-1">
                {testResults.map((m, i) => (
                  <div
                    key={i}
                    className="rounded bg-green-500/10 px-2 py-1 text-xs text-green-400"
                  >
                    Matched: {m.ruleName}
                    {m.severity && ` (severity: ${m.severity})`}
                    {m.component && ` (component: ${m.component})`}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PatternForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: PatternRule;
  onSave: (rule: PatternRule) => void;
  onCancel: () => void;
}) {
  const [rule, setRule] = useState<PatternRule>(initial);

  return (
    <div className="rounded-lg border border-blue-500/30 bg-slate-800 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Name
          </label>
          <input
            type="text"
            value={rule.name}
            onChange={(e) => setRule({ ...rule, name: e.target.value })}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Pattern Type
          </label>
          <select
            value={rule.patternType}
            onChange={(e) => setRule({ ...rule, patternType: e.target.value })}
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
          >
            <option value="contains">Contains</option>
            <option value="regex">Regex</option>
            <option value="error_type">Error Type Match</option>
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          Pattern
        </label>
        <input
          type="text"
          value={rule.pattern}
          onChange={(e) => setRule({ ...rule, pattern: e.target.value })}
          className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
          placeholder={
            rule.patternType === "regex"
              ? "Regular expression..."
              : "Text to match..."
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Severity (optional)
          </label>
          <select
            value={rule.severity || ""}
            onChange={(e) =>
              setRule({ ...rule, severity: e.target.value || null })
            }
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
          >
            <option value="">None</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Component (optional)
          </label>
          <input
            type="text"
            value={rule.component || ""}
            onChange={(e) =>
              setRule({ ...rule, component: e.target.value || null })
            }
            className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-400">
          Description (optional)
        </label>
        <input
          type="text"
          value={rule.description || ""}
          onChange={(e) =>
            setRule({ ...rule, description: e.target.value || null })
          }
          className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
            className="rounded"
          />
          Enabled
        </label>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(rule)}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Save
        </button>
      </div>
    </div>
  );
}
