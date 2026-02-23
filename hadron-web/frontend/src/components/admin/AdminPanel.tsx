import { useEffect, useState } from "react";
import { api, UserProfile } from "../../services/api";
import { useToast } from "../Toast";
import { AuditLogView } from "./AuditLogView";
import { TagManager } from "../tags/TagManager";
import { GoldManagement } from "../gold/GoldManagement";
import { PatternManager } from "./PatternManager";

type AdminTab = "users" | "audit" | "tags" | "gold" | "patterns" | "training";

export function AdminPanel() {
  const toast = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>("users");

  useEffect(() => {
    api
      .listUsers()
      .then(setUsers)
      .catch((e) =>
        toast.error(
          e instanceof Error ? e.message : "Failed to load users",
        ),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const handleRoleChange = async (
    userId: string,
    role: "analyst" | "lead" | "admin",
  ) => {
    try {
      await api.updateUserRole(userId, role);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role } : u)),
      );
      toast.success("Role updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role");
    }
  };

  const handleExportTrainingData = async () => {
    try {
      const data = await api.exportTrainingData();
      const blob = new Blob([data], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "hadron-training-data.jsonl";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Training data exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  };

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "users", label: "Users" },
    { key: "audit", label: "Audit Log" },
    { key: "tags", label: "Tags" },
    { key: "gold", label: "Gold Standard" },
    { key: "patterns", label: "Patterns" },
    { key: "training", label: "Training Data" },
  ];

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400">Loading users...</div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "audit" && <AuditLogView />}
      {activeTab === "tags" && <TagManager />}
      {activeTab === "gold" && <GoldManagement />}
      {activeTab === "patterns" && <PatternManager />}

      {activeTab === "training" && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 text-center">
          <h3 className="mb-2 text-lg font-semibold text-white">
            Export Training Data
          </h3>
          <p className="mb-4 text-sm text-slate-400">
            Export verified gold standard analyses as JSONL for fine-tuning.
          </p>
          <button
            onClick={handleExportTrainingData}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Download JSONL
          </button>
        </div>
      )}

      {activeTab === "users" && (
        <div className="rounded-lg border border-slate-700 bg-slate-800">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-slate-700/50 last:border-0"
                >
                  <td className="px-4 py-3 text-sm text-slate-200">
                    {u.displayName}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-purple-500/20 text-purple-400"
                          : u.role === "lead"
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-slate-600/50 text-slate-300"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        handleRoleChange(
                          u.id,
                          e.target.value as "analyst" | "lead" | "admin",
                        )
                      }
                      className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="analyst">Analyst</option>
                      <option value="lead">Lead</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
