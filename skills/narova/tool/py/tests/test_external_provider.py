"""Protocol tests for generic external TTS workers (no network or API key)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from narova_tts.backends import ExternalProviderBackend, build_backends
from narova_tts.pipeline import sentence_cache_key, voice_cache_speaker


FIXTURE = Path(__file__).parents[2] / "test" / "fixtures" / "fake-provider-worker.py"
PROTOCOL = "narova-tts-provider/v1"


def provider(name="fake", mode="ok"):
    return {
        "name": name,
        "displayName": name.title(),
        "protocol": PROTOCOL,
        "providerVersion": "1.2.3",
        "command": [sys.executable, str(FIXTURE), mode, name],
        "requiredEnvironment": [],
        "capabilities": {
            "synthesis": True,
            "voiceListing": True,
            "languages": True,
            "wordTimings": False,
        },
    }


class TestExternalProviderBackend(unittest.TestCase):
    def backend(self, mode="ok", name="fake", timeout=1.0):
        return ExternalProviderBackend(
            provider(name, mode),
            {"a": "voice-a", "b": "voice-b"},
            {"a": {}, "b": {}},
            startup_timeout=1.0,
            request_timeout=timeout,
        )

    def test_handshake_is_lazy_and_one_worker_serves_multiple_voices(self):
        backend = self.backend()
        self.assertIsNone(backend._worker)
        with tempfile.TemporaryDirectory() as d:
            first = Path(d) / "a.wav"
            second = Path(d) / "b.wav"
            backend.synthesize("a", "One.", first, lang="en")
            worker = backend._worker
            backend.synthesize("b", "Two.", second)
            self.assertIs(backend._worker, worker)
            self.assertTrue(first.is_file())
            self.assertTrue(second.is_file())
        backend.close()

    def test_provider_options_reach_worker_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            capture = Path(d) / "request.json"
            options = {"model": "test-model", "nested": {"b": 2, "a": 1}, "capture": str(capture)}
            backend = ExternalProviderBackend(
                provider(), {"a": "voice-a"}, {"a": options},
                startup_timeout=1, request_timeout=1,
            )
            backend.synthesize("a", "Hello.", Path(d) / "out.wav", lang="ur")
            request = json.loads(capture.read_text())
            self.assertEqual(request["options"], options)
            self.assertEqual(request["language"], "ur")
            backend.close()

    def test_handshake_failure_and_protocol_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            for mode, message in [
                ("handshake-failure", "unavailable"),
                ("wrong-protocol", "unsupported protocol"),
                ("malformed-hello", "invalid JSON"),
            ]:
                with self.subTest(mode=mode):
                    backend = self.backend(mode)
                    with self.assertRaisesRegex(RuntimeError, message):
                        backend.synthesize("a", "Hello.", Path(d) / f"{mode}.wav")
                    backend.close()

    def test_synthesis_failures_are_clear(self):
        with tempfile.TemporaryDirectory() as d:
            for mode, message in [
                ("missing-output", "did not create"),
                ("malformed", "invalid JSON"),
                ("structured-error", "synthetic failure"),
                ("crash", "exited"),
                ("timeout", "timed out"),
            ]:
                with self.subTest(mode=mode):
                    backend = self.backend(mode, timeout=0.15)
                    with self.assertRaisesRegex(RuntimeError, message):
                        backend.synthesize("a", "Hello.", Path(d) / f"{mode}.wav")
                    backend.close()

    def test_output_path_must_be_absolute(self):
        backend = self.backend()
        with self.assertRaisesRegex(ValueError, "absolute"):
            backend.synthesize("a", "Hello.", Path("relative.wav"))
        backend.close()

    def test_voice_listing_uses_generic_operation(self):
        voices = ExternalProviderBackend.list_voices(provider(), timeout=1)
        self.assertEqual(voices[0], {"id": "voice-a", "name": "Voice A"})

    def test_voice_listing_capability_error_is_clear(self):
        manifest = provider()
        manifest["capabilities"]["voiceListing"] = False
        with self.assertRaisesRegex(RuntimeError, "does not support voice listing"):
            ExternalProviderBackend.list_voices(manifest, timeout=1)

    def test_required_environment_is_checked_without_exposing_values(self):
        manifest = provider()
        manifest["requiredEnvironment"] = ["SOME_FAKE_PROVIDER_SECRET"]
        old = os.environ.pop("SOME_FAKE_PROVIDER_SECRET", None)
        try:
            backend = ExternalProviderBackend(manifest, {"a": "voice-a"}, {"a": {}})
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaisesRegex(RuntimeError, "SOME_FAKE_PROVIDER_SECRET"):
                    backend.synthesize("a", "Hello.", Path(d) / "out.wav")
        finally:
            if old is not None:
                os.environ["SOME_FAKE_PROVIDER_SECRET"] = old


class TestExternalProviderResolutionAndCache(unittest.TestCase):
    def test_build_backends_supports_multiple_registered_providers(self):
        manifests = {"alpha": provider("alpha"), "beta": provider("beta")}
        voices = {
            "a": {"backend": "alpha", "speaker": "one", "providerOptions": {}},
            "b": {"backend": "beta", "speaker": "two", "providerOptions": {}},
        }
        router = build_backends(voices, "piper", provider_loader=manifests.get)
        self.assertIsInstance(router["a"], ExternalProviderBackend)
        self.assertIsInstance(router["b"], ExternalProviderBackend)
        self.assertIsNot(router["a"], router["b"])
        router["a"].close()
        router["b"].close()

    def test_unknown_provider_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "not registered"):
            build_backends(
                {"a": {"backend": "ghost", "speaker": "voice"}},
                "piper",
                provider_loader=lambda _name: None,
            )

    def test_provider_identity_and_options_invalidate_cache_deterministically(self):
        base = {
            "backend": "fake",
            "speaker": "voice-a",
            "providerProtocol": PROTOCOL,
            "providerVersion": "1.2.3",
            "providerOptions": {"stability": 0.4, "nested": {"b": 2, "a": 1}},
        }
        reordered = {
            **base,
            "providerOptions": {"nested": {"a": 1, "b": 2}, "stability": 0.4},
        }
        changed = {**base, "providerOptions": {"stability": 0.5}}
        first = voice_cache_speaker(base, "a", "fake")
        self.assertEqual(first, voice_cache_speaker(reordered, "a", "fake"))
        self.assertNotEqual(first, voice_cache_speaker(changed, "a", "fake"))
        self.assertNotEqual(
            sentence_cache_key("fake", first, "Hello.", 1.0),
            sentence_cache_key("fake", voice_cache_speaker(changed, "a", "fake"), "Hello.", 1.0),
        )

    def test_secret_values_never_enter_cache_identity(self):
        voice = {
            "backend": "fake",
            "speaker": "voice-a",
            "providerProtocol": PROTOCOL,
            "providerVersion": "1.2.3",
            "providerOptions": {"style": "warm"},
        }
        secret = "super-secret-api-key"
        old = os.environ.get("FAKE_API_KEY")
        os.environ["FAKE_API_KEY"] = secret
        try:
            identity = voice_cache_speaker(voice, "a", "fake")
            key = sentence_cache_key("fake", identity, "Hello.", 1.0)
            self.assertNotIn(secret, identity)
            self.assertNotIn(secret, key)
        finally:
            if old is None:
                del os.environ["FAKE_API_KEY"]
            else:
                os.environ["FAKE_API_KEY"] = old


if __name__ == "__main__":
    unittest.main()
