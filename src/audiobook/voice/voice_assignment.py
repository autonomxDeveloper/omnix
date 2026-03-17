import hashlib
from typing import Dict, List, Optional

_DEFAULT_VOICE_MAP: Dict[str, str] = {
    "narrator": "deep_male",
    "queen": "royal_female",
    "king": "deep_male",
    "alice": "young_female",
    "rabbit": "fast_male",
    "witch": "old_female",
    "wizard": "old_male",
    "child": "young_female",
    "boy": "young_male",
    "girl": "young_female",
}


class VoiceAssignment:
    """Maps characters to TTS voice identifiers."""

    def __init__(self, available_voices: Optional[List[str]] = None) -> None:
        self._available = available_voices or []
        self._cache: Dict[str, str] = {}

    def assign(self, characters: List[str]) -> Dict[str, str]:
        """Return a mapping of character name → voice identifier."""
        voices: Dict[str, str] = {}
        for char in characters:
            voices[char] = self._resolve(char)
        return voices

    def get_voice(self, character: str) -> str:
        """Get (or derive) a voice for a single character."""
        if character not in self._cache:
            self._cache[character] = self._resolve(character)
        return self._cache[character]

    def _resolve(self, character: str) -> str:
        lower = character.lower().strip()

        # Check exact keyword match
        for keyword, voice in _DEFAULT_VOICE_MAP.items():
            if keyword in lower:
                return voice

        # If real voices available, hash-select from the list
        if self._available:
            idx = int(hashlib.md5(lower.encode()).hexdigest(), 16) % len(self._available)
            return self._available[idx]

        return "neutral_voice"
