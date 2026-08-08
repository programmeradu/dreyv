import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppAgentsClaimRedirect({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  redirect(token ? `/claim?token=${encodeURIComponent(token)}` : "/claim");
}
