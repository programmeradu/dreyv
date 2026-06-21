import type { Metadata } from "next";
import { StatusOwnerClient } from "./status-client";

export const metadata: Metadata = {
  title: "Status pages — Dreyv",
  description: "Create and manage your public status pages, incidents, maintenance windows and subscribers.",
};

export default function StatusOwnerPage() {
  return <StatusOwnerClient />;
}
