import type { Metadata } from "next";
import { DeveloperHubClient } from "./developer-client";

export const metadata: Metadata = {
  title: "Developer hub — Dreyv",
  description: "API keys, webhooks, OpenAPI & MCP manifests — everything you need to ship against Dreyv.",
};

export default function DeveloperHubPage() {
  return <DeveloperHubClient />;
}
