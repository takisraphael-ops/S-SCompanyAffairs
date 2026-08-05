import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The `postgres` driver is server-only; keep it out of any client bundle.
  serverExternalPackages: ["postgres"],

  /*
   * Treat the loopback address as the same origin as `localhost`.
   *
   * The dev server blocks cross-origin requests for its own assets, and the
   * origin it starts with is `localhost` — so opening the app at 127.0.0.1
   * instead serves the HTML but 403s a script chunk. The failure is nastier
   * than it sounds: the page renders correctly, because it is server-rendered,
   * and then simply never hydrates. Nothing is interactive, no error is shown,
   * and the only evidence is one request in the network panel.
   *
   * `[::1]` is deliberately absent. It would only matter to someone typing the
   * IPv6 loopback literally — reaching the app through a `localhost` that
   * resolves to ::1 still sends `localhost` as the origin — and it could not
   * be tested here, so it is left out rather than added on the assumption
   * that it works.
   *
   * Development only; this option has no effect on a production build.
   */
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
