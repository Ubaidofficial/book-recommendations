"""
Hyphen/spacing-proof book matching for the coverage scripts.

Our catalogue stores some titles and author names with the hyphens dropped
("The EMyth Revisited", "Kareem AbdulJabbar", "Jon KabatZinn"), so comparing
token lists ("e myth" vs "emyth") reports a book we hold as missing. These
helpers compare the SQUASHED forms (letters and digits only) instead.
"""
from __future__ import annotations

import difflib

import find_primary_sources as fps


def title_key(title: str) -> str:
    """Main title, subtitle and leading article dropped, then squashed."""
    return fps.squash(fps.norm_title(title))


def author_matches(card_author: str | None, our_author: str | None) -> bool:
    """The card author's surname matches ours: squashed containment, or a near spelling of one of our name
    parts (Gilkey ~ Gillkey, Abdul-Jabbar ~ AbdulJabbar). No author to compare counts as a match."""
    sn = fps.surname(card_author)
    if sn is None:
        return True
    want = fps.squash(sn)
    ours = fps.squash(our_author or "")
    if want in ours:
        return True
    for part in fps.tokens(our_author or ""):
        if len(want) >= 5 and len(part) >= 5 and difflib.SequenceMatcher(None, want, fps.squash(part)).ratio() >= 0.86:
            return True
    return False
