from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock


WORKER_PATH = Path(__file__).parents[1] / "tool" / "worker.py"
SPEC = importlib.util.spec_from_file_location("narova_elevenlabs_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(worker)


def write_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(22050)
        out.writeframes(b"\0\0" * 100)


class TestProtocol(unittest.TestCase):
    def test_handshake_needs_no_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.handle({
                "operation": "hello",
                "protocol": "narova-tts-provider/v1",
            }), {
                "ok": True,
                "protocol": "narova-tts-provider/v1",
                "provider": "elevenlabs",
                "providerVersion": "1.0.0",
            })

    def test_wrong_protocol_is_structured(self):
        with self.assertRaises(worker.ProviderError) as error:
            worker.handle({"operation": "hello", "protocol": "v2"})
        self.assertEqual(error.exception.code, "unsupported_protocol")

    def test_missing_key_is_not_accepted_in_project_request(self):
        with mock.patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as d:
            request = {
                "id": "r1",
                "operation": "synthesize",
                "text": "Hello.",
                "speaker": "voice-id",
                "language": "en",
                "output": str(Path(d) / "out.wav"),
                "options": {},
            }
            with self.assertRaises(worker.ProviderError) as error:
                worker.handle(request)
        self.assertEqual(error.exception.code, "missing_environment")
        self.assertNotIn("api_key", json.dumps(request).lower())


class TestSynthesis(unittest.TestCase):
    def test_options_map_to_documented_http_request_and_wav_output(self):
        seen = {}

        def download(path, key, payload, timeout):
            seen.update(path=path, key=key, payload=payload, timeout=timeout)
            return b"encoded audio", {"requestId": "req", "characterCost": "6"}

        def convert(_source, output, timeout=60):
            write_wav(output)

        with tempfile.TemporaryDirectory() as d, \
                mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", download), \
                mock.patch.object(worker, "convert_to_wav", convert):
            output = Path(d) / "out.wav"
            response = worker.handle({
                "id": "r1",
                "operation": "synthesize",
                "text": "Hello.",
                "speaker": "voice/id",
                "language": "ur",
                "output": str(output),
                "options": {
                    "model": "test-model",
                    "stability": 0.45,
                    "similarityBoost": 0.8,
                    "useSpeakerBoost": True,
                    "requestTimeoutSeconds": 12,
                },
            })
            self.assertTrue(output.is_file())
        self.assertEqual(response, {"id": "r1", "ok": True, "output": str(output)})
        self.assertEqual(seen["key"], "test-secret")
        self.assertNotIn("test-secret", json.dumps(response))
        self.assertIn("/v1/text-to-speech/voice%2Fid?", seen["path"])
        self.assertEqual(seen["payload"]["model_id"], "test-model")
        self.assertEqual(seen["payload"]["language_code"], "ur")
        self.assertEqual(seen["payload"]["voice_settings"], {
            "stability": 0.45,
            "similarity_boost": 0.8,
            "use_speaker_boost": True,
        })
        self.assertEqual(seen["timeout"], 12.0)

    def test_unknown_options_and_unsafe_output_are_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as d:
            base = {
                "text": "Hello.", "speaker": "voice", "language": None,
                "output": str(Path(d) / "out.wav"), "options": {"mystery": 1},
            }
            with self.assertRaises(worker.ProviderError) as error:
                worker.build_request(base)
            self.assertEqual(error.exception.code, "invalid_options")
            with self.assertRaises(worker.ProviderError) as error:
                worker.validate_output("relative.wav")
            self.assertEqual(error.exception.code, "invalid_output")

    def test_no_retry_on_network_or_service_failure(self):
        call_count = 0

        def fail(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            raise worker.ProviderError("network_error", "safe failure")

        with tempfile.TemporaryDirectory() as d, \
                mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", fail):
            with self.assertRaises(worker.ProviderError):
                worker.synthesize({
                    "text": "Hello.", "speaker": "voice", "language": None,
                    "output": str(Path(d) / "out.wav"), "options": {},
                })
        self.assertEqual(call_count, 1)


class TestVoiceListing(unittest.TestCase):
    def test_voice_listing_is_generic_and_network_is_mocked(self):
        pages = [{
            "voices": [
                {"voice_id": "a", "name": "Alpha"},
                {"voice_id": "b", "name": "Beta"},
            ],
            "has_more": False,
            "next_page_token": None,
        }]
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "secret"}, clear=True), \
                mock.patch.object(worker, "request_json", side_effect=pages) as request:
            response = worker.handle({"operation": "listVoices"})
        self.assertEqual(response, {
            "ok": True,
            "voices": [{"id": "a", "name": "Alpha"}, {"id": "b", "name": "Beta"}],
        })
        self.assertIn("/v2/voices?", request.call_args.args[0])

    def test_api_key_never_appears_in_diagnostics_or_structured_error(self):
        secret = "a-key-that-must-not-leak"
        error = worker.ProviderError("authentication_failed", "authentication rejected")
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": secret}, clear=True):
            response = {
                "ok": False,
                "error": {"code": error.code, "message": error.message},
            }
        self.assertNotIn(secret, json.dumps(response))


if __name__ == "__main__":
    unittest.main()
