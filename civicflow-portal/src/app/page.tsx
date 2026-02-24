import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.api_key) {
    redirect("/dashboard");
  }
  redirect("/login");
}
