import { useCallback, useEffect, useState } from "react";
import { api, type AuditLogEntry } from "../../services/api";
import { useToast } from "../Toast";

const ACTION_FILTERS = [
  { value: "", label: "All actions" },
  { value: "analysis", label: "Analysis" },
  { value: "user", label: "User" },
  { value: "jira", label: "Jira" },
];

export function AuditLogView() {
  const toast = useToast();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAuditLog({
        limit,
        offset,
        action: actionFilter || undefined,
      });
      setEntries(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [offset, actionFilter, toast]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Audit Log</h3>
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setOffset(0);
          }}
          className="rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
        >
          {ACTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="py-8 text-center text-slate-400">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center text-slate-400">No audit entries</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-slate-700/50 last:border-0"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-200">
                    {entry.userName}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {entry.resourceType}
                    {entry.resourceId && (
                      <span className="ml-1 text-slate-500">
                        #{entry.resourceId}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {entry.ipAddress || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          onClick={() => setOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
        >
          Previous
        </button>
        <span className="text-sm text-slate-400">
          Showing {offset + 1}-{offset + entries.length}
        </span>
        <button
          onClick={() => setOffset(offset + limit)}
          disabled={entries.length < limit}
          className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}
