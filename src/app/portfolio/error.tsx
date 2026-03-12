"use client";
import PageError from "@/components/page-error";
export default function PortfolioError({ error, reset }: { error: Error; reset: () => void }) {
  return <PageError error={error} reset={reset} />;
}
