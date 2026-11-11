/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // keep the dev badge out of screen recordings
  devIndicators: false,
  transpilePackages: ['three'],
};
export default nextConfig;
