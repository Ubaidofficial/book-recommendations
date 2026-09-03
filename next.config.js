/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Baseline security headers. Absent entirely before this — an audit
        // flagged no HSTS, no nosniff, no referrer policy, no framing rule.
        // None of these change rendering; they are the defaults a reviewer
        // (or a security scanner feeding a quality score) expects to see.
        source: "/(.*)",
        headers: [
          // Two years, preload-eligible. The site is HTTPS-only already and
          // www 301s to the apex, so subdomains inherit safely.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Stop content-type sniffing turning a text response into script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send the origin cross-site, the full path same-origin — keeps
          // referral analytics working without leaking full URLs outward.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No reason for any page here to be framed.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        // Block indexing on the Railway staging subdomain.
        source: "/(.*)",
        has: [{ type: "host", value: "book-recommendations-production-1657.up.railway.app" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // Also block www subdomain — canonical is non-www bookmentions.net.
        // www is redirected (see redirects below) but belt-and-suspenders.
        source: "/(.*)",
        has: [{ type: "host", value: "www.bookmentions.net" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },

  async redirects() {
    return [
      {
        // Redirect www → non-www to consolidate canonical domain.
        // Prevents duplicate indexing of www.bookmentions.net vs bookmentions.net.
        source: "/:path*",
        has: [{ type: "host", value: "www.bookmentions.net" }],
        destination: "https://bookmentions.net/:path*",
        permanent: true,
      },
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
      // The apostrophe in "Matt D'Avella" survived import as the Windows-1252
      // escape `_x0092_`, which ended up baked into both the stored name and
      // the slug. Both are repaired; this keeps the indexed URL alive.
      {
        source: "/people/matt-d-x0092-avella",
        destination: "/people/matt-davella",
        permanent: true,
      },
      // Same apostrophe-loss class as the person slug above: "Children's
      // Fiction" was stored as "Children'sFiction" and slugged from the
      // mangled form.
      {
        source: "/lists/children-sfiction",
        destination: "/lists/childrens-fiction",
        permanent: true,
      },
      // Ten topics were published twice — a bare category list and a
      // "best-<topic>-books" twin — so after list titles were unified both
      // rendered the same H1 and competed for one query. The bare list is the
      // superset in every pair (psychology 961 books vs 58), so it survives
      // and absorbs the twin's exclusive titles; the twin redirects here.
      // The surviving page still reads "Best Psychology Books", because the
      // title comes from displayListTitleFull rather than from the slug.
      {
        source: "/lists/best-science-fiction-books",
        destination: "/lists/science-fiction",
        permanent: true,
      },
      {
        source: "/lists/best-art-books",
        destination: "/lists/art",
        permanent: true,
      },
      {
        source: "/lists/best-architecture-books",
        destination: "/lists/architecture",
        permanent: true,
      },
      {
        source: "/lists/best-poetry-books",
        destination: "/lists/poetry",
        permanent: true,
      },
      {
        source: "/lists/best-design-books",
        destination: "/lists/design",
        permanent: true,
      },
      {
        source: "/lists/best-photography-books",
        destination: "/lists/photography",
        permanent: true,
      },
      {
        source: "/lists/best-physics-books",
        destination: "/lists/physics",
        permanent: true,
      },
      {
        source: "/lists/best-philosophy-books",
        destination: "/lists/philosophy",
        permanent: true,
      },
      {
        source: "/lists/best-psychology-books",
        destination: "/lists/psychology",
        permanent: true,
      },
      {
        source: "/lists/best-leadership-books",
        destination: "/lists/leadership",
        permanent: true,
      },
      // mathscience mixed a merged-category import artifact with no science
      // content at all — all 108 books were math/statistics/probability.
      // The 35 not already in best-math-books were folded in there; this
      // list is now noindexed and redirects to the surviving twin.
      {
        source: "/lists/mathscience",
        destination: "/lists/best-math-books",
        permanent: true,
      },
      // romancefiction targeted "best romance fiction books" (20 searches/mo)
      // while the separate romance list already owns "best romance books"
      // (7,900/mo) — pure cannibalization. romancefiction is now noindexed.
      {
        source: "/lists/romancefiction",
        destination: "/lists/romance",
        permanent: true,
      },
      // Same bare-category-vs-best-X-books pair as the ten above, missed in
      // that batch: children-s (1,100 books) and best-childrens-books (88)
      // were both published and both rendered "Best Childrens Books". The
      // 24 books unique to best-childrens-books were folded into children-s;
      // best-childrens-books is now noindexed.
      {
        source: "/lists/best-childrens-books",
        destination: "/lists/children-s",
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
