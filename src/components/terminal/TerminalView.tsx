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
  { label: "Scroll", seq: "__scroll__", w: 52 },
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
  const [scrollActive, setScrollActive] = useState(false);
  const [dims, setDims] = useState({ cols: 80, rows: 24 });
  const [isMobile, setIsMobile] = useState(false);
  const [toolbarBottom, setToolbarBottom] = useState(56); // default: above Hub bottom tab bar (56px)

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

  // Handle toolbar key press — onClick with 300ms debounce guard
  const lastToolbarTap = useRef(0);
  const handleToolbarKey = useCallback((seq: string) => {
    const now = Date.now();
    if (now - lastToolbarTap.current < 300) return;
    lastToolbarTap.current = now;

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
    if (seq === "__scroll__") {
      if (scrollActive) {
        wsSend("q");
        setScrollActive(false);
      } else {
        wsSend("\x02[");
        setScrollActive(true);
      }
      return;
    }
    // Esc exits scroll mode if active
    if (scrollActive && seq === "\x1b") {
      wsSend("q");
      setScrollActive(false);
      return;
    }
    // In scroll mode, arrows send Ctrl+U/Ctrl+D for half-page scroll
    if (scrollActive && seq === "\x1b[A") { wsSend("\x15"); return; }
    if (scrollActive && seq === "\x1b[B") { wsSend("\x04"); return;
    }
    wsSend(seq);
  }, [wsSend, scrollActive]);

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
      scrollSensitivity: mobile ? 3 : 1,
      fastScrollSensitivity: mobile ? 10 : 5,
      smoothScrollDuration: 100,
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

  // visualViewport resize for mobile keyboard (debounced) + toolbar positioning
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let vvTimeout: ReturnType<typeof setTimeout>;
    const handleVVResize = () => {
      clearTimeout(vvTimeout);
      vvTimeout = setTimeout(() => {
        // Position toolbar above keyboard
        const keyboardHeight = window.innerHeight - vv.height;
        const hubTabBar = 56; // Hub bottom tab bar height
        if (keyboardHeight > 100) {
          // Keyboard is open — toolbar sits above keyboard
          setToolbarBottom(keyboardHeight);
        } else {
          // Keyboard closed — toolbar sits above Hub tab bar
          setToolbarBottom(hubTabBar);
        }
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
  const dotColor = connState === "connected" ? "#3fb950" : connState === "connecting" ? "#d29922" : "#f85149";
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
        background: "#0d1117",
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
          background: "#1c2333",
          borderBottom: "1px solid #30363d",
          fontSize: isMobile ? 12 : 13,
          color: "#e6edf3",
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
              color: searchOpen ? "#58a6ff" : "#8b949e",
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
            background: "#161b22",
            borderBottom: "1px solid #30363d",
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
              background: "#0d1117",
              color: "#e6edf3",
              border: "1px solid #30363d",
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
        style={{ flex: 1, overflow: "hidden", position: "relative", touchAction: "none" }}
        onClick={(e) => {
          // Only focus on tap (not drag/scroll). Check if it was a clean click.
          if (!(e as unknown as { detail?: number }).detail || (e as unknown as { detail: number }).detail <= 1) {
            termRef.current?.focus();
          }
        }}
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
          <span style={{ color: "#e6edf3", fontSize: isMobile ? 16 : 18, fontWeight: 600 }}>
            Connection Lost
          </span>
          <button
            onClick={connectTerminal}
            style={{
              background: "#58a6ff",
              color: "#0d1117",
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

      {/* ── Floating Key Toolbar (Mobile Only) — fixed above keyboard ── */}
      {isMobile && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: toolbarBottom,
            height: 44,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 8px",
            background: "#1c2333",
            borderTop: "1px solid #30363d",
            borderBottom: "1px solid #30363d",
            overflowX: "auto",
            overflowY: "hidden",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
            touchAction: "pan-x",
          }}
          className="hide-scrollbar"
        >
          {TOOLBAR_KEYS.map((k) => {
            const isCtrl = k.seq === "__ctrl__";
            const isAlt = k.seq === "__alt__";
            const isScroll = k.seq === "__scroll__";
            const active = (isCtrl && ctrlActive) || (isAlt && altActive) || (isScroll && scrollActive);
            return (
              <button
                key={k.label}
                onClick={() => handleToolbarKey(k.seq)}
                style={{
                  minWidth: k.w,
                  height: 34,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: active ? "#58a6ff" : "#161b22",
                  color: active ? "#0d1117" : "#e6edf3",
                  border: `1px solid ${active ? "#79c0ff" : "#30363d"}`,
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
          background: "#1c2333",
          borderTop: "1px solid #30363d",
          fontSize: isMobile ? 10 : 12,
          color: "#8b949e",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor }} />
          <span>{connLabel}</span>
          {!isMobile && <span style={{ color: "#484f58" }}>trevor@trevor-prime</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{dims.rows}&times;{dims.cols}</span>
          {!isMobile && <span style={{ color: "#484f58" }}>{isMobile ? 13 : 14}px</span>}
        </div>
      </div>

      {/* Scoped styles: scrollbar hide + blue theme overrides */}
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .terminal-page { background: #0d1117 !important; }
        .terminal-page .xterm { background-color: #0d1117 !important; }
        .terminal-page .xterm-viewport { background-color: #0d1117 !important; }
        .terminal-page .xterm-screen { background-color: #0d1117 !important; }
      `}</style>
    </div>
  );
}

const searchBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#8b949e",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
  borderRadius: 4,
};
