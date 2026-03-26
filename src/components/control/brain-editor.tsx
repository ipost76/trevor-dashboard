"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FileText, Lock, Save, Unlock, RefreshCw, AlertTriangle, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";

type BrainFile = {
  content: string;
  size: number;
  path: string;
  modified: string;
};

const BRAIN_FILES = ["IDENTITY", "BRAIN", "SOUL", "AGENTS", "MEMORY", "HEARTBEAT"] as const;
type BrainFileName = (typeof BRAIN_FILES)[number];

const SACRED_FILES = new Set<BrainFileName>(["IDENTITY", "BRAIN", "SOUL", "AGENTS"]);

export function BrainEditor() {
  const [files, setFiles] = useState<Record<string, BrainFile>>({});
  const [selectedFile, setSelectedFile] = useState<BrainFileName>("IDENTITY");
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [editEnabled, setEditEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [confirmSacred, setConfirmSacred] = useState(false);

  // Daily memory
  const [dailyDate, setDailyDate] = useState("");
  const [dailyContent, setDailyContent] = useState<string | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    const d = await safeFetch<{ files?: Record<string, BrainFile> }>("/api/brain?scope=brain", {});
    const fetched = d.files || {};
    setFiles(fetched);
    setLoading(false);
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // When files load or selection changes, update the content textarea
  useEffect(() => {
    const key = Object.keys(files).find(
      (k) => k.replace(".md", "").toUpperCase() === selectedFile
    );
    if (key) {
      const file = files[key];
      setContent(typeof file === "string" ? file : file.content || "");
    } else {
      setContent("");
    }
    setEditEnabled(false);
    setConfirmSacred(false);
    setSaveMsg(null);
  }, [selectedFile, files]);

  const isSacred = SACRED_FILES.has(selectedFile);
  const isEditable = selectedFile === "MEMORY" || selectedFile === "HEARTBEAT";
  const canEdit = isEditable || editEnabled;

  const handleEnableEdit = () => {
    if (isSacred && !confirmSacred) {
      setConfirmSacred(true);
      return;
    }
    setEditEnabled(true);
    setConfirmSacred(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const body: Record<string, unknown> = {
        action: "write_file",
        name: selectedFile,
        content,
      };
      if (isSacred) {
        body.confirm_sacred = true;
      }
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setSaveMsg({ type: "err", text: data.error || "Save failed" });
      } else {
        setSaveMsg({ type: "ok", text: "Saved successfully" });
        fetchFiles();
      }
    } catch (err) {
      setSaveMsg({ type: "err", text: String(err) });
    }
    setSaving(false);
  };

  const loadDailyMemory = async (date: string) => {
    if (!date) return;
    setDailyLoading(true);
    setDailyContent(null);
    const res = await safeFetch<{ content?: string; error?: string }>(`/api/memory/daily/${date}`, {});
    setDailyContent(res.content || res.error || "No memory file found for this date.");
    setDailyLoading(false);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 animate-spin text-[var(--neon-cyan)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Editor section */}
      <div className="flex flex-1 min-h-0 brain-editor-layout">
        {/* File selector */}
        <div className="w-48 shrink-0 border-r border-[var(--border)] bg-[rgba(0,0,0,0.2)] overflow-auto brain-file-sidebar">
          <div className="p-2 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground border-b border-[var(--border)] hidden md:block">
            Brain Files
          </div>
          <div className="brain-file-list">
          {BRAIN_FILES.map((name) => {
            const sacred = SACRED_FILES.has(name);
            const isActive = selectedFile === name;
            return (
              <button
                key={name}
                onClick={() => setSelectedFile(name)}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-[11px] font-medium transition-colors text-left shrink-0",
                  isActive
                    ? "bg-[rgba(0,240,255,0.08)] text-[var(--neon-cyan)] border-l-2 md:border-l-2 border-[var(--neon-cyan)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.02)] border-l-2 md:border-l-2 border-transparent"
                )}
              >
                {sacred ? (
                  <Lock className="h-3 w-3 text-[var(--neon-amber)] shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{name}.md</span>
              </button>
            );
          })}
          </div>
        </div>

        {/* Editor panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel-header)]">
            <FileText className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] font-bold">{selectedFile}.md</span>
            {isSacred && (
              <span className="flex items-center gap-1 text-[9px] neon-amber">
                <Lock className="h-2.5 w-2.5" /> SACRED
              </span>
            )}
            <div className="flex-1" />

            {/* Save message */}
            {saveMsg && (
              <span className={cn(
                "text-[9px] font-bold",
                saveMsg.type === "ok" ? "neon-green" : "neon-red"
              )}>
                {saveMsg.text}
              </span>
            )}

            {/* Editable files: always show save */}
            {isEditable && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-1 text-[9px]"
              >
                <Save className="h-3 w-3" />
                {saving ? "SAVING..." : "SAVE"}
              </button>
            )}

            {/* Sacred files: enable edit or save */}
            {isSacred && !editEnabled && (
              <button
                onClick={handleEnableEdit}
                className="btn-primary flex items-center gap-1 text-[9px]"
              >
                <Unlock className="h-3 w-3" />
                ENABLE EDIT
              </button>
            )}
            {isSacred && editEnabled && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-1 text-[9px]"
              >
                <Save className="h-3 w-3" />
                {saving ? "SAVING..." : "SAVE"}
              </button>
            )}
          </div>

          {/* Sacred confirmation dialog */}
          {confirmSacred && (
            <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--neon-amber)] bg-[rgba(255,170,0,0.05)]">
              <AlertTriangle className="h-4 w-4 text-[var(--neon-amber)] shrink-0" />
              <span className="text-[10px] text-[var(--neon-amber)]">
                This is a sacred file. Editing may change TREVOR&apos;s personality. Are you sure?
              </span>
              <button
                onClick={handleEnableEdit}
                className="px-3 py-1 rounded text-[9px] font-bold bg-[var(--neon-amber)] text-black hover:opacity-90 transition-opacity"
              >
                YES, ENABLE
              </button>
              <button
                onClick={() => setConfirmSacred(false)}
                className="text-[9px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Content area */}
          {canEdit ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1 bg-[#08080d] p-3 font-mono text-[10px] leading-relaxed text-foreground resize-none outline-none border-2 border-[rgba(0,240,255,0.15)] focus:border-[var(--neon-cyan)] transition-colors"
              spellCheck={false}
            />
          ) : (
            <pre className="flex-1 overflow-auto bg-[#08080d] p-3 font-mono text-[10px] leading-relaxed text-foreground whitespace-pre-wrap">
              {content || "File is empty or not found."}
            </pre>
          )}
        </div>
      </div>

      {/* Daily Memory section */}
      <div className="shrink-0 border-t border-[var(--border)]">
        <div className="panel-header flex items-center gap-2">
          <Calendar className="h-3 w-3" />
          <span>DAILY MEMORY</span>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              value={dailyDate}
              onChange={(e) => {
                setDailyDate(e.target.value);
                loadDailyMemory(e.target.value);
              }}
              className="input-terminal text-[10px] px-2 py-1"
            />
            {dailyLoading && (
              <RefreshCw className="h-3 w-3 animate-spin text-[var(--neon-cyan)]" />
            )}
          </div>
          {dailyContent !== null && (
            <pre className="bg-[#08080d] p-3 font-mono text-[10px] leading-relaxed text-foreground whitespace-pre-wrap max-h-[200px] overflow-auto rounded border border-[var(--border)]">
              {dailyContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
