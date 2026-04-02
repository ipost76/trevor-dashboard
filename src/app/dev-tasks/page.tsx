import { redirect } from "next/navigation";
export default function DevTasksRedirect() {
  redirect("/command?tab=devtasks");
}
