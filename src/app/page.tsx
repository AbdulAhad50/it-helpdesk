import { redirect } from "next/navigation";

// The public complaint portal is the front door. (/complaint is built in Phase 3.)
export default function HomePage() {
  redirect("/complaint");
}
