import { redirect } from "next/navigation"

export default function Page() {
  // The pipeline always starts at the configuration stage.
  redirect("/configure")
}
