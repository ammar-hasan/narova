"""Tests for forced word alignment (narova_tts.align).

Engines are mocked — no whisper models, no audio needed. The scene wav only
needs to exist because the alignment cache keys on its bytes."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from narova_tts import align
from narova_tts.align import align_scenes, apply_alignment


def words(*toks):
    return [{"w": t, "t0": 0.0, "t1": 0.5, "who": "a", "si": 0} for t in toks]


class TestApplyAlignment(unittest.TestCase):
    def test_matching_words_take_measured_times(self):
        exp = words("Hello,", "world.")
        why = apply_alignment(
            [{"w": "hello", "t0": 0.1, "t1": 0.4}, {"w": "world", "t0": 0.5, "t1": 0.9}], exp)
        self.assertIsNone(why)
        self.assertEqual((exp[0]["t0"], exp[0]["t1"]), (0.1, 0.4))
        self.assertEqual((exp[1]["t0"], exp[1]["t1"]), (0.5, 0.9))

    def test_count_mismatch_keeps_estimates(self):
        exp = words("one", "two")
        why = apply_alignment([{"w": "one", "t0": 0, "t1": 1}], exp)
        self.assertIn("word count", why)
        self.assertEqual((exp[0]["t0"], exp[0]["t1"]), (0.0, 0.5))

    def test_word_mismatch_keeps_estimates(self):
        exp = words("one", "two")
        why = apply_alignment(
            [{"w": "one", "t0": 0, "t1": 1}, {"w": "uno", "t0": 1, "t1": 2}], exp)
        self.assertIn("word 1 differs", why)
        self.assertEqual((exp[1]["t0"], exp[1]["t1"]), (0.0, 0.5))

    def test_t1_never_before_t0(self):
        exp = words("one")
        self.assertIsNone(apply_alignment([{"w": "one", "t0": 1.0, "t1": 0.5}], exp))
        self.assertEqual(exp[0]["t1"], 1.0)


class TestAlignScenes(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.audio = self.tmp / "audio"
        self.audio.mkdir()
        (self.audio / "01.wav").write_bytes(b"scene one audio")
        self._cache = mock.patch.object(align, "CACHE_DIR", self.tmp / "cache")
        self._cache.start()
        self.scenes = [{"n": 1, "id": "intro"}]
        self.timings = {"intro": {"dur": 1.0, "turns": [0.16],
                                  "words": words("Hello,", "world.")}}

    def tearDown(self):
        self._cache.stop()
        self._tmp.cleanup()

    def engine(self, measured, calls):
        def fn(wav):
            calls.append(wav)
            return measured
        return fn

    def test_measured_words_replace_estimates(self):
        calls = []
        cands = [("fake", self.engine(
            [{"w": "hello", "t0": 0.2, "t1": 0.6}, {"w": "world", "t0": 0.7, "t1": 1.0}], calls))]
        with mock.patch.object(align, "_candidates", return_value=cands):
            align_scenes(self.scenes, self.timings, self.audio)
        w = self.timings["intro"]["words"]
        self.assertEqual((w[0]["t0"], w[0]["t1"]), (0.2, 0.6))
        self.assertEqual(self.timings["intro"]["turns"], [0.16])  # untouched
        self.assertEqual(self.timings["intro"]["dur"], 1.0)       # untouched

    def test_second_run_comes_from_cache(self):
        calls = []
        measured = [{"w": "hello", "t0": 0.2, "t1": 0.6}, {"w": "world", "t0": 0.7, "t1": 1.0}]
        cands = [("fake", self.engine(measured, calls))]
        with mock.patch.object(align, "_candidates", return_value=cands):
            align_scenes(self.scenes, self.timings, self.audio)
            align_scenes(self.scenes, self.timings, self.audio)
        self.assertEqual(len(calls), 1)  # second run hit the cache

    def test_mismatch_keeps_estimates_and_never_raises(self):
        calls = []
        cands = [("fake", self.engine([{"w": "totally", "t0": 0, "t1": 1}], calls))]
        with mock.patch.object(align, "_candidates", return_value=cands):
            align_scenes(self.scenes, self.timings, self.audio)  # must not raise
        w = self.timings["intro"]["words"]
        self.assertEqual((w[0]["t0"], w[0]["t1"]), (0.0, 0.5))

    def test_engine_failure_falls_through_to_next_engine(self):
        calls = []

        def boom(wav):
            calls.append(wav)
            raise RuntimeError("model exploded")

        good = self.engine(
            [{"w": "hello", "t0": 0.2, "t1": 0.6}, {"w": "world", "t0": 0.7, "t1": 1.0}], calls)
        cands = [("bad", boom), ("fake", good)]
        with mock.patch.object(align, "_candidates", return_value=cands):
            align_scenes(self.scenes, self.timings, self.audio)
        w = self.timings["intro"]["words"]
        self.assertEqual((w[0]["t0"], w[0]["t1"]), (0.2, 0.6))

    def test_all_engines_failing_keeps_estimates(self):
        def boom(wav):
            raise RuntimeError("nope")
        with mock.patch.object(align, "_candidates", return_value=[("bad", boom)]):
            align_scenes(self.scenes, self.timings, self.audio)  # must not raise
        w = self.timings["intro"]["words"]
        self.assertEqual((w[0]["t0"], w[0]["t1"]), (0.0, 0.5))

    def test_no_engine_available_is_a_noop(self):
        with mock.patch.object(align, "_candidates", return_value=[]):
            align_scenes(self.scenes, self.timings, self.audio)  # warns, no raise
        w = self.timings["intro"]["words"]
        self.assertEqual((w[0]["t0"], w[0]["t1"]), (0.0, 0.5))


if __name__ == "__main__":
    unittest.main()


class TestProjectAlignmentOptions(unittest.TestCase):
    def test_hyphen_components_keep_one_authored_word(self):
        expected = words("a", "one-to-one", "connection")
        measured = [{"w": tok, "t0": i * .2, "t1": (i+1) * .2} for i, tok in enumerate(["a", "one", "to", "one", "connection"])]
        self.assertIsNone(apply_alignment(measured, expected, partial=False))
        self.assertEqual(len(expected), 3)
        self.assertEqual(expected[1]["w"], "one-to-one")
        self.assertEqual((expected[1]["t0"], expected[1]["t1"]), (.2, .8))
        mismatch = words("one", "two")
        self.assertIn("word", apply_alignment([{"w": "onetwo", "t0": 0, "t1": 1}], mismatch, partial=False))

    def test_explicit_partial_overrides_environment_in_both_directions(self):
        measured = [{"w": "1", "t0": .1, "t1": .3}, {"w": "world", "t0": .4, "t1": .8}]
        with mock.patch.dict("os.environ", {"NAROVA_ALIGN_PARTIAL": "1"}):
            strict = words("One", "world")
            self.assertIn("differs", apply_alignment(measured, strict, partial=False))
            self.assertEqual(strict[1]["t0"], 0)
        with mock.patch.dict("os.environ", {"NAROVA_ALIGN_PARTIAL": "0"}):
            partial = words("One", "world")
            self.assertTrue(apply_alignment(measured, partial, partial=True).startswith("partial "))
            self.assertEqual(partial[1]["t0"], .4)

    def test_project_model_overrides_env_without_mutating_it(self):
        import sys, types, os
        calls = []
        class Model:
            def __init__(self, name, **kwargs): calls.append(name)
            def transcribe(self, *args, **kwargs): return [], None
        with mock.patch.dict(sys.modules, {"faster_whisper": types.SimpleNamespace(WhisperModel=Model)}), mock.patch.dict(os.environ, {"NAROVA_WHISPER_MODEL": "tiny.en"}), mock.patch.object(align, "_FW_MODEL", None):
            align._faster_whisper_words(Path("fake.wav"), "base.en")
            align._faster_whisper_words(Path("fake.wav"))
            self.assertEqual(calls, ["base.en", "tiny.en"])
            self.assertEqual(os.environ["NAROVA_WHISPER_MODEL"], "tiny.en")

    def test_alignment_cache_separates_models_and_reuses_raw_words(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(align, "CACHE_DIR", Path(d)/"cache"):
            wav = Path(d)/"scene.wav"; wav.write_bytes(b"same audio")
            calls = []
            def fn(wav):
                calls.append(wav)
                return [{"w": "one", "t0": .1, "t1": .4}]
            align._cached_words(wav, "faster-whisper", fn, "tiny.en")
            align._cached_words(wav, "faster-whisper", fn, "base.en")
            align._cached_words(wav, "faster-whisper", fn, "base.en")
            self.assertEqual(len(calls), 2)


class TestLocalAlignmentModelIdentity(unittest.TestCase):
    def test_changed_model_bytes_in_store_invalidate_raw_words(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict("os.environ", {"NAROVA_HOME": d}), mock.patch.object(align, "CACHE_DIR", Path(d)/"cache"):
            wav = Path(d)/"scene.wav"; wav.write_bytes(b"same audio")
            model = Path(d)/"models"/"local.bin"; model.parent.mkdir(); model.write_bytes(b"model v1")
            calls = []
            def fn(wav):
                calls.append(wav)
                return [{"w": "one", "t0": .1, "t1": .4}]
            align._cached_words(wav, "whisper-cpp", fn, "local.bin")
            align._cached_words(wav, "whisper-cpp", fn, "local.bin")
            self.assertEqual(len(calls), 1)
            model.write_bytes(b"model v2")
            align._cached_words(wav, "whisper-cpp", fn, "local.bin")
            self.assertEqual(len(calls), 2)
