/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@modelcontract/core",
    "@modelcontract/brightdata",
    "@modelcontract/db",
    "@modelcontract/cli",
  ],
};

export default nextConfig;
