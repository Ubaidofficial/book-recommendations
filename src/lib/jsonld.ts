import { Book, Person, BookList } from "@/lib/data";
import { isValidHttpUrl, isValidRating, isUsefulDescription } from "@/lib/dataQuality";

export function bookJsonLd(book: Book | null): Record<string, unknown> | null {
  if (!book) return null;
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
