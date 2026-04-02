import { redirect } from "next/navigation";
export default function AutoTraderRedirect() {
  redirect("/trading?tab=autotrader");
}
