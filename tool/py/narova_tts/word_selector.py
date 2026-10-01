"""Literal selectors; no fuzzy or semantic transcript matching."""
import unicodedata

def normalize(text):
    text = str(text).strip().lower()
    while text and unicodedata.category(text[0])[0] in "PS": text = text[1:]
    while text and unicodedata.category(text[-1])[0] in "PS": text = text[:-1]
    return text

def select_word_index(tokens, selector, at="word cue"):
    if isinstance(selector, int) and not isinstance(selector, bool) and selector >= 0:
        return selector
    if not isinstance(selector, dict) or not isinstance(selector.get("text"), str) or not normalize(selector["text"]):
        raise ValueError(f"{at}: invalid word selector")
    occurrence = selector.get("occurrence")
    if occurrence is not None and (not isinstance(occurrence, int) or isinstance(occurrence, bool) or occurrence < 0):
        raise ValueError(f"{at}: invalid word occurrence")
    matches = [i for i, token in enumerate(tokens) if normalize(token) == normalize(selector["text"])]
    if occurrence is None and len(matches) != 1:
        raise ValueError(f"{at}: literal word is missing or ambiguous; provide occurrence for repeated words")
    occurrence = occurrence or 0
    if occurrence >= len(matches): raise ValueError(f"{at}: word occurrence unavailable")
    return matches[occurrence]
