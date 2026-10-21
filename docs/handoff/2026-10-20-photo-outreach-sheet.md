# Photo permission outreach: top photo-less people

Rule: no photo goes on the site without a written yes and the credit line the person asks for.
"Verified" = I opened the page or saw it on the person's own site. "Unverified" = search result or memory only; check before sending.

## Email (copy, fill {first}, {slug}, {N}, {photo})

Subject: Photo for your BookMentions page

Hi {first},

BookMentions (bookmentions.net) lists the books people recommend, each linked to where they said it. You have a page at https://bookmentions.net/people/{slug} with {N} recommendations.

We would like to show a headshot on it. {photo}

Would you be happy for us to use it, and how would you like it credited? We will only display it with your OK and with the credit you choose, and will remove it on request.

Thank you,
{your name}, BookMentions

`{photo}` for people with a media page: "Your media page at {URL} offers a headshot; may we use {filename} on your profile?" For everyone else: "Could you reply with a headshot you are happy for us to use?"

## Sheet

| Person | Page slug | Recs | Where to look | Status |
|---|---|---|---|---|
| Mark Manson | mark-manson | 63 | https://markmanson.net/media-kit (6 headshots; page states no licence or photographer, so ask) | Verified page |
| David Heinemeier Hansson | david-heinemeier-hansson | 56 | https://dhh.dk (site says he welcomes email at dhh@hey.com) | Verified on his site |
| Frank Chimero | frank-chimero | 92 | https://frankchimero.com (no contact page found) | Site unverified |
| Nat Eliason | nat-eliason | 146 | nateliason.com (could not confirm) | Unverified |
| Patrick O'Shaughnessy | patrick-o-shaughnessy | 74 | joincolossus.com (podcast home); no press contact found | Unverified |
| Ankur Warikoo | ankur-warikoo | 66 | ankurwarikoo.com; check the site for a contact form. Do not use the Gmail address third-party pages list. | Unverified |
| Arianna Huffington | arianna-huffington | 65 | thriveglobal.com press page | Unverified |
| Daniel Pink | daniel-pink | 56 | danpink.com | Unverified; publisher photos are credited to a named photographer and are theirs |
| Noah Kagan | noah-kagan | 55 | his own site or AppSumo's | Unverified |
| Cleo Abram | cleo-abram | 60 | YouTube channel About page | Unverified |
| Sophie Bakalar | sophie-bakalar | 92 | her publisher's publicity contact | Unverified |
| Lena Dunham | lena-dunham | 71 | publisher or agency publicity | Unverified |
| Zoë Foster Blake | zo-foster-blake | 69 | publisher publicity | Unverified |
| David Cancel | david-cancel | 58 | his company site | Unverified |
| Brendon Burchard | brendon-burchard | 54 | brendon.com press | Unverified |
| Josh Waitzkin | josh-waitzkin | 54 | his site | Unverified |
| Matt Mullenweg | matt-mullenweg | 52 | ma.tt contact | Unverified |
| Alfred Lin | alfred-lin | 52 | Sequoia profile / press | Unverified |
| Ben Shapiro | ben-shapiro | 50 | Daily Wire press | Unverified |
| Sahil Lavingia | sahil-lavingia | 50 | his site | Unverified |
| Gretchen Rubin | gretchen-rubin | 48 | gretchenrubin.com press page | Unverified |
| Neil Gaiman | neil-gaiman | 47 | publisher publicity | Unverified |
| Janet Mock | janet-mock | 46 | publisher publicity | Unverified |
| Money Mustache | money-mustache | 46 | his site | Unverified |
| Balaji S. Srinivasan | balaji-s-srinivasan | 46+64 merged | his site | Unverified |

Skipped: Meghan Markle (no practical permission route), and non-person rows (Book Recommendations (43 Books), The Rational Walk, Alex and Books).

## When a yes arrives

Record the person, the photo URL, the credit line they asked for, and a link to or screenshot of the reply. Store the credit in `avatar_attribution`, `avatar_license` as "Used with permission", and `avatar_source_url` as the page it came from.
