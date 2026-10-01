/** @type {import('next').NextConfig} */
const nextConfig = {
  // Note on response compression: `compress: true` does NOT compress App Router
  // route handler (`app/api/**/route.js`) JSON in Next.js 15 — the server no
  // longer bundles the `compression` middleware, so the flag has no effect on
  // these responses (verified by inspecting the response headers on a 630 kB
  // payload). The list/report endpoints therefore compress themselves in
  // `okGzip()` (lib/validate.js), which honours `Accept-Encoding`, sets `Vary`,
  // and only kicks in above 1 kB. Static assets and HTML are still compressed
  // by the platform (Vercel/CDN) as usual.
  //
  // Everything else is intentionally left at its defaults: Vercel + Neon needs
  // no special configuration.
};

export default nextConfig;
