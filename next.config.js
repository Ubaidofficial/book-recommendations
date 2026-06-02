/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/people/gates",
        destination: "/people/bill-gates",
        permanent: true,
      },
      {
        source: "/people/ravikant",
        destination: "/people/naval-ravikant",
        permanent: true,
      },
      {
        source: "/people/andreessen",
        destination: "/people/marc-andreessen",
        permanent: true,
      },
      {
        source: "/people/obama",
        destination: "/people/barack-obama",
        permanent: true,
      },
      {
        source: "/people/ferriss",
        destination: "/people/tim-ferriss",
        permanent: true,
      },
      {
        source: "/people/collison",
        destination: "/people/patrick-collison",
        permanent: true,
      },
      {
        source: "/people/peterson",
        destination: "/people/jordan-peterson",
        permanent: true,
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

module.exports = nextConfig;
