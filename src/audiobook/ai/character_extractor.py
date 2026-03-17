import re
from typing import List, Dict


class CharacterExtractor:
    """Extracts character names from a structured script."""

    def extract(self, segments: List[Dict]) -> List[Dict]:
        """Return a deduplicated list of character dicts from script segments.

        Each dict has:  {"id": str, "name": str}
        """
        seen: set = set()
        characters: List[Dict] = []

        for seg in segments:
            speaker = seg.get("speaker", "")
            if not speaker:
                continue
            key = speaker.lower().strip()
            if key not in seen:
                seen.add(key)
                characters.append({
                    "id": re.sub(r'\W+', '_', key),
                    "name": speaker.strip(),
                })

        return characters
