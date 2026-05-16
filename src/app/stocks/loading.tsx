import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-3">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
