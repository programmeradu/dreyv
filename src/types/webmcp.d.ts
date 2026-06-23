// WebMCP form annotations — non-standard HTML attributes used by AI-agent
// readiness scanners (agentskills.io, webmcp.basgr.com). React passes
// unknown lowercased attributes through to the DOM unchanged; we declare
// them here so TSX type-checks accept them.

import "react";

declare module "react" {
  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    toolautosubmit?: string;
  }
  interface InputHTMLAttributes<T> {
    toolparamdescription?: string;
  }
  interface TextareaHTMLAttributes<T> {
    toolparamdescription?: string;
  }
}
