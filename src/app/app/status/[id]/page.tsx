import type { Metadata } from "next";
import { StatusPageManageClient } from "./page-client";

export const metadata: Metadata = {
  title: "Manage status page — Dreyv",
};

export default async function StatusManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StatusPageManageClient pageId={id} />;
}
