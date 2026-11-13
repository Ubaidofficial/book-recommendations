import type { SiteNav } from "./siteNav";

/**
 * Snapshot of the site-chrome data, taken from the live database on
 * 2026-11-12. Used only when the database cannot be read, so the header,
 * footer and homepage shelf still render real links to published pages.
 *
 * Covers are deliberately empty: a stale snapshot must never pair a title
 * with the wrong image, so fallback books get the neutral drawn cover.
 * Counts are as of the snapshot date.
 */
export const FALLBACK_NAV: SiteNav = {
  books: [
    { slug: "man-s-search-for-meaning-viktor-e-frankl", title: "Man's Search for Meaning", author: "Viktor E. Frankl", count: 90, pageCount: 140, cover: "" },
    { slug: "sapiens-yuval-noah-harari", title: "Sapiens", author: "Yuval Noah Harari", count: 88, pageCount: 520, cover: "" },
    { slug: "the-hard-thing-about-hard-things-ben-horowitz", title: "The Hard Thing About Hard Things", author: "Ben Horowitz", count: 54, pageCount: 232, cover: "" },
    { slug: "zero-to-one-peter-thiel", title: "Zero to One", author: "Peter Thiel", count: 54, pageCount: 225, cover: "" },
    { slug: "principles-ray-dalio", title: "Principles", author: "Ray Dalio", count: 53, pageCount: 592, cover: "" },
    { slug: "thinking-fast-and-slow-daniel-kahneman", title: "Thinking, Fast and Slow", author: "Daniel Kahneman", count: 53, pageCount: null, cover: "" },
    { slug: "atomic-habits-james-clear", title: "Atomic Habits", author: "James Clear", count: 52, pageCount: 221, cover: "" },
    { slug: "the-alchemist-paulo-coelho", title: "The Alchemist", author: "Paulo Coelho", count: 50, pageCount: 177, cover: "" },
    { slug: "shoe-dog-phil-knight", title: "Shoe Dog", author: "Phil Knight", count: 47, pageCount: 368, cover: "" },
    { slug: "atlas-shrugged-ayn-rand", title: "Atlas Shrugged", author: "Ayn Rand", count: 44, pageCount: 1193, cover: "" },
    { slug: "how-to-win-friends-and-influence-people-dale-carnegie", title: "How to Win Friends and Influence People", author: "Dale Carnegie", count: 43, pageCount: 240, cover: "" },
    { slug: "the-innovator-s-dilemma-clayton-m-christensen", title: "The Innovator's Dilemma", author: "Clayton M. Christensen", count: 41, pageCount: 336, cover: "" },
    { slug: "the-war-of-art-steven-pressfield", title: "The War of Art", author: "Steven Pressfield", count: 37, pageCount: 195, cover: "" },
    { slug: "meditations-marcus-aurelius", title: "Meditations", author: "Marcus Aurelius", count: 37, pageCount: 228, cover: "" },
    { slug: "snow-crash-neal-stephenson", title: "Snow Crash", author: "Neal Stephenson", count: 33, pageCount: 484, cover: "" },
    { slug: "the-four-agreements-don-miguel-ruiz", title: "The Four Agreements", author: "Don Miguel Ruiz", count: 33, pageCount: 161, cover: "" },
    { slug: "range-david-epstein", title: "Range", author: "David Epstein", count: 32, pageCount: 209, cover: "" },
    { slug: "give-and-take-adam-grant", title: "Give and Take", author: "Adam Grant", count: 30, pageCount: 373, cover: "" },
  ],
  people: [
    { slug: "bill-gates", name: "Bill Gates", avatar: "", count: 310 },
    { slug: "naval-ravikant", name: "Naval Ravikant", avatar: "", count: 219 },
    { slug: "tim-ferriss", name: "Tim Ferriss", avatar: "", count: 176 },
    { slug: "paul-graham", name: "Paul Graham", avatar: "", count: 150 },
    { slug: "nat-eliason", name: "Nat Eliason", avatar: "", count: 146 },
    { slug: "patrick-collison", name: "Patrick Collison", avatar: "", count: 145 },
    { slug: "jordan-peterson", name: "Jordan Peterson", avatar: "", count: 144 },
    { slug: "marc-andreessen", name: "Marc Andreessen", avatar: "", count: 142 },
    { slug: "derek-sivers", name: "Derek Sivers", avatar: "", count: 142 },
    { slug: "ryan-holiday", name: "Ryan Holiday", avatar: "", count: 135 },
    { slug: "noam-chomsky", name: "Noam Chomsky", avatar: "", count: 133 },
    { slug: "barack-obama", name: "Barack Obama", avatar: "", count: 130 },
  ],
  topics: [
    { slug: "nonfiction", title: "Nonfiction", count: 7818 },
    { slug: "fiction", title: "Fiction", count: 4717 },
    { slug: "social-sciences", title: "Social Sciences", count: 1921 },
    { slug: "history", title: "History", count: 1663 },
    { slug: "science", title: "Science", count: 1440 },
    { slug: "business", title: "Business", count: 1248 },
    { slug: "children-s", title: "Children's", count: 1100 },
    { slug: "personal-development", title: "Personal Development", count: 1003 },
    { slug: "psychology", title: "Psychology", count: 965 },
    { slug: "art", title: "Art", count: 853 },
  ],
  recommendedBy: [
    { slug: "books-recommended-by-bill-gates", title: "Books Recommended by Bill Gates", count: 75 },
    { slug: "books-recommended-by-naval-ravikant", title: "Books Recommended by Naval Ravikant", count: 75 },
    { slug: "books-recommended-by-tim-ferriss", title: "Books Recommended by Tim Ferriss", count: 75 },
    { slug: "books-recommended-by-paul-graham", title: "Books Recommended by Paul Graham", count: 75 },
    { slug: "books-recommended-by-elon-musk", title: "Books Recommended by Elon Musk", count: 75 },
    { slug: "books-recommended-by-ryan-holiday", title: "Books Recommended by Ryan Holiday", count: 75 },
    { slug: "books-recommended-by-warren-buffett", title: "Books Recommended by Warren Buffett", count: 70 },
    { slug: "books-recommended-by-founders", title: "Books Recommended by Founders", count: 75 },
    { slug: "books-recommended-by-investors", title: "Books Recommended by Investors", count: 75 },
    { slug: "books-recommended-by-ceos", title: "Books Recommended by CEOs", count: 75 },
    { slug: "books-recommended-by-billionaires", title: "Books Recommended by Billionaires", count: 75 },
    { slug: "books-recommended-by-writers", title: "Books Recommended by Writers", count: 75 },
  ],
  popularLists: [
    { slug: "best-math-books", title: "Best Math Books", count: 189 },
    { slug: "best-horror-books", title: "Best Horror Books", count: 138 },
    { slug: "best-fashion-books", title: "Best Fashion Books", count: 120 },
    { slug: "best-time-travel-books", title: "Best Time Travel Books", count: 113 },
    { slug: "best-nutrition-books", title: "Best Nutrition Books", count: 112 },
    { slug: "best-young-adult-books", title: "Best Young Adult Books", count: 109 },
    { slug: "best-space-opera-books", title: "Best Space Opera Books", count: 104 },
    { slug: "best-gardening-books", title: "Best Gardening Books", count: 99 },
    { slug: "best-sales-books", title: "Best Sales Books", count: 98 },
    { slug: "best-civil-war-books", title: "Best Civil War Books", count: 94 },
  ],
};
