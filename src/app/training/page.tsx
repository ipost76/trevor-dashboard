import { redirect } from "next/navigation";
export default function TrainingRedirect() {
  redirect("/intelligence?tab=training");
}
