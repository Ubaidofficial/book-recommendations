/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Apply X-Robots-Tag to every route on this deployment.
        // Googlebot and all compliant crawlers respect HTTP headers,
        // so this blocks indexing regardless of per-page meta tags.
        source: "/(.*)",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
    ];
  },

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
      // Batch-2 duplicate recommender consolidation (2026-06-03).
      // 15 surname-only slugs redirected to their full-name canonical.
      // Source of truth: rebuild_v2/people_duplicate_batch2_redirect_map_v1.json
      {
        source: "/people/graham",
        destination: "/people/paul-graham",
        permanent: true,
      },
      {
        source: "/people/chomsky",
        destination: "/people/noam-chomsky",
        permanent: true,
      },
      {
        source: "/people/willink",
        destination: "/people/jocko-willink",
        permanent: true,
      },
      {
        source: "/people/holiday",
        destination: "/people/ryan-holiday",
        permanent: true,
      },
      {
        source: "/people/winfrey",
        destination: "/people/oprah-winfrey",
        permanent: true,
      },
      {
        source: "/people/branson",
        destination: "/people/richard-branson",
        permanent: true,
      },
      {
        source: "/people/taleb",
        destination: "/people/nassim-nicholas-taleb",
        permanent: true,
      },
      {
        source: "/people/khosla",
        destination: "/people/vinod-khosla",
        permanent: true,
      },
      {
        source: "/people/dalio",
        destination: "/people/ray-dalio",
        permanent: true,
      },
      {
        source: "/people/rogan",
        destination: "/people/joe-rogan",
        permanent: true,
      },
      {
        source: "/people/godin",
        destination: "/people/seth-godin",
        permanent: true,
      },
      {
        source: "/people/musk",
        destination: "/people/elon-musk",
        permanent: true,
      },
      {
        source: "/people/altman",
        destination: "/people/sam-altman",
        permanent: true,
      },
      {
        source: "/people/buffett",
        destination: "/people/warren-buffett",
        permanent: true,
      },
      {
        source: "/people/zuckerberg",
        destination: "/people/mark-zuckerberg",
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
