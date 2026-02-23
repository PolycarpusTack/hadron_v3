import { useState } from "react";
import { api, type OpenSearchHit } from "../../services/api";
import { useToast } from "../Toast";

export function OpenSearchPanel() {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [index, setIndex] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpenSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [tookMs, setTookMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const pageSize = 20;

  const handleTestConnection = async () => {
    try {
      const result = await api.testOpenSearch(url, username || undefined, password || undefined);
      if (result.connected) {
        toast.success("OpenSearch connection successful");
      } else {
        toast.error("Connection failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection test failed");
    }
  };

  const handleSearch = async (newOffset = 0) => {
    if (!url || !index || !query) {
      toast.error("URL, index, and query are required");
      return;
    }
    setLoading(true);
    setOffset(newOffset);
    try {
      const resp = await api.searchOpenSearch(url, index, query, {
        username: username || undefined,
        password: password || undefined,
        size: pageSize,
        from: newOffset,
      });
      setResults(resp.hits);
      setTotal(resp.total);
      setTookMs(resp.tookMs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold text-white">OpenSearch</h2>

      {/* Connection config */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-300">Connection</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://opensearch.example.com:9200"
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Index</label>
            <input
              value={index}
              onChange={(e) => setIndex(e.target.value)}
              placeholder="logs-*"
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Username (optional)
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Password (optional)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={handleTestConnection}
          disabled={!url}
          className="mt-3 rounded-md border border-slate-600 px-4 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-30"
        >
          Test Connection
        </button>
      </section>

      {/* Search */}
      <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
        <h3 className="mb-3 text-sm font-medium text-slate-300">Search</h3>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search query..."
            className="flex-1 rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => handleSearch()}
            disabled={loading || !query}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </section>

      {/* Results */}
      {results.length > 0 && (
        <section className="rounded-lg border border-slate-700 bg-slate-800 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">
              {total} results ({tookMs}ms)
            </h3>
          </div>
          <div className="space-y-2">
            {results.map((hit) => (
              <div
                key={hit.id}
                className="rounded-md border border-slate-700/50 bg-slate-900 p-3"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                  <span>{hit.index}</span>
                  {hit.score != null && <span>Score: {hit.score.toFixed(2)}</span>}
                </div>
                <pre className="max-h-32 overflow-auto text-xs text-slate-300">
                  {JSON.stringify(hit.source, null, 2)}
                </pre>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {total > pageSize && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={() => handleSearch(Math.max(0, offset - pageSize))}
                disabled={offset === 0}
                className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-sm text-slate-400">
                Page {Math.floor(offset / pageSize) + 1} of{" "}
                {Math.ceil(total / pageSize)}
              </span>
              <button
                onClick={() => handleSearch(offset + pageSize)}
                disabled={offset + pageSize >= total}
                className="rounded-md px-3 py-1 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
