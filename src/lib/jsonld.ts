import { Book, Person, BookList } from "@/lib/data";

export function bookJsonLd(book: Book | null): Record<string, unknown> | null {
  if (!book) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
    author: { "@type": "Person", name: book.author },
    description: book.description,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: book.rating,
      reviewCount: book.recommendation_count,
    },
  };
}

export function personJsonLd(person: Person | null): Record<string, unknown> | null {
  if (!person) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    description: person.bio,
    image: person.avatar_url,
  };
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
