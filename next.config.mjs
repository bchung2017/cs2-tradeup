/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep these server-only DB drivers out of the bundle. better-sqlite3 is a
  // native addon (loads a .node binary via dynamic require) whose bundling makes
  // Turbopack trace the whole project into every route's NFT list; pg does its
  // own optional-native and dynamic requires. Both load as plain runtime
  // requires instead.
  serverExternalPackages: ["better-sqlite3", "pg"],
};
export default nextConfig;
