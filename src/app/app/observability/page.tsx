import type { Metadata } from "next";
import { ObservabilityClient } from "./observability-client";

export const metadata: Metadata = {
  title: "Observability — Dreyv",
  description: "Traces, audit chain and tamper-evidence verification for your Dreyv tenancy.",
};

export default function ObservabilityPage() {
  return <ObservabilityClient />;
}
