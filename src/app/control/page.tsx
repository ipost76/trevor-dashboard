import { redirect } from "next/navigation";
export default function ControlRedirect() {
  redirect("/command?tab=control");
}
