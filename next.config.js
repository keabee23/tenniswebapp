/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static ships a native binary — exclude from webpack bundling
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'ffmpeg-static', 'ffprobe-static'];
    }
    return config;
  },
};

module.exports = nextConfig;
