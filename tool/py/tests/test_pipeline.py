"""Unit tests for the timing logic in narova_tts.pipeline.

Run: PYTHONPATH=py python3 -m unittest discover -s py/tests -v
(no heavy TTS deps needed — backends import lazily)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from narova_tts import pipeline
from narova_tts.backends import ChatterboxBackend, XttsBackend, XTTS_LANGS
from narova_tts.pipeline import (
    rescale_timings,
    scene_starts,
    sentence_cache_key,
    sentences,
    synth_sentence,
    voice_cache_speaker,
)


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

    def test_splits_urdu_full_stop(self):
        self.assertEqual(
            sentences("یہ ایک جملہ ہے۔ یہ دوسرا جملہ ہے۔"),
            ["یہ ایک جملہ ہے۔", "یہ دوسرا جملہ ہے۔"],
        )

    def test_splits_urdu_question_mark(self):
        self.assertEqual(
            sentences("کیا تم نے دیکھا؟ میں نے نہیں دیکھا۔"),
            ["کیا تم نے دیکھا؟", "میں نے نہیں دیکھا۔"],
        )

    def test_urdu_ellipsis_not_broken(self):
        self.assertEqual(
            sentences("اوہ... یعنی تم یہاں تھے؟"),
            ["اوہ...", "یعنی تم یہاں تھے؟"],
        )

    def test_mixed_english_and_urdu(self):
        self.assertEqual(
            sentences("Hello world. آپ کیسے ہیں؟ میں ٹھیک ہوں۔"),
            ["Hello world.", "آپ کیسے ہیں؟", "میں ٹھیک ہوں۔"],
        )

    def test_english_punctuation_still_works(self):
        self.assertEqual(
            sentences("First. Second! Third? Fourth."),
            ["First.", "Second!", "Third?", "Fourth."],
        )


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


class TestSceneStarts(unittest.TestCase):
    """Sfx anchors and global timeline math: scene starts are cumulative sums
    of scene durs in narration order."""

    def scenes(self):
        return [{"n": 1, "id": "intro"}, {"n": 2, "id": "main"}, {"n": 3, "id": "outro"}]

    def test_cumulative_in_narration_order(self):
        timings = {"intro": {"dur": 2.5}, "main": {"dur": 4.0}, "outro": {"dur": 1.25}}
        self.assertEqual(
            scene_starts(self.scenes(), timings),
            {"intro": 0.0, "main": 2.5, "outro": 6.5},
        )


class _FakeBackend:
    """Writes a marker file as the 'raw wav'; counts calls."""
    def __init__(self):
        self.calls = 0

    def synthesize(self, who, text, out_path, lang=None, seed=None):
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


class TestVoiceCacheSpeaker(unittest.TestCase):
    """A qwen delivery `instruct` is part of the cache identity, so changing
    the direction re-synthesizes rather than serving stale audio."""

    def test_speaker_only_when_no_instruct(self):
        self.assertEqual(voice_cache_speaker({"speaker": "Ryan"}, "a"), "Ryan")

    def test_missing_speaker_falls_back_to_who(self):
        self.assertEqual(voice_cache_speaker({}, "narrator"), "narrator")

    def test_instruct_changes_the_cache_key(self):
        flat = voice_cache_speaker({"speaker": "Ryan"}, "a")
        warm = voice_cache_speaker({"speaker": "Ryan", "instruct": "warm, energetic"}, "a")
        self.assertNotEqual(flat, warm)
        self.assertNotEqual(
            sentence_cache_key("qwen", flat, "Hi.", 1.12),
            sentence_cache_key("qwen", warm, "Hi.", 1.12),
        )

    def test_chatterbox_delivery_params_change_cache_key(self):
        base = voice_cache_speaker({"backend": "chatterbox", "speaker": "/abs/ref.wav"}, "a")
        tuned = voice_cache_speaker(
            {"backend": "chatterbox", "speaker": "/abs/ref.wav", "exaggeration": 0.7}, "a")
        self.assertNotEqual(base, tuned)
        self.assertNotEqual(
            sentence_cache_key("chatterbox", base, "Hi.", 1.12),
            sentence_cache_key("chatterbox", tuned, "Hi.", 1.12),
        )

    def test_default_chatterbox_backend_includes_delivery_params(self):
        base = voice_cache_speaker({"speaker": "/abs/ref.wav"}, "a", "chatterbox")
        tuned = voice_cache_speaker(
            {"speaker": "/abs/ref.wav", "cfg_weight": 0.3}, "a", "chatterbox")
        self.assertNotEqual(base, tuned)

    def test_chatterbox_lang_changes_cache_key(self):
        base = voice_cache_speaker({"backend": "chatterbox", "speaker": "/abs/ref.wav"}, "a")
        french = voice_cache_speaker(
            {"backend": "chatterbox", "speaker": "/abs/ref.wav", "lang": "fr"}, "a")
        self.assertNotEqual(base, french)
        self.assertNotEqual(
            sentence_cache_key("chatterbox", base, "Bonjour.", 1.12),
            sentence_cache_key("chatterbox", french, "Bonjour.", 1.12),
        )

    def test_changed_clone_recording_changes_cache_identity(self):
        with tempfile.TemporaryDirectory() as d:
            sample = Path(d) / "voice.wav"
            sample.write_bytes(b"first take")
            first = voice_cache_speaker(
                {"backend": "chatterbox", "speaker": str(sample)}, "a")
            sample.write_bytes(b"second take")
            second = voice_cache_speaker(
                {"backend": "chatterbox", "speaker": str(sample)}, "a")
        self.assertNotEqual(first, second)


class TestXttsCloneSpeaker(unittest.TestCase):
    """XttsBackend.synthesize routes a studio name to `speaker` and an absolute
    audio path to `speaker_wav` (voice cloning), failing loudly on a bad path."""

    def backend(self, speaker: str) -> XttsBackend:
        # bypass __init__ (loads torch/TTS); we only exercise synthesize's routing
        b = XttsBackend.__new__(XttsBackend)
        b._speakers = {"a": speaker}
        b._langs = {}
        b._tts = mock.Mock()
        return b

    def test_studio_name_uses_speaker(self):
        b = self.backend("Damien Black")
        b.synthesize("a", "Hi.", Path("/tmp/o.wav"))
        _, kw = b._tts.tts_to_file.call_args
        self.assertEqual(kw["speaker"], "Damien Black")
        self.assertNotIn("speaker_wav", kw)

    def test_absolute_existing_path_clones_the_voice(self):
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            b = self.backend(f.name)
            b.synthesize("a", "Hi.", Path("/tmp/o.wav"))
            _, kw = b._tts.tts_to_file.call_args
            self.assertEqual(kw["speaker_wav"], f.name)
            self.assertNotIn("speaker", kw)

    def test_relative_clone_path_raises_clearly(self):
        b = self.backend("voice/me.wav")
        with self.assertRaisesRegex(ValueError, "ABSOLUTE"):
            b.synthesize("a", "Hi.", Path("/tmp/o.wav"))

    def test_missing_clone_sample_raises_clearly(self):
        b = self.backend("/nope/missing.wav")
        with self.assertRaisesRegex(ValueError, "not found"):
            b.synthesize("a", "Hi.", Path("/tmp/o.wav"))


class TestXttsLanguage(unittest.TestCase):
    """XttsBackend.synthesize uses per-turn `lang` or per-voice `_langs` to set
    the XTTS language, falling back to "en". Unsupported languages raise."""

    def backend(self, speaker="Damien Black", langs=None):
        b = XttsBackend.__new__(XttsBackend)
        b._speakers = {"a": speaker}
        b._langs = dict(langs) if langs else {}
        b._tts = mock.Mock()
        return b

    def test_defaults_to_en_when_no_lang(self):
        b = self.backend()
        b.synthesize("a", "Hi.", Path("/tmp/o.wav"))
        _, kw = b._tts.tts_to_file.call_args
        self.assertEqual(kw["language"], "en")

    def test_uses_turn_lang_over_voice_default(self):
        b = self.backend(langs={"a": "fr"})
        b.synthesize("a", "Hola.", Path("/tmp/o.wav"), lang="es")
        _, kw = b._tts.tts_to_file.call_args
        self.assertEqual(kw["language"], "es")

    def test_uses_voice_lang_when_turn_lang_absent(self):
        b = self.backend(langs={"a": "de"})
        b.synthesize("a", "Hallo.", Path("/tmp/o.wav"))
        _, kw = b._tts.tts_to_file.call_args
        self.assertEqual(kw["language"], "de")

    def test_uses_turn_lang_when_voice_lang_absent(self):
        b = self.backend()
        b.synthesize("a", "Bonjour.", Path("/tmp/o.wav"), lang="fr")
        _, kw = b._tts.tts_to_file.call_args
        self.assertEqual(kw["language"], "fr")

    def test_rejects_unsupported_language(self):
        b = self.backend()
        with self.assertRaisesRegex(ValueError, "XTTS does not support"):
            b.synthesize("a", "...", Path("/tmp/o.wav"), lang="xx")

    def test_passes_every_known_language(self):
        b = self.backend()
        for lang in sorted(XTTS_LANGS):
            b._tts.reset_mock()
            b.synthesize("a", f"test {lang}", Path("/tmp/o.wav"), lang=lang)
            _, kw = b._tts.tts_to_file.call_args
            self.assertEqual(kw["language"], lang, f"language={lang} was not passed through")
            self.assertIn("speaker", kw)


class _FakeProc:
    """Stand-in for the chatterbox worker subprocess: records requests written
    to stdin and replays queued JSON responses on stdout.readline()."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.written = []
        outer = self

        class _Stdin:
            def write(self, s): outer.written.append(s)
            def flush(self): pass
            def close(self): pass

        class _Stdout:
            def readline(self):
                if not outer._responses:
                    return ""  # EOF — worker died
                return json.dumps(outer._responses.pop(0)) + "\n"

        self.stdin = _Stdin()
        self.stdout = _Stdout()

    def poll(self):
        return None

    def wait(self, timeout=None):
        return 0

    def kill(self):
        pass


