from typing import List, Optional


class SpeakerTracker:
    """Maintains conversational speaker state to resolve attribution gaps."""

    def __init__(self) -> None:
        self.last_speaker: Optional[str] = None
        self.previous_speaker: Optional[str] = None
        self.character_list: List[str] = []
        self._turn_index: int = 0

    def update(self, speaker: str) -> None:
        if speaker and speaker != "Narrator":
            self.previous_speaker = self.last_speaker
            self.last_speaker = speaker
            if speaker not in self.character_list:
                self.character_list.append(speaker)
        self._turn_index += 1

    def resolve(self, speaker: Optional[str]) -> str:
        """Return the resolved speaker, falling back to alternation or Narrator."""
        if speaker:
            self.update(speaker)
            return speaker

        # Alternate between the two most recent non-Narrator speakers
        non_narrator = [c for c in self.character_list if c != "Narrator"]
        if len(non_narrator) >= 2:
            resolved = non_narrator[self._turn_index % 2]
            self._turn_index += 1
            return resolved

        if self.last_speaker and self.last_speaker != "Narrator":
            return self.last_speaker

        return "Narrator"
