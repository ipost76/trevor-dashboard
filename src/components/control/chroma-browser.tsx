"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Database, Search, Trash2, Plus, ChevronLeft, ChevronRight,
  RefreshCw, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";

type Collection = { name: string; count: number };
type Entry = { id: string; document: string; metadata: Record<string, unknown> };
type SearchResult = { id: string; document: string; metadata: Record<string, unknown>; distance: number };

const PAGE_SIZE = 20;

export function ChromaBrowser() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Add entry form
  const [showAdd, setShowAdd] = useState(false);
  const [addDoc, setAddDoc] = useState("");
  const [addMeta, setAddMeta] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [addSaving, setAddSaving] = useState(false);
  const [addMsg, setAddMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    const d = await safeFetch<{ collections?: Collection[] }>("/api/brain?scope=vectors", {});
    setCollections(d.collections || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  const fetchEntries = useCallback(async (collection: string, off: number) => {
    setEntriesLoading(true);
    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chroma_browse", collection, limit: PAGE_SIZE, offset: off }),
      });
      const data = await res.json();
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch {
      setEntries([]);
      setTotal(0);
    }
    setEntriesLoading(false);
  }, []);

  const selectCollection = (name: string) => {
    setSelected(name);
    setOffset(0);
    setSearchResults([]);
    setSearchQuery("");
    setShowSearch(false);
    setShowAdd(false);
    fetchEntries(name, 0);
  };

  const handleSearch = async () => {
    if (!selected || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chroma_search", collection: selected, query: searchQuery, limit: 10 }),
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  };

  const handleDelete = async (entryId: string) => {
    if (!selected) return;
    setDeleting(entryId);
    try {
      await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chroma_delete", collection: selected, entry_id: entryId }),
      });
      // Refresh entries and collections
      fetchEntries(selected, offset);
      fetchCollections();
    } catch { /* handled silently */ }
    setDeleting(null);
  };

  const handleAdd = async () => {
    if (!selected || !addDoc.trim()) return;
    setAddSaving(true);
    setAddMsg(null);
    const metadata: Record<string, string> = {};
    for (const pair of addMeta) {
      if (pair.key.trim()) {
        metadata[pair.key.trim()] = pair.value;
      }
    }
    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chroma_add", collection: selected, document: addDoc, metadata }),
      });
      const data = await res.json();
      if (data.error) {
        setAddMsg({ type: "err", text: data.error });
      } else {
        setAddMsg({ type: "ok", text: "Entry added successfully" });
        setAddDoc("");
        setAddMeta([{ key: "", value: "" }]);
        fetchEntries(selected, offset);
        fetchCollections();
      }
    } catch (err) {
      setAddMsg({ type: "err", text: String(err) });
    }
    setAddSaving(false);
  };

  const addMetaRow = () => {
    setAddMeta((prev) => [...prev, { key: "", value: "" }]);
  };

  const updateMetaRow = (idx: number, field: "key" | "value", val: string) => {
    setAddMeta((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  };

  const removeMetaRow = (idx: number) => {
    setAddMeta((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Collection list */}
      <div className="w-52 shrink-0 border-r border-[var(--border)] bg-[rgba(0,0,0,0.2)] overflow-auto">
        <div className="p-2 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground border-b border-[var(--border)]">
          Collections
        </div>
        {collections.length === 0 ? (
          <div className="p-3 text-[10px] text-muted-foreground text-center">
            No collections found
          </div>
        ) : (
          collections.map((c) => (
            <button
              key={c.name}
              onClick={() => selectCollection(c.name)}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 text-[10px] transition-colors text-left",
                selected === c.name
                  ? "bg-[rgba(0,240,255,0.08)] text-[var(--neon-cyan)] border-l-2 border-[var(--neon-cyan)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.02)] border-l-2 border-transparent"
              )}
            >
              <Database className="h-3 w-3 shrink-0" />
              <span className="flex-1 truncate font-bold">{c.name}</span>
              <span className="text-[9px] font-mono opacity-60">{c.count}</span>
            </button>
          ))
        )}
      </div>

      {/* Entry viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <EmptyState
            icon={Database}
            message="Select a collection to browse"
            sub="Choose a ChromaDB collection from the list"
          />
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel-header)]">
              <Database className="h-3 w-3 text-[var(--neon-magenta)]" />
              <span className="text-[11px] font-bold">{selected}</span>
              <span className="text-[9px] text-muted-foreground">{total} entries</span>
              <div className="flex-1" />
              <button
                onClick={() => { setShowSearch(!showSearch); setShowAdd(false); }}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold transition-colors",
                  showSearch
                    ? "text-[var(--neon-cyan)] bg-[rgba(0,240,255,0.1)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Search className="h-3 w-3" /> SEARCH
              </button>
              <button
                onClick={() => { setShowAdd(!showAdd); setShowSearch(false); }}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold transition-colors",
                  showAdd
                    ? "text-[var(--neon-green)] bg-[rgba(0,255,136,0.1)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Plus className="h-3 w-3" /> ADD
              </button>
            </div>

            {/* Search panel */}
            {showSearch && (
              <div className="px-3 py-2 border-b border-[var(--border)] bg-[rgba(0,240,255,0.02)]">
                <div className="flex items-center gap-2 mb-2">
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Semantic search within collection..."
                    className="bg-transparent border-none outline-none text-[11px] flex-1 text-foreground placeholder:text-muted-foreground"
                  />
                  {searchQuery && (
                    <button onClick={() => { setSearchQuery(""); setSearchResults([]); }} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  <button onClick={handleSearch} disabled={searching} className="btn-primary text-[9px]">
                    {searching ? "SEARCHING..." : "SEARCH"}
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-1.5 max-h-[300px] overflow-auto">
                    {searchResults.map((r, i) => (
                      <div key={i} className="panel p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-mono text-muted-foreground truncate flex-1">{r.id}</span>
                          <span className="text-[9px] font-mono font-bold neon-text ml-2">
                            {((1 - (r.distance || 0)) * 100).toFixed(1)}% match
                          </span>
                        </div>
                        <p className="text-[10px] text-foreground whitespace-pre-wrap">{r.document}</p>
                        {r.metadata && Object.keys(r.metadata).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(r.metadata).map(([k, v]) => (
                              <span key={k} className="badge-regime text-[8px]">{k}: {String(v)}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add entry form */}
            {showAdd && (
              <div className="px-3 py-2 border-b border-[var(--border)] bg-[rgba(0,255,136,0.02)]">
                <div className="space-y-2">
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Document</label>
                    <textarea
                      value={addDoc}
                      onChange={(e) => setAddDoc(e.target.value)}
                      placeholder="Enter document content..."
                      className="w-full mt-1 input-terminal text-[10px] h-20 resize-none font-mono"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Metadata</label>
                      <button onClick={addMetaRow} className="text-[9px] text-muted-foreground hover:text-[var(--neon-cyan)]">
                        + Add Field
                      </button>
                    </div>
                    <div className="space-y-1 mt-1">
                      {addMeta.map((row, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <input
                            value={row.key}
                            onChange={(e) => updateMetaRow(i, "key", e.target.value)}
                            placeholder="key"
                            className="input-terminal text-[10px] w-28"
                          />
                          <input
                            value={row.value}
                            onChange={(e) => updateMetaRow(i, "value", e.target.value)}
                            placeholder="value"
                            className="input-terminal text-[10px] flex-1"
                          />
                          {addMeta.length > 1 && (
                            <button onClick={() => removeMetaRow(i)} className="text-muted-foreground hover:text-[var(--neon-red)]">
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleAdd} disabled={addSaving || !addDoc.trim()} className="btn-primary text-[9px]">
                      {addSaving ? "ADDING..." : "ADD ENTRY"}
                    </button>
                    {addMsg && (
                      <span className={cn("text-[9px] font-bold", addMsg.type === "ok" ? "neon-green" : "neon-red")}>
                        {addMsg.text}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Entries list */}
            <div className="flex-1 overflow-auto">
              {entriesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-4 w-4 animate-spin text-[var(--neon-cyan)]" />
                </div>
              ) : entries.length === 0 ? (
                <EmptyState icon={Database} message="No entries in this collection" />
              ) : (
                <div className="space-y-0">
                  {entries.map((entry) => (
                    <div key={entry.id} className="data-cell hover:bg-[rgba(0,240,255,0.03)] px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-mono text-muted-foreground truncate flex-1">{entry.id}</span>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          disabled={deleting === entry.id}
                          className="text-muted-foreground hover:text-[var(--neon-red)] transition-colors ml-2"
                          title="Delete entry"
                        >
                          {deleting === entry.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] text-foreground whitespace-pre-wrap">
                        {entry.document.length > 200
                          ? entry.document.slice(0, 200) + "..."
                          : entry.document}
                      </p>
                      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(entry.metadata).map(([k, v]) => (
                            <span key={k} className="badge-regime text-[8px]">{k}: {String(v)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 py-2 border-t border-[var(--border)]">
                <button
                  onClick={() => { const newOff = Math.max(0, offset - PAGE_SIZE); setOffset(newOff); fetchEntries(selected, newOff); }}
                  disabled={offset <= 0}
                  className="btn-primary disabled:opacity-30"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <span className="text-[10px] text-muted-foreground">{currentPage} / {totalPages}</span>
                <button
                  onClick={() => { const newOff = offset + PAGE_SIZE; setOffset(newOff); fetchEntries(selected, newOff); }}
                  disabled={currentPage >= totalPages}
                  className="btn-primary disabled:opacity-30"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
