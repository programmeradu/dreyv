import { redirect } from "next/navigation";

// Short link to the REST API reference.
export const dynamic = "force-static";

export default function ApiDocsShortLink() {
  redirect("/developers/api");
}
