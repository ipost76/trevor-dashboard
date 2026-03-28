"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

/* ── Scoped CSS vars ── */
const THEME_VARS: Record<string, string> = {
  "--term-bg-void": "#0d1117",
  "--term-bg-surface": "#161b22",
  "--term-bg-elevated": "#1c2333",
  "--term-bg-hover": "#21262d",
  "--term-bg-active": "#282e38",
  "--term-blue-core": "#58a6ff",
  "--term-blue-bright": "#79c0ff",
  "--term-blue-dim": "#388bfd",
  "--term-blue-border": "rgba(88,166,255,0.25)",
  "--term-text-primary": "#e6edf3",
  "--term-text-secondary": "#8b949e",
  "--term-text-muted": "#484f58",
  "--term-text-dim": "#30363d",
  "--term-green": "#3fb950",
  "--term-red": "#f85149",
  "--term-amber": "#d29922",
};

const XTERM_THEME = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "rgba(88,166,255,0.3)",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "rgba(88,166,255,0.15)",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d2c0",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

type ConnState = "connecting" | "connected" | "disconnected" | "error";

const TOOLBAR_KEYS = [
  { label: "Tab", seq: "\t", w: 48 },
  { label: "Ctrl", seq: "__ctrl__", w: 48 },
  { label: "Alt", seq: "__alt__", w: 40 },
  { label: "Esc", seq: "\x1b", w: 40 },
  { label: "\u2191", seq: "\x1b[A", w: 36 },
  { label: "\u2193", seq: "\x1b[B", w: 36 },
  { label: "\u2190", seq: "\x1b[D", w: 36 },
  { label: "\u2192", seq: "\x1b[C", w: 36 },
  { label: "|", seq: "|", w: 36 },
  { label: "/", seq: "/", w: 36 },
  { label: "~", seq: "~", w: 36 },
  { label: "-", seq: "-", w: 36 },
  { label: "_", seq: "_", w: 36 },
];

