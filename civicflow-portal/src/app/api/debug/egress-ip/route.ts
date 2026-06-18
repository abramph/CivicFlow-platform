export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch("https://api.ipify.org?format=json");
  const data = await res.json();
  return Response.json({ ip: data.ip });
}
