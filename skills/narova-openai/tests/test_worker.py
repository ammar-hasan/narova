from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
import urllib.error
import wave
from pathlib import Path
from unittest import mock


WORKER_PATH = Path(__file__).parents[1] / "tool" / "worker.py"
SPEC = importlib.util.spec_from_file_location("narova_openai_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(worker)


def wav_bytes() -> bytes:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "sample.wav"
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(24000)
            output.writeframes(b"\0\0" * 100)
        return path.read_bytes()


class TestProtocol(unittest.TestCase):
    def test_handshake_needs_no_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.handle({
                "operation": "hello",
                "protocol": "narova-tts-provider/v1",
            }), {
                "ok": True,
                "protocol": "narova-tts-provider/v1",
                "provider": "openai",
                "providerVersion": "1.0.0",
            })

    def test_wrong_protocol_is_structured(self):
        with self.assertRaises(worker.ProviderError) as error:
            worker.handle({"operation": "hello", "protocol": "v2"})
        self.assertEqual(error.exception.code, "unsupported_protocol")

    def test_missing_key_is_not_accepted_in_synthesis_request(self):
        with mock.patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as directory:
            request = {
                "id": "r1",
                "operation": "synthesize",
                "text": "Hello.",
                "speaker": "marin",
                "language": "en-US",
                "output": str(Path(directory) / "out.wav"),
                "options": {},
            }
            with self.assertRaises(worker.ProviderError) as error:
                worker.handle(request)
        self.assertEqual(error.exception.code, "missing_environment")
        self.assertNotIn("api_key", json.dumps(request).lower())


class TestRequestMapping(unittest.TestCase):
    def test_current_snapshot_custom_voice_and_controls_map_to_speech_api(self):
        payload, timeout = worker.build_request({
            "text": "السلام علیکم۔",
            "speaker": "voice_1234",
            "language": "ur-PK",
            "options": {
                "model": "gpt-4o-mini-tts-2025-12-15",
                "instructions": "Warm, confident documentary narration.",
                "speed": 1.08,
                "requestTimeoutSeconds": 12,
            },
        })
        self.assertEqual(payload, {
            "model": "gpt-4o-mini-tts-2025-12-15",
            "voice": {"id": "voice_1234"},
            "input": "السلام علیکم۔",
            "response_format": "wav",
            "instructions": (
                'Speak the supplied text in the language indicated by BCP 47 tag "ur-PK".\n'
                "Warm, confident documentary narration."
            ),
            "speed": 1.08,
        })
        self.assertEqual(timeout, 12.0)

    def test_default_uses_current_alias_builtin_voice_and_direct_wav(self):
        payload, timeout = worker.build_request({
            "text": "Hello.", "speaker": "marin", "language": None, "options": {},
        })
        self.assertEqual(payload, {
            "model": "gpt-4o-mini-tts",
            "voice": "marin",
            "input": "Hello.",
            "response_format": "wav",
        })
        self.assertEqual(timeout, 60.0)

    def test_supported_model_set_matches_current_speech_reference(self):
        self.assertEqual(worker.SUPPORTED_MODELS, {
            "gpt-4o-mini-tts",
            "gpt-4o-mini-tts-2025-12-15",
            "tts-1",
            "tts-1-hd",
        })

    def test_unknown_options_model_and_legacy_instructions_are_rejected(self):
        base = {"text": "Hello.", "speaker": "marin", "language": None}
        for options in (
            {"mystery": 1},
            {"model": "gpt-live-1"},
            {"model": "tts-1-hd", "instructions": "Sound warm."},
        ):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError) as error:
                worker.build_request({**base, "options": options})
            self.assertEqual(error.exception.code, "invalid_options")

    def test_ranges_and_text_limits_are_rejected_before_network(self):
        base = {"text": "Hello.", "speaker": "marin", "language": None}
        for options in ({"speed": 0.24}, {"speed": 4.01}, {"requestTimeoutSeconds": 301}):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError):
                worker.build_request({**base, "options": options})
        with self.assertRaises(worker.ProviderError) as error:
            worker.build_request({
                **base,
                "text": "x" * (worker.MAX_TEXT_LENGTH + 1),
                "options": {},
            })
        self.assertEqual(error.exception.code, "invalid_request")


