import { Book, Person, BookList, Series } from "@/lib/data";
import { isValidHttpUrl, isValidRating, isUsefulDescription } from "@/lib/dataQuality";
import { sameAsFor, personSlugForAuthor } from "@/lib/entityLinks";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bookmentions.net";

/**
 * A Book node for use inside an ItemList.
 *
 * Carries the same `@id` the book's own page emits, so a title appearing on
 * ten list pages resolves to one entity rather than ten anonymous nodes that
 * happen to share a name — and the author resolves to their profile node when
 * they have one here.
 */
function bookListItem(book: Book): Record<string, unknown> {
  const bookUrl = `${BASE_URL}/books/${book.slug}`;
  const item: Record<string, unknown> = {
    "@type": "Book",
    "@id": `${bookUrl}#book`,
    name: book.title,
    url: bookUrl,
  };
  if (book.author) {
    const author: Record<string, unknown> = { "@type": "Person", name: book.author };
    const authorSlug = book.author_slug || personSlugForAuthor(book.author);
    if (authorSlug) author["@id"] = `${BASE_URL}/people/${authorSlug}#person`;
    item.author = author;
  }
  if (isValidHttpUrl(book.cover_image_url)) item.image = book.cover_image_url;
  return item;
}

export function bookJsonLd(book: Book | null, slug?: string): Record<string, unknown>[] {
  if (!book || !book.title) return [];
  
  const bookUrl = `${BASE_URL}/books/${slug || book.slug}`;

  const mainEntity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Book",
    "@id": `${bookUrl}#book`,
    name: book.title,
    url: bookUrl,
    inLanguage: "en",
    mainEntityOfPage: bookUrl,
  };

  if (book.author) {
    // When the author has a page here, give the node that @id so the book and
    // the author profile resolve to one entity rather than two loose names.
    const author: Record<string, unknown> = { "@type": "Person", name: book.author };
    // author_slug is absent from the production schema, so fall back to
    // resolving the display name against published profiles.
    const authorSlug = book.author_slug || personSlugForAuthor(book.author);
    if (authorSlug) {
      const authorUrl = `${BASE_URL}/people/${authorSlug}`;
      author["@id"] = `${authorUrl}#person`;
      author.url = authorUrl;
      const authorSameAs = sameAsFor(authorSlug);
      if (authorSameAs.length > 0) author.sameAs = authorSameAs;
    }
    mainEntity.author = author;
  }
  if (book.isbn_13 || book.isbn_10) {
    mainEntity.isbn = book.isbn_13 || book.isbn_10;
  }
  if (isValidHttpUrl(book.cover_image_url)) {
    mainEntity.image = book.cover_image_url;
  }
  if (book.page_count && book.page_count > 0) {
    mainEntity.numberOfPages = book.page_count;
  }
  if (isUsefulDescription(book.description)) {
    mainEntity.description = book.description.trim();
  }
  if (isValidRating(book.rating) && book.recommendation_count && book.recommendation_count > 0) {
    mainEntity.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: book.rating,
      bestRating: 5,
      worstRating: 1,
      reviewCount: book.recommendation_count,
    };
  }

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Books", item: `${BASE_URL}/books` },
      { "@type": "ListItem", position: 3, name: book.title, item: bookUrl },
    ],
  };

  return [mainEntity, breadcrumbs];
}

export function personJsonLd(person: Person | null): Record<string, unknown>[] {
  if (!person) return [];
  const personUrl = `${BASE_URL}/people/${person.slug}`;
  
  const mainEntity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    // A stable @id lets every other page that mentions this person point at
    // one node instead of minting an anonymous duplicate each time.
    "@id": `${personUrl}#person`,
    name: person.name,
    url: personUrl,
    mainEntityOfPage: personUrl,
  };

  // sameAs is the entity signal that reconciles this page with the person as
  // search engines already know them. Only verified links are present; see
  // entityLinks.ts for why an unverified one is worse than none.
  const sameAs = sameAsFor(person.slug);
  if (sameAs.length > 0) {
    mainEntity.sameAs = sameAs;
  }
  if (person.role && person.role.trim()) {
    mainEntity.jobTitle = person.role.trim();
  }
  if (person.bio && isUsefulDescription(person.bio)) {
    mainEntity.description = person.bio.trim();
  }
  if (isValidHttpUrl(person.avatar_url)) {
    mainEntity.image = person.avatar_url;
  }

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "People", item: `${BASE_URL}/people` },
      { "@type": "ListItem", position: 3, name: person.name, item: personUrl },
    ],
  };

  return [mainEntity, breadcrumbs];
}

export function itemListJsonLd(
  list: BookList | null,
  books: Book[] | null
): Record<string, unknown>[] {
  if (!list || !books) return [];
  const listUrl = `${BASE_URL}/lists/${list.slug}`;

  const mainEntity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: list.title,
    description: list.description || undefined,
    url: listUrl,
    numberOfItems: books.length,
    itemListElement: books.map((book, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: bookListItem(book),
    })),
  };

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Reading Lists", item: `${BASE_URL}/lists` },
      { "@type": "ListItem", position: 3, name: list.title, item: listUrl },
    ],
  };

  return [mainEntity, breadcrumbs];
}

export function seriesJsonLd(
  series: Series | null,
  books: Book[] | null
): Record<string, unknown>[] {
  if (!series) return [];
  const seriesUrl = `${BASE_URL}/series/${series.slug}`;

  const mainEntity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: series.title,
    description: series.description || undefined,
    url: seriesUrl,
    numberOfItems: books?.length || 0,
    itemListElement: (books || []).map((book, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: bookListItem(book),
    })),
  };

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Book Series", item: `${BASE_URL}/series` },
      { "@type": "ListItem", position: 3, name: series.title, item: seriesUrl },
    ],
  };

  return [mainEntity, breadcrumbs];
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "BookMentions",
    url: BASE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/books?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    }
  };
}

export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "BookMentions",
    url: BASE_URL,
    logo: `${BASE_URL}/apple-touch-icon.png`
  };
}

export function collectionPageJsonLd({
  name,
  description,
  url,
  items,
}: {
  name: string;
  description: string;
  url: string;
  items?: { name: string; url: string }[];
}): Record<string, unknown> {
  const result: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: name,
    description: description,
    url: url,
  };
  if (items && items.length > 0) {
    result.mainEntity = {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map((item, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        url: item.url,
        name: item.name,
      })),
    };
  }
  return result;
}

export function breadcrumbListJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: `${BASE_URL}${item.path}`,
    })),
  };
}
