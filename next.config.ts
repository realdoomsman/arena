import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Keep the Solana SDK on the server.
   *
   * @solana/web3.js pulls in rpc-websockets, which imports `ws` — a Node-only
   * package. Without this, Turbopack tries to trace it into the client graph
   * (via custody.ts → bot-provision.ts → page.tsx) and floods the overlay with
   * an unresolvable import. Nothing in the browser ever needs web3.js here:
   * every key operation is server-side by design, because the wallets are
   * custodial.
   */
  serverExternalPackages: ["@solana/web3.js", "@solana/spl-token", "rpc-websockets"],
};

export default nextConfig;
