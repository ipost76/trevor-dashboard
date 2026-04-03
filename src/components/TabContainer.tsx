"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, Suspense, useCallback } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabContainerProps {
  tabs: Tab[];
  defaultTab?: string;
  paramName?: string;
  pageTitle?: string;
}

function TabContainerInner({ tabs, defaultTab, paramName = "tab", pageTitle }: TabContainerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabStripRef = useRef<HTMLDivElement>(null);

  const paramTab = searchParams.get(paramName);
  const validTab = tabs.find(t => t.id === paramTab);
  const activeTab = validTab ? paramTab! : (defaultTab || tabs[0]?.id);

  const setActiveTab = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramName, id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, paramName, router, pathname]);

  // Auto-scroll active tab into view
  useEffect(() => {
    if (tabStripRef.current) {
      const activeEl = tabStripRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        (activeEl as HTMLElement).scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    }
  }, [activeTab]);

  const activeContent = tabs.find(t => t.id === activeTab)?.content;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Page title */}
      {pageTitle && (
        <div
          className="shrink-0"
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 16,
            fontWeight: 700,
            color: "#00ff88",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            padding: "16px 20px 12px",
          }}
        >
          {pageTitle}
        </div>
      )}

      {/* Tab strip */}
      <div
        ref={tabStripRef}
        className="shrink-0 flex overflow-x-auto scrollbar-hide"
        style={{
          borderBottom: "1px solid rgba(0,255,136,0.18)",
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--sidebar, #080d09)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            data-active={tab.id === activeTab ? "true" : undefined}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "shrink-0 flex items-center px-3.5 sm:px-5 text-[11px] sm:text-[12px] font-medium uppercase tracking-[0.08em] transition-colors duration-150 whitespace-nowrap",
              "border-b-2 min-h-[44px]",
              tab.id === activeTab
                ? "text-[#00ff88] border-[#00ff88] font-semibold"
                : "text-[#3d6b4a] border-transparent hover:text-[#7ab88a]"
            )}
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active tab panel */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {activeContent}
      </div>
    </div>
  );
}

export default function TabContainer(props: TabContainerProps) {
  return (
    <Suspense fallback={null}>
      <TabContainerInner {...props} />
    </Suspense>
  );
}
