"use client";
import { useEffect, useState, useCallback } from "react";
import { Plus, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { Modal, Input, TextArea, timeAgo } from "./shared";

interface Note { id: number; title: string; content: string; category: string | null; tags: string | null; pinned: number; created_at: string; }

export function NotesTab() {
  const [items, setItems] = useState<Note[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ title: "", content: "", category: "", pinned: 0 });

  const load = useCallback(() => { safeFetch<{ items: Note[] }>("/api/ghost/notes", { items: [] }).then(d => setItems(d.items)); }, []);
  useEffect(load, [load]);

  const create = async () => {
    if (!form.title || !form.content) return;
    await fetch("/api/ghost/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setForm({ title: "", content: "", category: "", pinned: 0 }); setShowForm(false); load();
  };

  const togglePin = async (n: Note) => {
    await fetch(`/api/ghost/notes/${n.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: n.pinned ? 0 : 1 }) });
    load();
  };

  const del = async (id: number) => { if (!confirm("Delete?")) return; await fetch(`/api/ghost/notes/${id}`, { method: "DELETE" }); load(); };

  const filtered = items.filter(n => !search || n.title.toLowerCase().includes(search.toLowerCase()) || n.content.toLowerCase().includes(search.toLowerCase()));
  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);

  return (
    <div className="space-y-3 overflow-y-auto pb-32">
      <div className="flex items-center gap-3">
        <button onClick={() => setShowForm(true)} className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"><Plus className="h-3 w-3" />New Note</button>
        <input className="input-terminal px-2.5 py-1.5 text-xs rounded flex-1" placeholder="Search notes..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Note">
        <Input label="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
        <TextArea label="Content" rows={6} value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} />
        <Input label="Category" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="thought, idea, reflection..." />
        <button onClick={create} className="btn-primary w-full py-2 text-xs mt-2">Create Note</button>
      </Modal>
      {pinned.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2">{"\ud83d\udccc"} Pinned</div>
          <div className="space-y-1">{pinned.map(n => <NoteCard key={n.id} note={n} expanded={expanded === n.id} onExpand={() => setExpanded(expanded === n.id ? null : n.id)} onPin={() => togglePin(n)} onDelete={() => del(n.id)} />)}</div>
        </div>
      )}
      <div className="space-y-1">{unpinned.map(n => <NoteCard key={n.id} note={n} expanded={expanded === n.id} onExpand={() => setExpanded(expanded === n.id ? null : n.id)} onPin={() => togglePin(n)} onDelete={() => del(n.id)} />)}</div>
      {filtered.length === 0 && <div className="text-xs text-muted-foreground panel p-4">No notes yet.</div>}
    </div>
  );
}

function NoteCard({ note, expanded, onExpand, onPin, onDelete }: { note: Note; expanded: boolean; onExpand: () => void; onPin: () => void; onDelete: () => void }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer flex-1 min-w-0" onClick={onExpand}>
          <span className="text-xs font-bold truncate">{note.title}</span>
          {note.category && <span className="text-[9px] text-muted-foreground">#{note.category}</span>}
          <span className="text-[9px] text-muted-foreground">{timeAgo(note.created_at)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onPin} className={cn("p-0.5", note.pinned ? "text-amber-400" : "text-muted-foreground hover:text-amber-400")}><Pin className="h-3 w-3" /></button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-red-400 p-0.5"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
      {expanded ? (
        <pre className="text-[10px] text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed">{note.content}</pre>
      ) : (
        <div className="text-[10px] text-muted-foreground mt-1 truncate">{note.content.slice(0, 100)}</div>
      )}
    </div>
  );
}
