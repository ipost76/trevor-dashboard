export function DirectionBadge({ dir }: { dir: string }) {
  const isLong =
    dir?.toLowerCase() === "long" || dir?.toLowerCase() === "buy";
  return (
    <span className={isLong ? "badge-long" : "badge-short"}>
      {isLong ? "LONG" : "SHORT"}
    </span>
  );
}