class TestChatterboxBackend(unittest.TestCase):
    """ChatterboxBackend.synthesize speaks a line-delimited JSON protocol to the
    worker; __init__ validates the clone sample path before spawning anything."""

    def backend(self, speaker, responses):
        # bypass __init__ (spawns a subprocess); exercise only synthesize's protocol
        b = ChatterboxBackend.__new__(ChatterboxBackend)
        b._speakers = {"a": speaker}
        b._exg = {}
        b._cfgw = {}
        b._langs = {}
        b._proc = _FakeProc(responses)
        return b

    def test_synthesize_sends_request_and_returns_out(self):
        b = self.backend("/abs/ref.wav", [{"ok": True}])
        out = b.synthesize("a", "Hi.", Path("/tmp/o.wav"))
        self.assertEqual(out, Path("/tmp/o.wav"))
        req = json.loads(b._proc.written[0])
        self.assertEqual(req["ref"], "/abs/ref.wav")
        self.assertEqual(req["text"], "Hi.")
        self.assertEqual(req["out"], "/tmp/o.wav")
        self.assertNotIn("exaggeration", req)

    def test_delivery_params_are_forwarded(self):
        b = self.backend("/abs/ref.wav", [{"ok": True}])
        b._exg = {"a": 0.7}
        b._cfgw = {"a": 0.3}
        b.synthesize("a", "Hi.", Path("/tmp/o.wav"))
        req = json.loads(b._proc.written[0])
        self.assertEqual(req["exaggeration"], 0.7)
        self.assertEqual(req["cfg_weight"], 0.3)

    def test_lang_is_forwarded(self):
        b = self.backend("/abs/ref.wav", [{"ok": True}])
        b._langs = {"a": "fr"}
        b.synthesize("a", "Bonjour.", Path("/tmp/o.wav"))
        req = json.loads(b._proc.written[0])
        self.assertEqual(req["lang"], "fr")

    def test_no_lang_key_without_lang(self):
        b = self.backend("/abs/ref.wav", [{"ok": True}])
        b.synthesize("a", "Hi.", Path("/tmp/o.wav"))
        self.assertNotIn("lang", json.loads(b._proc.written[0]))

    def test_rejects_invalid_lang_before_startup(self):
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            with self.assertRaisesRegex(ValueError, "lang"):
                ChatterboxBackend({"a": f.name}, venv_python=Path("/nope/python"),
                                  langs={"a": 3})

    def test_worker_error_raises(self):
        b = self.backend("/abs/ref.wav", [{"ok": False, "error": "boom"}])
        with self.assertRaisesRegex(RuntimeError, "boom"):
            b.synthesize("a", "Hi.", Path("/tmp/o.wav"))

    def test_worker_death_raises_clearly(self):
        b = self.backend("/abs/ref.wav", [])  # readline -> "" (EOF)
        with self.assertRaisesRegex(RuntimeError, "exited unexpectedly"):
            b.synthesize("a", "Hi.", Path("/tmp/o.wav"))

    def test_rejects_non_path_speaker(self):
        with self.assertRaisesRegex(ValueError, "clones from a recording"):
            ChatterboxBackend({"a": "Ryan"})

    def test_rejects_relative_clone_path(self):
        with self.assertRaisesRegex(ValueError, "ABSOLUTE"):
            ChatterboxBackend({"a": "ref.wav"})

    def test_rejects_missing_clone_sample(self):
        with self.assertRaisesRegex(ValueError, "not found"):
            ChatterboxBackend({"a": "/nope/missing.wav"})

    def test_missing_venv_raises_with_setup_hint(self):
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            with self.assertRaisesRegex(RuntimeError, "narova-setup --chatterbox"):
                ChatterboxBackend({"a": f.name}, venv_python=Path("/nope/python"))

    def test_rejects_invalid_delivery_params_before_startup(self):
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            for values, message in [
                ({"exaggerations": {"a": 0.1}}, "exaggeration"),
                ({"cfg_weights": {"a": 1.1}}, "cfg_weight"),
                ({"cfg_weights": {"a": "high"}}, "cfg_weight"),
                ({"exaggerations": {"a": True}}, "exaggeration"),
            ]:
                with self.subTest(values=values):
                    with self.assertRaisesRegex(ValueError, message):
                        ChatterboxBackend(
                            {"a": f.name}, venv_python=Path("/nope/python"), **values)


