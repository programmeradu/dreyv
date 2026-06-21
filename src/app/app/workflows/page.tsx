import type { Metadata } from "next";
import { WorkflowsClient } from "./workflows-client";

export const metadata: Metadata = {
  title: "Workflows — Dreyv",
  description: "Define, run and inspect capability DAGs against the Dreyv registry.",
};

export default function WorkflowsPage() {
  return <WorkflowsClient />;
}
