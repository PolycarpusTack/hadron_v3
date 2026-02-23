import { useCallback, useEffect, useState } from "react";
import { api, GoldAnalysis, PaginatedResponse } from "../../services/api";
import { useToast } from "../Toast";
import { GoldBadge } from "./GoldBadge";

export function GoldManagement() {
  const toast = useToast();
  const [golds, setGolds] = useState<GoldAnalysis[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchGolds = useCallback(async () => {
    setLoading(true);
    try {
      const resp: PaginatedResponse<GoldAnalysis> = await api.listGold();
      setGolds(resp.data);
      setTotal(resp.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load gold analyses");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchGolds();
  }, [fetchGolds]);

  const handleVerify = async (
    goldId: number,
    status: "verified" | "rejected",
  ) => {
    try {
      const updated = await api.verifyGold(goldId, status);
      setGolds((prev) =>
        prev.map((g) => (g.id === goldId ? updated : g)),
      );
      toast.success(`Analysis ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to verify");
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-slate-400">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          Gold Standard Analyses
        </h3>
        <span className="text-sm text-slate-400">{total} total</span>
      </div>

      {golds.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No gold analyses yet. Promote analyses from the History view.
        </p>
      ) : (
        <div className="rounded-lg border border-slate-700 bg-slate-800">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Analysis</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Promoted By</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {golds.map((g) => (
                <tr
                  key={g.id}
                  className="border-b border-slate-700/50 last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <GoldBadge status={g.verificationStatus} />
                      <div>
                        <div className="text-sm text-slate-200">
                          {g.filename || `Analysis #${g.analysisId}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {g.errorType} &middot; {g.severity}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        g.verificationStatus === "verified"
                          ? "bg-green-500/20 text-green-400"
                          : g.verificationStatus === "rejected"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {g.verificationStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">
                    {g.qualityScore ? `${g.qualityScore}/5` : "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {g.promoterName}
                  </td>
                  <td className="px-4 py-3">
                    {g.verificationStatus === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleVerify(g.id, "verified")}
                          className="text-xs text-green-400 hover:text-green-300"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => handleVerify(g.id, "rejected")}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Reject
                        </button>
                      </div>
                    )}
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