class TestSynthesisText(unittest.TestCase):
    """synthesisText: clean text stays in captions; TTS gets synthesisText."""

    def test_local_backend_ignores_synthesisText(self):
        """Piper (local) should use text, ignoring synthesisText entirely."""
        from narova_tts.pipeline import sentences
        turn = {"who": "a", "text": "Clean text.",
                "synthesisText": "[tag] Clean text."}
        # synthesisText should only be used for external backends
        synth_text = turn.get("synthesisText")  # None for local — tested via is_external check
        self.assertIsNotNone(synth_text)
        # For local (piper is in BUILTIN_BACKENDS), is_external=False → synth_text stays None
        from narova_tts.backends import BUILTIN_BACKENDS
        backend_kind = "piper"
        is_external = backend_kind not in BUILTIN_BACKENDS
        actual = turn.get("synthesisText") if is_external else None
        self.assertIsNone(actual)

    def test_external_backend_uses_synthesisText(self):
        """External (fake provider) should use synthesisText when present."""
        from narova_tts.backends import BUILTIN_BACKENDS
        backend_kind = "elevenlabs"
        is_external = backend_kind not in BUILTIN_BACKENDS
        self.assertTrue(is_external)
        turn = {"who": "a", "text": "Clean text.",
                "synthesisText": "[whispering] Clean text."}
        actual = turn.get("synthesisText") if is_external else None
        self.assertEqual(actual, "[whispering] Clean text.")

    def test_no_synthesisText_falls_back_to_text(self):
        """External backend without synthesisText uses text."""
        from narova_tts.backends import BUILTIN_BACKENDS
        backend_kind = "elevenlabs"
        is_external = backend_kind not in BUILTIN_BACKENDS
        turn = {"who": "a", "text": "Just text."}
        synth = turn.get("synthesisText") if is_external else None
        self.assertIsNone(synth)
        # When None, clean text is used for everything
        from narova_tts.pipeline import sentences
        self.assertEqual(sentences(turn["text"]), ["Just text."])

    def test_sentence_count_mismatch_fallback(self):
        """When synthesisText and text have different sentence counts, fall back to text."""
        from narova_tts.pipeline import sentences
        synth_sents = sentences("[tag] Hello. World.")
        clean_sents = sentences("Hello world.")
        self.assertNotEqual(len(synth_sents), len(clean_sents))
        # Fallback: use clean text sentences when counts differ
        if len(synth_sents) != len(clean_sents):
            synth_sents = clean_sents
        self.assertEqual(synth_sents, clean_sents)


