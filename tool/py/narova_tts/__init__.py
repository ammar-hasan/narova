"""narova_tts — the Python half of narova: TTS + timing only.

narration.json -> per-scene audio (wav/mp3) + timings.json (word/turn timestamps,
rescaled to real audio). Run as a module: `python -m narova_tts --narration ...`.
"""
from .pipeline import run, rescale_timings

__all__ = ["run", "rescale_timings"]
__version__ = "0.1.0"
