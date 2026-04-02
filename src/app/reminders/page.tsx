import { redirect } from "next/navigation";
export default function RemindersRedirect() {
  redirect("/command?tab=reminders");
}
