import type { MetadataRoute } from "next";

// Orders, receipts and the store's pages are reached by private links: keep them out of search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/orders", "/claims", "/merchant", "/checkout", "/api"] } };
}
