"use client";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { StatusBar } from "@/components/status-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="relative z-10 flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex flex-1 overflow-hidden pb-14 md:pb-0">
          {children}
        </main>
        <div className="hidden md:block">
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
