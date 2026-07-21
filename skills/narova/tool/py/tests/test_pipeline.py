"""Unit tests for the timing logic in narova_tts.pipeline.

Run: PYTHONPATH=py python3 -m unittest discover -s py/tests -v
(no heavy TTS deps needed — backends import lazily)."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from narova_tts import pipeline
from narova_tts.pipeline import rescale_timings, sentence_cache_key, sentences, synth_sentence


class TestRescaleTimings(unittest.TestCase):
    def scene(self):
        return {
            "dur": 10.0,
            "turns": [0.16, 5.0],
            "words": [
                {"w": "Hi", "t0": 0.16, "t1": 1.0, "who": "a", "si": 0},
                {"w": "there.", "t0": 1.0, "t1": 2.0, "who": "a", "si": 0},
            ],
        }

    def test_scales_words_turns_and_dur_linearly(self):
        # loudnorm compressed 10.0s -> 9.7s: everything scales by 0.97
        t = rescale_timings(self.scene(), 9.7)
        self.assertEqual(t["dur"], 9.7)
        self.assertEqual(t["turns"], [round(0.16 * 0.97, 3), round(5.0 * 0.97, 3)])
        self.assertEqual(t["words"][0]["t0"], round(0.16 * 0.97, 3))
        self.assertEqual(t["words"][1]["t1"], round(2.0 * 0.97, 3))

    def test_word_order_survives(self):
        t = rescale_timings(self.scene(), 9.7)
        self.assertLess(t["words"][0]["t1"], t["words"][1]["t1"])

    def test_zero_durations_are_left_alone(self):
        s = self.scene()
        s["dur"] = 0
        t = rescale_timings(s, 9.7)
        self.assertEqual(t["turns"], [0.16, 5.0])  # untouched
        s2 = self.scene()
        t2 = rescale_timings(s2, 0)
        self.assertEqual(t2["dur"], 10.0)          # untouched

    def test_identity_when_actual_equals_computed(self):
        t = rescale_timings(self.scene(), 10.0)
        self.assertEqual(t["turns"], [0.16, 5.0])
        self.assertEqual(t["words"][0]["t0"], 0.16)


class TestSentences(unittest.TestCase):
    def test_splits_on_terminal_punctuation(self):
        self.assertEqual(
            sentences("One. Two! Three? Four."),
            ["One.", "Two!", "Three?", "Four."],
        )

    def test_keeps_inner_punctuation(self):
        self.assertEqual(
            sentences("Version three, to four point four. And more."),
            ["Version three, to four point four.", "And more."],
        )

    def test_strips_and_drops_empty(self):
        self.assertEqual(sentences("  Hello.  "), ["Hello."])
        self.assertEqual(sentences(""), [])


class TestSentenceCacheKey(unittest.TestCase):
    def test_stable_for_same_inputs(self):
        a = sentence_cache_key("piper", "en_US-ryan-high", "Hello world.", 1.12)
        b = sentence_cache_key("piper", "en_US-ryan-high", "Hello world.", 1.12)
        self.assertEqual(a, b)

    def test_changes_with_any_input(self):
        base = sentence_cache_key("piper", "en_US-ryan-high", "Hello world.", 1.12)
        self.assertNotEqual(base, sentence_cache_key("xtts", "en_US-ryan-high", "Hello world.", 1.12))
        self.assertNotEqual(base, sentence_cache_key("piper", "en_US-hfc_female-medium", "Hello world.", 1.12))
        self.assertNotEqual(base, sentence_cache_key("piper", "en_US-ryan-high", "Hello world!", 1.12))
        self.assertNotEqual(base, sentence_cache_key("piper", "en_US-ryan-high", "Hello world.", 1.2))


class _FakeBackend:
    """Writes a marker file as the 'raw wav'; counts calls."""
    def __init__(self):
        self.calls = 0

    def synthesize(self, who, text, out_path):
        self.calls += 1
        Path(out_path).write_bytes(b"raw audio")


class TestSynthSentenceCache(unittest.TestCase):
    """The cache is what guarantees iteration consistency: unchanged text is
    never re-synthesized, so unchanged audio comes out byte-identical."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._cache = mock.patch.object(pipeline, "CACHE_DIR", self.tmp / "cache")
        self._cache.start()
        # hermetic: no ffprobe, no ffmpeg — probe returns a fixed duration and
        # sh just turns the raw file into the processed one
        self._probe = mock.patch.object(pipeline, "probe", lambda p: 1.0)
        self._probe.start()
        self._sh = mock.patch.object(
            pipeline, "sh",
            lambda *args: Path(args[-1]).write_bytes(Path(args[args.index("-i") + 1]).read_bytes() + b"|processed"))
        self._sh.start()

    def tearDown(self):
        self._sh.stop()
        self._probe.stop()
        self._cache.stop()
        self._tmp.cleanup()

    def test_miss_synthesizes_and_populates_cache(self):
        be = _FakeBackend()
        out = self.tmp / "out.wav"
        key = sentence_cache_key("piper", "voice", "Hello.", 1.12)
        synth_sentence(be, "a", "Hello.", self.tmp, out, 1.12, cache_key=key)
        self.assertEqual(be.calls, 1)
        self.assertTrue((self.tmp / "cache" / f"{key}.wav").exists())

    def test_hit_skips_backend_and_copies_bytes(self):
        be = _FakeBackend()
        key = sentence_cache_key("piper", "voice", "Hello.", 1.12)
        synth_sentence(be, "a", "Hello.", self.tmp, self.tmp / "first.wav", 1.12, cache_key=key)
        second = self.tmp / "second.wav"
        synth_sentence(be, "a", "Hello.", self.tmp, second, 1.12, cache_key=key)
        self.assertEqual(be.calls, 1)  # second call came from the cache
        self.assertEqual(second.read_bytes(), (self.tmp / "first.wav").read_bytes())

    def test_no_key_never_caches(self):
        be = _FakeBackend()
        synth_sentence(be, "a", "Hello.", self.tmp, self.tmp / "out.wav", 1.12)
        self.assertEqual(be.calls, 1)
        self.assertFalse((self.tmp / "cache").exists())


if __name__ == "__main__":
    unittest.main()
