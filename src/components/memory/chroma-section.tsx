"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
  HapticButton,
} from "@/components/ui";
import { Layers, Search } from "lucide-react";

interface Coll {
  name: string;
  count: number;
}
interface ListResp {
  collections: ReadonlyArray<Coll>;
  error?: string;
}

interface Item {
  id: string;
  document: string | null;
  metadata: Record<string, unknown> | null;
  distance?: number | null;
}
interface ItemsResp {
  items: ReadonlyArray<Item>;
  error?: string;
}

type Mode = "peek" | "search";

export function ChromaSection() {
  const [collections, setCollections] = React.useState<ReadonlyArray<Coll> | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>("peek");
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<ReadonlyArray<Item> | null>(null);
  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingItems, setLoadingItems] = React.useState(false);
  // RM-MEM-A3: distinguish "VM unreachable" (error set by the re-sourced helper) from
  // a genuinely empty ChromaDB — never a silent fake 0.
  const [listError, setListError] = React.useState<string | null>(null);
  const [itemsError, setItemsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchList = async () => {
      try {
        const res = await fetch("/api/memory/chroma?mode=list", { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as ListResp;
          setCollections(j.collections ?? []);
          setListError(j.error ?? null);
        }
      } finally {
        setLoadingList(false);
      }
    };
    void fetchList();
  }, []);

  const fetchItems = React.useCallback(async (coll: string, m: Mode, qval: string) => {
    setLoadingItems(true);
    setItemsError(null);
    try {
      const url =
        m === "peek"
          ? `/api/memory/chroma?mode=peek&collection=${encodeURIComponent(coll)}&limit=10`
          : `/api/memory/chroma?mode=search&collection=${encodeURIComponent(coll)}&q=${encodeURIComponent(qval)}&limit=10`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as ItemsResp;
        setItems(j.items ?? []);
        setItemsError(j.error ?? null);
      }
    } finally {
      setLoadingItems(false);
    }
  }, []);

  const select = (name: string) => {
    setSelected(name);
    setMode("peek");
    setQuery("");
    setItems(null);
    void fetchItems(name, "peek", "");
  };

  const runSearch = () => {
    if (!selected || !query.trim()) return;
    setMode("search");
    void fetchItems(selected, "search", query.trim());
  };

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Layers size={14} />
              CHROMADB
            </span>
          </CardTitle>
          {collections && (
            <Pill
              tone="violet"
              size="sm"
              className="bg-accent-plum/10 text-accent-plum-strong border-accent-plum/30"
            >
              {collections.length} collections
            </Pill>
          )}
        </CardHeader>

        {loadingList && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}

        {!loadingList && listError && (!collections || collections.length === 0) && (
          <EmptyState title="VM unreachable" body={listError} />
        )}

        {!loadingList && !listError && collections && collections.length === 0 && (
          <EmptyState title="No collections" body="ChromaDB is empty." />
        )}

        {!loadingList && collections && collections.length > 0 && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {collections.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => select(c.name)}
                className={`tap-target rounded-md border px-2 py-2 text-left text-caption transition-colors duration-fast ${
                  selected === c.name
                    ? "border-accent-plum bg-accent-plum/10 text-accent-plum-strong"
                    : "border-border-subtle bg-bg-elevated text-fg-primary hover:border-accent-cyan-soft/40"
                }`}
              >
                <div className="font-mono font-semibold truncate">{c.name}</div>
                <div className="font-mono text-micro text-fg-muted">{c.count.toLocaleString()} vectors</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>{selected}</CardTitle>
            <Pill
              tone={mode === "search" ? "cyan" : "violet"}
              size="sm"
              className={
                mode === "search"
                  ? "bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
                  : "bg-accent-plum/10 text-accent-plum-strong border-accent-plum/30"
              }
            >
              {mode === "search" ? "keyword" : mode}
            </Pill>
          </CardHeader>

          <div className="flex gap-2 mb-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Keyword search…"
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              className="flex-1 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 font-sans text-caption text-fg-primary focus:border-accent-cyan-soft focus:outline-none"
            />
            <HapticButton variant="primary" size="sm" onClick={runSearch} disabled={!query.trim()}>
              <Search size={14} /> Search
            </HapticButton>
          </div>
          <div className="mb-3 font-sans text-micro text-fg-muted">
            Keyword match over document text (read-only full-text index) — not semantic.
          </div>

          {loadingItems && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          )}

          {!loadingItems && itemsError && (!items || items.length === 0) && (
            <EmptyState title="VM unreachable" body={itemsError} />
          )}

          {!loadingItems && !itemsError && items && items.length === 0 && (
            <EmptyState
              title="No items"
              body={mode === "search" ? "No matches for query." : "Collection empty."}
            />
          )}

          {!loadingItems && items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="rounded-md border border-border-subtle bg-bg-elevated p-3 text-caption space-y-1"
                >
                  <div className="flex items-center gap-2 font-sans text-micro text-fg-muted">
                    <span className="font-mono truncate max-w-[60%]">{it.id}</span>
                    {typeof it.distance === "number" && (
                      <Pill
                        tone="violet"
                        size="sm"
                        className="bg-accent-plum/10 text-accent-plum-strong border-accent-plum/30"
                      >
                        d=<span className="font-mono">{it.distance.toFixed(3)}</span>
                      </Pill>
                    )}
                  </div>
                  {it.document && (
                    <p className="text-caption text-fg-primary whitespace-pre-wrap break-words line-clamp-3">
                      {it.document}
                    </p>
                  )}
                  {it.metadata && Object.keys(it.metadata).length > 0 && (
                    <div className="text-micro text-fg-muted font-mono break-all">
                      {Object.entries(it.metadata).slice(0, 5).map(([k, v]) => (
                        <span key={k} className="mr-3">{k}={String(v).slice(0, 30)}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
