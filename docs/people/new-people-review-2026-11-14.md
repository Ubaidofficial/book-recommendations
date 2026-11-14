# New people review — 2026-11-14

**No people were created.** This is the list to review first.

## Result
The two outside indexes list **209** people we could not match to a record of ours. After a strict duplicate check
(accents, hyphens, apostrophes, middle names, near spellings):

- **5 are people you already have** (the names differ only in punctuation or spelling), so they must not be added again.
- **193 look genuinely new** (11 appear in both indexes).

Examples of the duplicates, with the record of yours they match: David A. Sinclair = David Sinclair (`david-sinclair`); Katrín Davíðsdóttir = Katr�n Dav��sd�ttir (`katr-n-dav-sd-ttir`); Nassim Taleb = Nassim Nicholas Taleb (`nassim-nicholas-taleb`); Paul Tudor Jones = Tudor Jones (`tudor-jones`); Ryan Petersen = Ryan Peterson (`ryan-peterson`).

## Why nothing was created yet
1. A person page needs more than a name. Your thin-page rule (`isPersonPageThin`) keeps a profile with too little content out of search, so each new person needs a role, a short factual bio and a licensed portrait. Your scripts `backfill_people_meta.js` and `fill_avatar_attribution.py` do that; I did not copy any outside bios.
2. A person is only worth adding with verified recommendations behind them. The verification runs are still in progress for the people you already have; the same checks apply to these.
3. Several duplicates of the same person already exist in your own table (for example two O'Shaughnessy records), so adding more would make that worse. A merge review is worth doing first.

## Proposed rule for creating a person
Create as a **draft** only when at least **3** of their recommendations pass the same verification used for existing people (source belongs to them and names the book, or holds their own words), then attach those recommendations and run the profile enrichment before publishing.

## Genuinely new candidates, by number of books listed
| Person | Listed by | Books listed |
|---|---|---:|
| Brandon Sanderson | mostrecommendedbooks | 53 |
| Branko Milanovic | readthistwice | 46 |
| Trung Phan | mostrecommendedbooks + readthistwice | 41 |
| Carlos Slim | mostrecommendedbooks | 40 |
| Michael Hyatt | mostrecommendedbooks | 37 |
| Zack D'Aleo | mostrecommendedbooks | 33 |
| Vern Gambetta | readthistwice | 32 |
| Ella Dawson | readthistwice | 28 |
| Brad Delong | mostrecommendedbooks | 28 |
| Claudia Oltean | readthistwice | 27 |
| Saagar Enjeti | mostrecommendedbooks + readthistwice | 25 |
| Danny Miranda | mostrecommendedbooks | 25 |
| Fred Wilson | mostrecommendedbooks | 25 |
| Shannon Miller | readthistwice | 24 |
| Linda Liukas | readthistwice | 23 |
| Elin Hilderbrand | readthistwice | 22 |
| Scott Berkun | readthistwice | 22 |
| William Dalrymple | readthistwice | 21 |
| Kate McKean | readthistwice | 20 |
| Debra Akins | mostrecommendedbooks | 19 |
| Kevin Systrom | mostrecommendedbooks + readthistwice | 17 |
| Mary Myatt | readthistwice | 17 |
| Peter Frankopan | readthistwice | 17 |
| Rand Paul | mostrecommendedbooks | 16 |
| Jack Canfield | mostrecommendedbooks + readthistwice | 15 |
| Karen Rivers | readthistwice | 15 |
| Dylan Wiliam | readthistwice | 14 |
| Megan Abbott | readthistwice | 14 |
| Jay Bilas | readthistwice | 13 |
| John Carmack | mostrecommendedbooks | 13 |
| Brian Dean | mostrecommendedbooks | 12 |
| Cameron Winklevoss | mostrecommendedbooks | 12 |
| Sam Hinkie | mostrecommendedbooks | 12 |
| Chris Packham | readthistwice | 11 |
| G. Elliott Morris | readthistwice | 11 |
| Piers Morgan | readthistwice | 11 |
| Alistair Begg | mostrecommendedbooks + readthistwice | 10 |
| Matthew Yglesias | mostrecommendedbooks + readthistwice | 10 |
| Barry Silbert | mostrecommendedbooks | 10 |
| Blake Randall | mostrecommendedbooks | 10 |
| John Collison | mostrecommendedbooks | 10 |
| Steph Pilavin | mostrecommendedbooks | 10 |
| Greg Iles | readthistwice | 9 |
| Noah Smith | mostrecommendedbooks + readthistwice | 9 |
| Mike Novogratz | mostrecommendedbooks | 9 |
| Nicola Yoon | readthistwice | 8 |
| Rita Gunther McGrath | readthistwice | 8 |
| Sarah Churchwell | readthistwice | 8 |
| Aaliyah Readss | mostrecommendedbooks | 8 |
| Brad Thor | mostrecommendedbooks + readthistwice | 7 |
| Brandon Stosuy | readthistwice | 7 |
| Ellen Coyne | readthistwice | 7 |
| Kent C. Dodds | readthistwice | 7 |
| Matt Goodwin | readthistwice | 7 |
| Sreenath Sreenivasan | readthistwice | 7 |
| Daniel Gross | mostrecommendedbooks | 7 |
| Kishore Biyani | mostrecommendedbooks | 7 |
| Alemsah Ozturk | readthistwice | 6 |
| Ben Lorica | readthistwice | 6 |
| Elizabeth Nolan Brown | readthistwice | 6 |

(Top 60 of 193; full list in `reports/new_people_review.csv`, which is not committed.)

## Possible duplicates inside your own people table
These matched a person of yours exactly by folded name but the table holds the same name more than once, which is why the earlier run skipped them:
- David A. Sinclair ↔ `david-sinclair`
- Katrín Davíðsdóttir ↔ `katr-n-dav-sd-ttir`
- Nassim Taleb ↔ `nassim-nicholas-taleb`
- Paul Tudor Jones ↔ `tudor-jones`
- Ryan Petersen ↔ `ryan-peterson`