export function TerminalView() {
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connState, setConnState] = useState<ConnState>("connecting");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [dims, setDims] = useState({ cols: 80, rows: 24 });
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Send data to WebSocket
  const wsSend = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  }, []);

  // Handle toolbar key press
  const handleToolbarKey = useCallback((seq: string) => {
    if (seq === "__ctrl__") {
      setCtrlActive((p) => !p);
      setAltActive(false);
      return;
    }
    if (seq === "__alt__") {
      setAltActive((p) => !p);
      setCtrlActive(false);
      return;
    }
    wsSend(seq);
    termRef.current?.focus();
  }, [wsSend]);

  // Connect WebSocket + init xterm
  const connectTerminal = useCallback(async () => {
    setConnState("connecting");

    // Dynamic import xterm (client-only)
    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");
    const { WebLinksAddon } = await import("@xterm/addon-web-links");
    const { SearchAddon } = await import("@xterm/addon-search");
    const container = termContainerRef.current;
    if (!container) return;

    // Cleanup previous
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    container.innerHTML = "";

    const mobile = window.innerWidth < 768;
    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace",
      fontSize: mobile ? 13 : 14,
      fontWeight: "400",
      fontWeightBold: "600",
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: true,
      scrollOnUserInput: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((_e, uri) => window.open(uri, "_blank"));
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    termRef.current = term;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    term.open(container);

    // Intercept Ctrl+F for search
    term.attachCustomKeyEventHandler((e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && e.type === "keydown") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });

    // Handle Ctrl/Alt sticky modifiers from virtual keyboard
    term.onData((data) => {
      if (ctrlActive) {
        setCtrlActive(false);
        if (data.length === 1) {
          const code = data.toUpperCase().charCodeAt(0) - 64;
          if (code >= 1 && code <= 26) {
            wsSend(String.fromCharCode(code));
            return;
          }
        }
      }
      if (altActive) {
        setAltActive(false);
        wsSend("\x1b" + data);
        return;
      }
      wsSend(data);
    });

    // Fit after mount
    requestAnimationFrame(() => {
      fitAddon.fit();
      setDims({ cols: term.cols, rows: term.rows });
    });

    // WebSocket
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnState("connected");
      requestAnimationFrame(() => {
        fitAddon.fit();
        setDims({ cols: term.cols, rows: term.rows });
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      });
      term.focus();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "exit") {
            term.write("\r\n\x1b[38;2;88;166;255m[Session ended \u2014 press Reconnect]\x1b[0m\r\n");
            setConnState("disconnected");
            return;
          }
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
            return;
          }
        } catch {
          term.write(event.data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onclose = (event) => {
      if (event.code === 4001) {
        setConnState("error");
        term.write("\r\n\x1b[31m[Auth failed \u2014 refresh and log in]\x1b[0m\r\n");
      } else if (event.code === 4002) {
        setConnState("error");
        term.write("\r\n\x1b[31m[Max sessions \u2014 close another terminal]\x1b[0m\r\n");
      } else {
        setConnState("disconnected");
        term.write("\r\n\x1b[38;2;88;166;255m[Disconnected]\x1b[0m\r\n");
      }
    };

    ws.onerror = () => setConnState("error");
  }, [wsSend, ctrlActive, altActive]);

  // Init on mount
  useEffect(() => {
    connectTerminal();
    return () => {
      wsRef.current?.close();
      termRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize handler (debounced)
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (fitRef.current && termRef.current) {
          fitRef.current.fit();
          const term = termRef.current;
          setDims({ cols: term.cols, rows: term.rows });
          wsSend(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      }, 100);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timeout);
    };
  }, [wsSend]);

  // Re-fit when search bar toggles
  useEffect(() => {
    setTimeout(() => {
      if (fitRef.current && termRef.current) {
        fitRef.current.fit();
        const term = termRef.current;
        setDims({ cols: term.cols, rows: term.rows });
        wsSend(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    }, 50);
  }, [searchOpen, wsSend]);

  // visualViewport resize for mobile keyboard (debounced)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let vvTimeout: ReturnType<typeof setTimeout>;
    const handleVVResize = () => {
      clearTimeout(vvTimeout);
      vvTimeout = setTimeout(() => {
        if (fitRef.current) {
          fitRef.current.fit();
          const term = termRef.current;
          if (term) {
            setDims({ cols: term.cols, rows: term.rows });
            wsSend(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          }
        }
      }, 100);
    };
    vv.addEventListener("resize", handleVVResize);
    vv.addEventListener("scroll", handleVVResize);
    return () => {
      vv.removeEventListener("resize", handleVVResize);
      vv.removeEventListener("scroll", handleVVResize);
      clearTimeout(vvTimeout);
    };
  }, [wsSend]);

  // Search
  const doSearch = useCallback((dir: "next" | "prev") => {
    if (!searchRef.current || !searchQuery) return;
    if (dir === "next") searchRef.current.findNext(searchQuery);
    else searchRef.current.findPrevious(searchQuery);
  }, [searchQuery]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  // Connection dot color
  const dotColor = connState === "connected" ? "var(--term-green)" : connState === "connecting" ? "var(--term-amber)" : "var(--term-red)";
  const connLabel = connState === "connected" ? "Connected" : connState === "connecting" ? "Connecting..." : connState === "error" ? "Error" : "Disconnected";

  return (
    <div
      className="terminal-page"
      style={{
        ...THEME_VARS,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--term-bg-void)",
        padding: 0,
        margin: 0,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace",
      } as React.CSSProperties}
    >
      {/* ── Tab Bar ── */}
      <div
        style={{
          height: isMobile ? 32 : 36,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          background: "var(--term-bg-elevated)",
          borderBottom: "1px solid var(--term-text-dim)",
          fontSize: isMobile ? 12 : 13,
          color: "var(--term-text-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{isMobile ? "trevor" : "trevor-prime"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => setSearchOpen((p) => !p)}
            style={{
              background: "none",
              border: "none",
              color: searchOpen ? "var(--term-blue-core)" : "var(--term-text-secondary)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Search size={isMobile ? 16 : 14} />
          </button>
        </div>
      </div>

      {/* ── Search Bar ── */}
      {searchOpen && (
        <div
          style={{
            height: 32,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 8px",
            background: "var(--term-bg-surface)",
            borderBottom: "1px solid var(--term-text-dim)",
          }}
        >
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) searchRef.current?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch(e.shiftKey ? "prev" : "next");
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="Search..."
            style={{
              flex: 1,
              height: 24,
              background: "var(--term-bg-void)",
              color: "var(--term-text-primary)",
              border: "1px solid var(--term-text-dim)",
              borderRadius: 4,
              padding: "0 8px",
              fontSize: 11,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button onClick={() => doSearch("prev")} style={searchBtnStyle}><ChevronUp size={14} /></button>
          <button onClick={() => doSearch("next")} style={searchBtnStyle}><ChevronDown size={14} /></button>
          <button onClick={closeSearch} style={searchBtnStyle}><X size={14} /></button>
        </div>
      )}

      {/* ── Terminal Container ── */}
      <div
        ref={termContainerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative" }}
        onClick={() => termRef.current?.focus()}
      />

      {/* ── Reconnect Overlay ── */}
      {(connState === "disconnected" || connState === "error") && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(13,17,23,0.85)",
            gap: 12,
            zIndex: 10,
          }}
        >
          <span style={{ color: "var(--term-text-primary)", fontSize: isMobile ? 16 : 18, fontWeight: 600 }}>
            Connection Lost
          </span>
          <button
            onClick={connectTerminal}
            style={{
              background: "var(--term-blue-core)",
              color: "var(--term-bg-void)",
              border: "none",
              borderRadius: 8,
              height: 44,
              minWidth: 120,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Reconnect
          </button>
        </div>
      )}

      {/* ── Floating Key Toolbar (Mobile Only) ── */}
      {isMobile && (
        <div
          style={{
            height: 44,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            background: "var(--term-bg-elevated)",
            borderTop: "1px solid var(--term-text-dim)",
            borderBottom: "1px solid var(--term-text-dim)",
            overflowX: "auto",
            overflowY: "hidden",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
          }}
          className="hide-scrollbar"
        >
          {TOOLBAR_KEYS.map((k) => {
            const isCtrl = k.seq === "__ctrl__";
            const isAlt = k.seq === "__alt__";
            const active = (isCtrl && ctrlActive) || (isAlt && altActive);
            return (
              <button
                key={k.label}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleToolbarKey(k.seq);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleToolbarKey(k.seq);
                }}
                style={{
                  minWidth: k.w,
                  height: 34,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: active ? "var(--term-blue-core)" : "var(--term-bg-surface)",
                  color: active ? "var(--term-bg-void)" : "var(--term-text-primary)",
                  border: `1px solid ${active ? "var(--term-blue-bright)" : "var(--term-text-dim)"}`,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  userSelect: "none",
                  WebkitTapHighlightColor: "transparent",
                  padding: "0 8px",
                  boxShadow: active ? "0 0 8px rgba(88,166,255,0.15)" : "none",
                  transition: "background 0.1s ease",
                }}
              >
                {k.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Status Bar ── */}
      <div
        style={{
          height: isMobile ? 20 : 24,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          background: "var(--term-bg-elevated)",
          borderTop: "1px solid var(--term-text-dim)",
          fontSize: isMobile ? 10 : 12,
          color: "var(--term-text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor }} />
          <span>{connLabel}</span>
          {!isMobile && <span style={{ color: "var(--term-text-muted)" }}>trevor@trevor-prime</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{dims.rows}&times;{dims.cols}</span>
          {!isMobile && <span style={{ color: "var(--term-text-muted)" }}>{isMobile ? 13 : 14}px</span>}
        </div>
      </div>

      {/* Scoped scrollbar hide */}
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}

const searchBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--term-text-secondary)",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
  borderRadius: 4,
};
