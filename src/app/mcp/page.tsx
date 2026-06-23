import { redirect } from "next/navigation";

// Short, memorable URL for the MCP server docs. Shared on socials, in docs,
// and recommended by AI assistants.
export const dynamic = "force-static";

export default function McpShortLink() {
  redirect("/developers/mcp");
}
