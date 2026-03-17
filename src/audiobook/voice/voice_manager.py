"""Voice consistency manager – ensures the same character always gets the same
voice across the entire book."""

from typing import Callable, Dict, List, Optional, Set

from .character_normalizer import CharacterNormalizer
from .character_voice_memory import CharacterVoiceMemory
from .voice_classifier import classify_character_voice

_DEFAULT_VOICE = "neutral_voice"


class VoiceManager:
    """Ensures the same character always gets the same voice across the entire
    book.

    Maintains a persistent mapping of character → voice_id.  Assigns new
    voices when a character hasn't been seen before; reuses the existing
    voice otherwise.
    """

    def __init__(
        self,
        book_id: str = "default",
        base_dir: str = None,
        available_voices: List[str] = None,
        llm_fn: Callable = None,
    ) -> None:
        self._book_id = book_id
        self._base_dir = base_dir

        memory_kwargs: Dict = {"book_id": book_id}
        if base_dir is not None:
            memory_kwargs["base_dir"] = base_dir

        self._memory = CharacterVoiceMemory(**memory_kwargs)
        self._normalizer = CharacterNormalizer()
        self._llm_fn: Optional[Callable] = llm_fn
        self._available_voices: List[str] = list(available_voices or [])
        self._used_voices: Set[str] = set()

        # Populate _used_voices from any voices already persisted.
        for profile in self._memory.all_profiles().values():
            voice = profile.get("voice")
            if voice:
                self._used_voices.add(voice)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_voice(self, character_name: str, metadata: Dict = None) -> str:
        """Get or assign a voice for *character_name*.

        1. Normalise the name.
        2. Return persisted voice if one exists.
        3. Otherwise classify the character, pick a matching voice, persist
           it, and return it.
        """
        canonical = self._normalizer.normalize(character_name)

        existing = self._memory.get_voice(canonical)
        if existing is not None:
            return existing

        context = (metadata or {}).get("context", "")
        traits = classify_character_voice(
            canonical, context=context, llm_fn=self._llm_fn,
        )

        voice_id = self._select_voice(traits)
        self._memory.set_voice(canonical, voice_id)
        self._used_voices.add(voice_id)
        return voice_id

    def save(self) -> None:
        """Persist current mapping to disk."""
        self._memory.save()

    def load(self) -> None:
        """Reload mapping from disk by re-creating the memory store."""
        memory_kwargs: Dict = {"book_id": self._book_id}
        if self._base_dir is not None:
            memory_kwargs["base_dir"] = self._base_dir
        self._memory = CharacterVoiceMemory(**memory_kwargs)
        self._used_voices.clear()
        for profile in self._memory.all_profiles().values():
            voice = profile.get("voice")
            if voice:
                self._used_voices.add(voice)

    def get_all_assignments(self) -> Dict[str, str]:
        """Return all character → voice_id assignments."""
        return {
            name: profile.get("voice", _DEFAULT_VOICE)
            for name, profile in self._memory.all_profiles().items()
        }

    def override(self, character_name: str, voice_id: str) -> None:
        """Manually override a character's voice."""
        canonical = self._normalizer.normalize(character_name)
        self._memory.set_voice(canonical, voice_id)
        self._used_voices.add(voice_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _select_voice(self, traits: Dict) -> str:
        """Pick the best voice from *available_voices* based on *traits*.

        Strategy:
        1. Try to find an unused voice whose name contains the detected
           gender (e.g. ``"male"`` in ``"deep_male"``).
        2. Fall back to any voice whose name contains the gender.
        3. Fall back to hash-based deterministic selection from all voices.
        4. Ultimate fallback: ``"neutral_voice"``.
        """
        if not self._available_voices:
            return _DEFAULT_VOICE

        gender: str = traits.get("gender", "neutral")

        # 1. Unused voices matching gender
        gender_unused = [
            v for v in self._available_voices
            if gender in v and v not in self._used_voices
        ]
        if gender_unused:
            return gender_unused[0]

        # 2. Any voice matching gender (already used is OK)
        gender_any = [v for v in self._available_voices if gender in v]
        if gender_any:
            return gender_any[0]

        # 3. Any unused voice at all
        unused = [
            v for v in self._available_voices
            if v not in self._used_voices
        ]
        if unused:
            return unused[0]

        # 4. Deterministic hash-based fallback across full list
        idx = hash(traits.get("tone", "")) % len(self._available_voices)
        return self._available_voices[idx]
