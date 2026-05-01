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
  BottomSheet,
} from "@/components/ui";
import { FileText, Lock, Edit, AlertTriangle } from "lucide-react";

interface BrainFile {
  path: string;
  name: string;
  size_bytes: number;
  modified_at: string;
  is_sacred: boolean;
  is_editable: boolean;
}
interface BrainListResponse {
  files: ReadonlyArray<BrainFile>;
  edit_enabled: boolean;
  sacred_count: number;
  non_sacred_count: number;
  error?: string;
}
interface BrainContent {
  name: string;
  content: string;
  is_sacred: boolean;
  size_bytes: number;
  modified_at: string;
  lines: number;
  error?: string;
}
interface SaveResult {
  ok?: boolean;
  no_change?: boolean;
  lines_changed_estimate?: number;
  backup_path?: string;
  error?: string;
}

export function BrainSection() {
  const [data, setData] = React.useState<BrainListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [openName, setOpenName] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<BrainContent | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saveResult, setSaveResult] = React.useState<string | null>(null);

  const fetchList = React.useCallback(async () => {
    try {
      const res = await fetch("/api/memory/brain", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as BrainListResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const openFile = async (name: string) => {
    setOpenName(name);
    setContent(null);
    setEditing(false);
    setSaveResult(null);
    try {
      const res = await fetch(`/api/memory/brain/${encodeURIComponent(name)}`, { cache: "no-store" });
      if (res.ok) {
        const c = (await res.json()) as BrainContent;
        setContent(c);
        setDraft(c.content ?? "");
      }
    } catch (err) {
      setContent({
        name,
        content: "",
        is_sacred: false,
        size_bytes: 0,
        modified_at: "",
        lines: 0,
        error: String(err),
      });
    }
  };

  const closeSheet = () => {
    setOpenName(null);
    setContent(null);
    setEditing(false);
    setSaveResult(null);
  };

  const save = async () => {
    if (!content || content.is_sacred) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch(`/api/memory/brain/${encodeURIComponent(content.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft, author: "ghost" }),
      });
      const j = (await res.json()) as SaveResult;
      if (j.error) {
        setSaveResult(`Failed: ${j.error}`);
      } else if (j.no_change) {
        setSaveResult("No change");
        setEditing(false);
      } else {
        setSaveResult(`Saved ✓ (${j.lines_changed_estimate ?? 0} lines changed; backup at ${j.backup_path ?? "?"})`);
        setEditing(false);
        void fetchList();
      }
    } catch (err) {
      setSaveResult(`Failed: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <FileText size={14} />
              BRAIN FILES
            </span>
          </CardTitle>
          {data && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="amber" size="sm">{data.sacred_count} sacred</Pill>
              <Pill tone="cyan" size="sm">{data.non_sacred_count} non-sacred</Pill>
              {data.edit_enabled
                ? <Pill tone="green" size="sm">EDIT ON</Pill>
                : <Pill tone="neutral" size="sm">edit off</Pill>}
            </div>
          )}
        </CardHeader>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}

        {!loading && data?.error && <EmptyState title="Failed to load" body={data.error} />}

        {!loading && data && data.files.length === 0 && (
          <EmptyState title="No brain files" body="brain/ directory is empty." />
        )}

        {!loading && data && data.files.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {data.files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => openFile(f.name)}
                  className="tap-target group flex w-full items-center justify-between gap-3 py-2.5 px-2 hover:bg-bg-elevated/40 rounded-md transition-colors duration-fast text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {f.is_sacred
                      ? <Lock size={14} className="text-accent-amber flex-none" />
                      : f.is_editable
                        ? <Edit size={14} className="text-accent-cyan flex-none" />
                        : <FileText size={14} className="text-fg-muted flex-none" />}
                    <span className="font-bold truncate">{f.name}</span>
                    {f.is_sacred && <Pill tone="amber" size="sm">SACRED</Pill>}
                  </div>
                  <div className="text-micro text-fg-muted text-right flex-none">
                    {(f.size_bytes / 1024).toFixed(1)}KB · {new Date(f.modified_at).toLocaleDateString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {data && !data.edit_enabled && (
          <div className="mt-3 text-micro text-fg-muted">
            Editing disabled by default. Set <code className="text-accent-cyan">HUB_BRAIN_EDIT_ENABLED=true</code> in <code>auto_config</code> to unlock non-sacred files. Sacred files always read-only.
          </div>
        )}
      </Card>

      <BottomSheet open={openName !== null} onClose={closeSheet} title={openName ?? ""}>
        {!content && <Skeleton className="h-64 w-full" />}

        {content?.error && <EmptyState title="Failed to load" body={content.error} />}

        {content && !content.error && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-micro text-fg-muted">
              {content.is_sacred && (
                <Pill tone="amber" size="sm" pulse>
                  <Lock size={10} className="inline" /> SACRED
                </Pill>
              )}
              <span>{content.lines} lines · {(content.size_bytes / 1024).toFixed(1)}KB</span>
              <span>· modified {new Date(content.modified_at).toLocaleDateString()}</span>
            </div>

            {!editing && (
              <pre className="rounded-md border border-border-subtle bg-bg-elevated p-3 text-caption text-fg-primary whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
                {content.content}
              </pre>
            )}

            {editing && (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full max-h-[60vh] min-h-[40vh] rounded-md border border-border-strong bg-bg-elevated p-3 text-caption text-fg-primary font-mono"
                spellCheck={false}
              />
            )}

            {!content.is_sacred && data?.edit_enabled && !editing && (
              <HapticButton variant="primary" fullWidth onClick={() => setEditing(true)}>
                <Edit size={14} /> Edit
              </HapticButton>
            )}

            {!content.is_sacred && data?.edit_enabled && editing && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-md border border-accent-amber/40 bg-accent-amber/10 p-3 text-caption text-accent-amber">
                  <AlertTriangle size={16} className="mt-0.5 flex-none" />
                  <span>Saving creates a timestamped .bak and writes an audit row. Sacred files cannot be edited.</span>
                </div>
                <HapticButton variant="primary" fullWidth disabled={saving} onClick={save}>
                  {saving ? "Saving…" : "Confirm Save"}
                </HapticButton>
                <HapticButton
                  variant="ghost"
                  fullWidth
                  onClick={() => {
                    setEditing(false);
                    setDraft(content.content);
                  }}
                >
                  Cancel
                </HapticButton>
              </div>
            )}

            {saveResult && (
              <div
                className={`text-caption ${
                  saveResult.startsWith("Failed") ? "text-accent-red" : "text-accent-green"
                }`}
              >
                {saveResult}
              </div>
            )}

            {content.is_sacred && (
              <div className="text-micro text-fg-muted">
                <Lock size={10} className="inline mr-1" />
                Sacred file — read-only. Modification rejected at every layer.
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
