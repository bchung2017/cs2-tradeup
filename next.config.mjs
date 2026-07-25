/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native addon (loads a .node binary via dynamic require).
  // Bundling it makes Turbopack trace the whole project into every route's NFT
  // list; keeping it external loads it as a plain runtime require instead.
  serverExternalPackages: ["better-sqlite3"],
};
export default nextConfig;
