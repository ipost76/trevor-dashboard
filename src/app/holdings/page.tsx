import { redirect } from "next/navigation";
export default function HoldingsRedirect() {
  redirect("/trading?tab=holdings");
}
