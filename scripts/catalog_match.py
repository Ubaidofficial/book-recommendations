"""
Hyphen/spacing-proof book matching for the coverage scripts.

Our catalogue stores some titles and author names with the hyphens dropped
("The EMyth Revisited", "Kareem AbdulJabbar", "Jon KabatZinn"), so comparing
token lists ("e myth" vs "emyth") reports a book we hold as missing. These
helpers compare the SQUASHED forms (letters and digits only) instead.
"""
from __future__ import annotations

import find_primary_sources as fps


def title_key(title: str) -> str:
    """Main title, subtitle and leading article dropped, then squashed."""
    return fps.squash(fps.norm_title(title))


def author_matches(card_author: str | None, our_author: str | None) -> bool:
    """The card author's surname, squashed, appears inside our squashed author string (or no author to compare)."""
    sn = fps.surname(card_author)
    if sn is None:
        return True
    return fps.squash(sn) in fps.squash(our_author or "")
