"""Unit tests for the timing logic in narova_tts.pipeline.

Run: PYTHONPATH=py python3 -m unittest discover -s py/tests -v
(no heavy TTS deps needed — backends import lazily)."""
import unittest

from narova_tts.pipeline import rescale_timings, sentences


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


if __name__ == "__main__":
    unittest.main()
