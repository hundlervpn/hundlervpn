import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  outputFileTracingIncludes: {
    '/**': ['./node_modules/next/dist/compiled/@mswjs/**/*'],
  },
  // Pretty subscription URL: users get https://hundlervpn.xyz/sub/<token>
  // instead of the internal /api/sub/<token> path. Same handler, no redirect
  // (a rewrite is server-side, so VPN clients see a clean 200 on the URL they
  // were given). The /api/sub/... form keeps working for every link already
  // saved in a user's client.
  async rewrites() {
    return [{ source: '/sub/:token', destination: '/api/sub/:token' }];
  },
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
