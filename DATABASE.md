# Database

## Supabase Tables

### `books`
Primary table for individual books.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| slug | text | URL-safe unique identifier |
| title | text | Book title |
| subtitle | text | Subtitle (nullable) |
| author | text | Author display name (denormalized) |
| author_slug | text | Links to `people.slug` |
| cover_url | text | Book cover image URL |
| description | text | Book description |
| rating | numeric | Average rating (1–5) |
| recommendation_count | integer | Number of unique recommenders (via book_recommendations) |
| series | text | Series display name (nullable, denormalized) |
| series_slug | text | Links to `series.slug` (nullable) |
| index_status | text | `index` or `noindex` |
| meta_title | text | Custom SEO title (nullable) |
| meta_description | text | Custom SEO description (nullable) |
| created_at | timestamptz | Record creation timestamp |

### `people`
Notable people (authors, recommenders).

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| slug | text | URL-safe unique identifier |
| name | text | Full name |
| role | text | Professional role |
| bio | text | Short biography |
| avatar_url | text | Avatar image URL |
| source_url | text | Link to source (nullable) |
| quality_score | numeric | Internal quality metric |
| index_status | text | `index` or `noindex` |
| meta_title | text | Custom SEO title (nullable) |
| meta_description | text | Custom SEO description (nullable) |
| published_at | timestamptz | Publication/notability date (nullable) |
| created_at | timestamptz | Record creation timestamp |
| updated_at | timestamptz | Last update timestamp |

Note: People do NOT have `recommended_books` or `books_written` columns. These counts are computed from junction tables at query time.

### `lists`
Curated book lists.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| slug | text | URL-safe unique identifier |
| title | text | List title |
| description | text | List description |
| book_count | integer | Number of books in the list |
| curator | text | Name of curator (nullable) |
| index_status | text | `index` or `noindex` |
| created_at | timestamptz | Record creation timestamp |

### `series`
Book series.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| slug | text | URL-safe unique identifier |
| title | text | Series title |
| description | text | Series description |
| book_count | integer | Number of books in the series |
| index_status | text | `index` or `noindex` |
| created_at | timestamptz | Record creation timestamp |

## Junction Tables

### `book_recommendations`
Maps books to people who recommend them.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| book_id | uuid | Foreign key → books.id |
| person_id | uuid | Foreign key → people.id |
| source_url | text | URL of recommendation source |
| source_name | text | Name of source |
| quote | text | Relevant quote from the source |
| recommended_at | timestamptz | When the recommendation was made |
| confidence_score | numeric | How confident the match is |

### `book_authors`
Maps books to their authors.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| book_id | uuid | Foreign key → books.id |
| person_id | uuid | Foreign key → people.id |

### `book_lists`
Maps books to lists with rank.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| book_id | uuid | Foreign key → books.id |
| list_id | uuid | Foreign key → lists.id |
| rank | integer | Position in the list (1-based) |

### `book_series`
Maps books to series with position.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| book_id | uuid | Foreign key → books.id |
| series_id | uuid | Foreign key → series.id |
| position | integer | Reading order position |

## Query Patterns

- **Books by author**: `book_authors` joined to `books` filtered by `person_id`
- **Books in series**: `book_series` joined to `books` filtered by `series_id`, ordered by `position`
- **Books in list**: `book_lists` joined to `books` filtered by `list_id`, ordered by `rank`
- **Person's recommendations**: `book_recommendations` joined to `books` filtered by `person_id`
- **Recommender count**: `SELECT count(*) FROM book_recommendations WHERE person_id = ?`
- **Written count**: `SELECT count(*) FROM book_authors WHERE person_id = ?`

## Import Pipeline Summary

1. Source data is collected as CSV files
2. Rows are validated and cleaned
3. `slug` values are generated from titles
4. `index_status` defaults to `noindex` — set to `index` manually after quality review
5. Junction tables are populated to establish all relationships
6. Count fields (`recommendation_count`, `book_count`) are updated via triggers after each batch import
