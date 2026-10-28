/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * The browser always calls the API through the same origin (/api/...), so the
   * client needs no CORS knowledge. The Next server proxies to the real API.
   * Set API_PROXY_TARGET when the API is not on the default port.
   * Set NEXT_PUBLIC_API_URL only if the client must call a remote API directly.
   */
  async rewrites() {
    const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
