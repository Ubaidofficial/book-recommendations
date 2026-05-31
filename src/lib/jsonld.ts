import { Book, Person, BookList } from "@/lib/data";
import { isValidHttpUrl, isValidRating, isUsefulDescription } from "@/lib/dataQuality";

export function bookJsonLd(book: Book | null): Record<string, unknown> | null {
  if (!book || !book.title) return null;
  const result: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
  };
  if (book.author) {
    result.author = { "@type": "Person", name: book.author };
  }
  if (isUsefulDescription(book.description)) {
    result.description = book.description.trim();
  }
  if (isValidRating(book.rating)) {
    result.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: book.rating,
      reviewCount: book.recommendation_count,
    };
  }
  return result;
}

export function personJsonLd(person: Person | null): Record<string, unknown> | null {
  if (!person) return null;
  const result: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
  };
  if (person.bio && isUsefulDescription(person.bio)) {
    result.description = person.bio.trim();
  }
  if (isValidHttpUrl(person.avatar_url)) {
    result.image = person.avatar_url;
  }
  return result;
}

export function itemListJsonLd(
  list: BookList | null,
  books: Book[] | null
): Record<string, unknown> | null {
  if (!list || !books) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: list.title,
    description: list.description,
    numberOfItems: books.length,
    itemListElement: books.map((book, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Book",
        name: book.title,
        author: { "@type": "Person", name: book.author },
      },
    })),
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bookrecommendations.com";
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "BookRecs",
    "url": baseUrl,
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${baseUrl}/books?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    }
  };
}

export function organizationJsonLd(): Record<string, unknown> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bookrecommendations.com";
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "BookRecs",
    "url": baseUrl,
    "logo": `${baseUrl}/logo.png`
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
    "name": name,
    "description": description,
    "url": url,
  };
  if (items && items.length > 0) {
    result.mainEntity = {
      "@type": "ItemList",
      "numberOfItems": items.length,
      "itemListElement": items.map((item, idx) => ({
        "@type": "ListItem",
        "position": idx + 1,
        "url": item.url,
        "name": item.name,
      })),
    };
  }
  return result;
}

export function breadcrumbListJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://bookrecommendations.com";
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, idx) => ({
      "@type": "ListItem",
      "position": idx + 1,
      "name": item.name,
      "item": `${baseUrl}${item.path}`,
    })),
  };
}
