"use client";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { StatusBar } from "@/components/status-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTerminal = pathname === "/terminal";

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div
      className={`relative z-10 flex h-screen supports-[height:100dvh]:h-[100dvh] overflow-hidden text-foreground ${isTerminal ? "" : "bg-background"}`}
      style={isTerminal ? { backgroundColor: "#0d1117" } : undefined}
    >
      <Sidebar />
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden w-full"
        style={isTerminal ? { backgroundColor: "#0d1117" } : undefined}
      >
        <Header />
        <main
          className="flex flex-1 overflow-hidden pb-14 md:pb-0 w-full max-w-full"
          style={isTerminal ? { backgroundColor: "#0d1117" } : undefined}
        >
          {children}
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
