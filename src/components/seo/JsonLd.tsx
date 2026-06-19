import { buildHomeJsonLd, buildRootJsonLd } from "@/lib/seo/json-ld";

export function RootJsonLd() {
  const data = buildRootJsonLd();
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function HomeJsonLd() {
  const data = buildHomeJsonLd();
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