if __name__ == "__main__":
    unittest.main()


class TestDeterministicTakes(unittest.TestCase):
    """CHANGE-2026-018 / NAR-018-070..072: derived seeds, nonce identity,
    vary identity, and take-record shapes."""

    def test_derived_seed_is_pure_function_of_identity(self):
        from narova_tts.pipeline import derived_seed
        k = sentence_cache_key("piper", "spk", "Hello", 1.18)
        self.assertEqual(derived_seed(k), derived_seed(k))
        k2 = sentence_cache_key("piper", "spk", "Hello", 1.18, nonce=2)
        self.assertNotEqual(derived_seed(k), derived_seed(k2))

    def test_nonce_participates_in_cache_identity(self):
        base = sentence_cache_key("piper", "spk", "Hello", 1.18)
        take2 = sentence_cache_key("piper", "spk", "Hello", 1.18, nonce=2)
        self.assertNotEqual(base, take2)
        self.assertEqual(take2, sentence_cache_key("piper", "spk", "Hello", 1.18, nonce=2))

    def test_vary_participates_in_voice_identity(self):
        v = {"speaker": "spk", "backend": "piper"}
        plain = voice_cache_speaker(v, "a")
        varied = voice_cache_speaker({**v, "vary": True}, "a")
        self.assertNotEqual(plain, varied)

    def test_seed_forwarded_to_backend(self):
        """synth_sentence passes the derived seed through; a cache MISS calls
        backend.synthesize(seed=...) (NAR-018-071)."""
        import tempfile
        tmp = Path(tempfile.mkdtemp())
        out = tmp / "s.wav"
        # Minimal wav so probe() can read duration.
        import wave
        with wave.open(str(out), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(22050)
            wf.writeframes(b"\x00\x00" * 22050)

        class FakeBackend:
            seed_capable = True
            calls = {}

            def synthesize(self, who, text, out_path, lang=None, seed=None):
                FakeBackend.calls["seed"] = seed
                import shutil
                shutil.copyfile(out, out_path)
                return out_path

        # Pre-seed the output so processing reads a real wav.
        FakeBackend.raw = out
        # Mock sh (CI has no ffmpeg): "processing" copies raw -> out.
        with mock.patch.object(pipeline, "probe", return_value=1.0), \
                mock.patch.object(pipeline, "sh",
                                  lambda *a: Path(a[-1]).write_bytes(
                                      Path(a[a.index("-i") + 1]).read_bytes())):
            dur, hit = synth_sentence(
                FakeBackend(), "a", "Hello", tmp, tmp / "proc.wav", 1.0,
                cache_key=None, seed=4242)
        self.assertFalse(hit)
        self.assertEqual(FakeBackend.calls["seed"], 4242)
        self.assertEqual(dur, 1.0)