class TestSynthesis(unittest.TestCase):
    def test_http_request_uses_speech_endpoint_bearer_auth_and_json(self):
        seen = {}

        class Response:
            headers = {"x-request-id": "req_http"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return wav_bytes()

        def open_request(request, timeout):
            seen.update(request=request, timeout=timeout)
            return Response()

        payload = {
            "model": "gpt-4o-mini-tts",
            "voice": "marin",
            "input": "Hello.",
            "response_format": "wav",
        }
        with mock.patch.object(worker, "_open", open_request):
            audio, metadata = worker.download_speech("test-secret", payload, 9.0)
        request = seen["request"]
        self.assertEqual(request.full_url, "https://api.openai.com/v1/audio/speech")
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-secret")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(request.data), payload)
        self.assertEqual(seen["timeout"], 9.0)
        self.assertEqual(metadata, {"requestId": "req_http"})
        self.assertTrue(audio)

    def test_http_errors_are_structured_and_bounded(self):
        body = json.dumps({"error": {"message": "bad voice"}}).encode()
        error = urllib.error.HTTPError("url", 400, "bad", {}, None)
        error.read = mock.Mock(return_value=body)
        mapped = worker._http_error(error)
        self.assertEqual(mapped.code, "invalid_request")
        self.assertIn("bad voice", mapped.message)

    def test_synthesis_writes_valid_wav_and_never_returns_secret(self):
        seen = {}

        def download(key, payload, timeout):
            seen.update(key=key, payload=payload, timeout=timeout)
            return wav_bytes(), {"requestId": "req_test"}

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", download):
            output = Path(directory) / "out.wav"
            response = worker.handle({
                "id": "r1",
                "operation": "synthesize",
                "text": "Hello.",
                "speaker": "cedar",
                "language": None,
                "output": str(output),
                "options": {"instructions": "Natural narration."},
            })
            with wave.open(str(output), "rb") as audio:
                self.assertGreater(audio.getnframes(), 0)
        self.assertEqual(response, {"id": "r1", "ok": True, "output": str(output)})
        self.assertEqual(seen["key"], "test-secret")
        self.assertEqual(seen["payload"]["response_format"], "wav")
        self.assertNotIn("test-secret", json.dumps(response))

    def test_invalid_wav_is_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out.wav"
            with self.assertRaises(worker.ProviderError) as error:
                worker.write_wav(b"not audio", output)
            self.assertEqual(error.exception.code, "invalid_response")
            self.assertFalse(output.exists())

    def test_unsafe_output_is_rejected(self):
        with self.assertRaises(worker.ProviderError) as error:
            worker.validate_output("relative.wav")
        self.assertEqual(error.exception.code, "invalid_output")

    def test_no_retry_on_network_or_service_failure(self):
        call_count = 0

        def fail(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            raise worker.ProviderError("network_error", "safe failure")

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, {"OPENAI_API_KEY": "secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", fail):
            with self.assertRaises(worker.ProviderError):
                worker.synthesize({
                    "text": "Hello.", "speaker": "marin", "language": None,
                    "output": str(Path(directory) / "out.wav"), "options": {},
                })
        self.assertEqual(call_count, 1)


class TestVoiceListing(unittest.TestCase):
    def test_builtins_are_listed_without_network_or_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            response = worker.handle({"operation": "listVoices"})
        self.assertTrue(response["ok"])
        self.assertEqual(len(response["voices"]), 13)
        self.assertEqual(response["voices"][:2], [
            {"id": "marin", "name": "Marin (recommended)"},
            {"id": "cedar", "name": "Cedar (recommended)"},
        ])

    def test_api_key_never_appears_in_structured_errors(self):
        secret = "a-key-that-must-not-leak"
        error = worker.ProviderError("authentication_failed", "authentication rejected")
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": secret}, clear=True):
            response = {"ok": False, "error": {"code": error.code, "message": error.message}}
        self.assertNotIn(secret, json.dumps(response))


if __name__ == "__main__":
    unittest.main()
