// Self-checks for the book page v4 pure helpers (no test framework).
// Run: node --experimental-strip-types scripts/selfcheck_book_v4.mjs
import assert from "node:assert/strict";
import { classifyRole, breakdownRoles, cleanRole } from "../src/lib/roles.ts";
import { classifySource, ownedDomainSlug } from "../src/lib/sourceKind.ts";

let n = 0;
const eq = (actual, expected, msg) => { assert.equal(actual, expected, msg); n++; };

// ── roles ──────────────────────────────────────────────────────────────────
const roleCases = [
  ["Co-founder of Microsoft; co-chair of the Gates Foundation", "founders"],
  ["Co-founder of AngelList; angel investor", "founders"],
  ["Author; founder of CD Baby", "writers"],
  ["Technology executive and investor", "founders"],
  ["Indian-American businessman", "founders"],
  ["founder and CEO of Gumroad", "founders"],
  ["American broadcaster, comedian, and actor (born 1967)", "media"],
  ["American writer, educator, and entrepreneur in the field of consumer psychology (1980-)", "writers"],
  ["Author of Atomic Habits", "writers"],
  ["Founder of Bridgewater Associates", "founders"],
  ["Venture capitalist", "investors"],
  ["Hedge fund manager and philanthropist", "investors"],
  ["44th President of the United States", "politics"],
  ["Former Prime Minister of the United Kingdom", "politics"],
  ["President of Y Combinator", "founders"],
  ["Professor of psychology at Stanford", "scientists"],
  ["Theoretical physicist", "scientists"],
  ["British radio presenter", "media"],
  ["American actor and film producer (born 1956)", "media"],
  ["English cyclist, adventurer, author and motivational speaker", "media"],
  ["crypto promoter", "other"],
  ["Philanthropist", "other"],
  ["Australian activist and lecturer", "other"],
  ["Head of the Federal Reserve's authority on ghost towns", "other"], // no false "author"/"host"
];
for (const [role, want] of roleCases) eq(classifyRole(role), want, `classifyRole(${JSON.stringify(role)})`);

eq(classifyRole(null), null, "null role");
eq(classifyRole(""), null, "empty role");
eq(classifyRole("(born 1966)"), null, "parenthetical-only role is no role");
eq(cleanRole("  Author (born 1950) "), "Author", "cleanRole strips parentheticals");

const bd = breakdownRoles(["Author", "Novelist", "Investor", null, "", "(born 1966)", "crypto promoter", "CEO of Acme"]);
eq(bd.withoutRole, 3, "breakdown withoutRole");
eq(bd.withRole, 5, "breakdown withRole");
eq(bd.classified, 4, "breakdown classified excludes Other");
eq(bd.buckets[0].bucket, "writers", "largest bucket first");
eq(bd.buckets[bd.buckets.length - 1].bucket, "other", "Other last");

// ── sources ────────────────────────────────────────────────────────────────
const naval = { slug: "naval-ravikant", name: "Naval Ravikant", twitter_handle: "naval" };
const rogan = { slug: "joe-rogan", name: "Joe Rogan", twitter_handle: null };
const clear = { slug: "james-clear", name: "James Clear", twitter_handle: null };
const gates = { slug: "bill-gates", name: "Bill Gates", twitter_handle: "billgates" };
const branson = { slug: "richard-branson", name: "Richard Branson", twitter_handle: "richardbranson" };

let c = classifySource("https://twitter.com/naval/status/123", naval);
eq(c.kind, "tweet"); eq(c.own, true, "own handle tweet is own"); eq(c.note, "Their own account (@naval)");
c = classifySource("https://x.com/paulg/status/1", naval);
eq(c.kind, "tweet"); eq(c.own, false, "foreign tweet not own");
c = classifySource("https://twitter.com/joerogan/status/1077696476166410241", rogan);
eq(c.own, true, "handle matching slug counts as own when handle unknown");
c = classifySource("https://jamesclear.com/best-books/nonfiction", clear);
eq(c.kind, "own_site"); eq(c.own, true);
c = classifySource("https://www.gatesnotes.com/Books/Sapiens", gates);
eq(c.kind, "own_site", "owned domain map"); eq(c.own, true);
eq(ownedDomainSlug("https://www.gatesnotes.com/x"), "bill-gates");
c = classifySource("https://sivers.org/book/Sapiens", gates);
eq(c.kind === "own_site", false, "someone else's owned domain is not own");
c = classifySource("https://tim.blog/2017/10/09/richard-branson/", branson);
eq(c.kind, "podcast"); eq(c.own, false);
c = classifySource("https://www.youtube.com/watch?v=abc", naval);
eq(c.kind, "youtube");
c = classifySource("https://en.wikipedia.org/wiki/Mark_Zuckerberg_book_club", naval);
eq(c.kind, "other");
c = classifySource("https://www.thereadinglists.com/nir-eyal-interview/", naval);
eq(c.kind, "article"); eq(c.label, "Interview");
c = classifySource("https://www.nytimes.com/2019/01/01/books/review/by-the-book.html", naval);
eq(c.kind, "article"); eq(c.label, "Article");
c = classifySource("https://example.com/podcast/episode-12", naval);
eq(c.kind, "podcast", "podcast path");
c = classifySource("https://medium.com/@naval/some-post", naval);
eq(c.kind, "own_site", "medium under own handle");

console.log(`ok: ${n} checks passed`);
