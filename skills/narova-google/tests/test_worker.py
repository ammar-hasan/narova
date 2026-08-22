from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.error
import wave
from pathlib import Path
from unittest import mock


WORKER_PATH = Path(__file__).parents[1] / "tool" / "worker.py"
SPEC = importlib.util.spec_from_file_location("narova_google_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(worker)


def wav_bytes(channels: int = 1) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(b"\0\0" * 100)
    return buffer.getvalue()


def gemini_response(mime: str, payload: bytes) -> dict:
    import base64
    return {
        "candidates": [{
            "content": {"parts": [{"inlineData": {
                "mimeType": mime, "data": base64.b64encode(payload).decode(),
            }}]},
        }],
    }


class TestProtocol(unittest.TestCase):
    def test_handshake_needs_no_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.handle({
                "operation": "hello",
                "protocol": "narova-tts-provider/v1",
            }), {
                "ok": True,
                "protocol": "narova-tts-provider/v1",
                "provider": "google",
                "providerVersion": "1.0.0",
            })

    def test_wrong_protocol_is_structured(self):
        with self.assertRaises(worker.ProviderError) as error:
            worker.handle({"operation": "hello", "protocol": "v2"})
        self.assertEqual(error.exception.code, "unsupported_protocol")

    def test_missing_key_is_structured_before_network(self):
        with mock.patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as directory:
            request = {
                "id": "r1",
                "operation": "synthesize",
                "text": "Hello.",
                "speaker": "Kore",
                "language": "en-US",
                "output": str(Path(directory) / "out.wav"),
                "options": {},
            }
            with self.assertRaises(worker.ProviderError) as error:
                worker.handle(request)
        self.assertEqual(error.exception.code, "missing_environment")
        self.assertNotIn("api_key", json.dumps(request).lower())


class TestRequestMapping(unittest.TestCase):
    def test_defaults_map_to_gemini_generate_content(self):
        payload, timeout = worker.build_request({
            "text": "Hello.", "speaker": "Kore", "language": None, "options": {},
        })
        self.assertEqual(payload, {
            "contents": [{"role": "user", "parts": [{"text": "Hello."}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Kore"}},
                },
            },
        })
        self.assertEqual(timeout, 60.0)

    def test_options_instructions_language_and_timeout_map(self):
        payload, timeout = worker.build_request({
            "text": "السلام علیکم۔",
            "speaker": "Puck",
            "language": "ur-PK",
            "options": {
                "model": "gemini-3.1-flash-tts-preview",
                "instructions": "Warm, confident documentary narration.",
                "requestTimeoutSeconds": 12,
            },
        })
        text = payload["contents"][0]["parts"][0]["text"]
        self.assertIn("Warm, confident documentary narration.", text)
        self.assertIn("السلام علیکم۔", text)
        speech_config = payload["generationConfig"]["speechConfig"]
        self.assertEqual(speech_config["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"], "Puck")
        self.assertEqual(speech_config["languageCode"], "ur-PK")
        self.assertEqual(payload["generationConfig"]["responseModalities"], ["AUDIO"])
        self.assertEqual(timeout, 12.0)

    def test_unknown_options_unsupported_models_and_speed_are_rejected(self):
        base = {"text": "Hello.", "speaker": "Kore", "language": None}
        for options in (
            {"mystery": 1},
            {"speed": 1.2},
            {"model": "gemini-live-1"},
        ):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError) as error:
                worker.build_request({**base, "options": options})
            self.assertEqual(error.exception.code, "invalid_options")

    def test_ranges_and_text_limits_are_rejected_before_network(self):
        base = {"text": "Hello.", "speaker": "Kore", "language": None}
        for options in ({"requestTimeoutSeconds": 0.5}, {"requestTimeoutSeconds": 301}):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError) as error:
                worker.build_request({**base, "options": options})
            self.assertEqual(error.exception.code, "invalid_options")
        for request in (
            {**base, "text": ""},
            {**base, "text": "x" * (worker.MAX_TEXT_LENGTH + 1)},
            {**base, "speaker": ""},
        ):
            with self.subTest(request=request), self.assertRaises(worker.ProviderError) as error:
                worker.build_request(request)
            self.assertEqual(error.exception.code, "invalid_request")


class TestSynthesis(unittest.TestCase):
    def test_http_request_uses_gemini_endpoint_header_auth_and_json(self):
        seen = {}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(gemini_response(
                    "audio/L16;codec=pcm;rate=24000", b"\0\0" * 100)).encode()

        def open_request(request, timeout):
            seen.update(request=request, timeout=timeout)
            return Response()

        payload = {"contents": []}
        with mock.patch.object(worker, "_open", open_request):
            audio, metadata = worker.download_speech("test-secret", "m1", payload, 9.0)
        request = seen["request"]
        self.assertEqual(request.full_url, worker._api_url("m1"))
        self.assertNotIn("test-secret", request.full_url)
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.get_header("X-goog-api-key"), "test-secret")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(request.data), payload)
        self.assertEqual(seen["timeout"], 9.0)
        self.assertTrue(audio)
        self.assertEqual(metadata["mimeType"], "audio/L16;codec=pcm;rate=24000")

    def test_http_errors_are_structured_and_bounded(self):
        body = json.dumps({"error": {"message": "bad voice"}}).encode()
        error = urllib.error.HTTPError("url", 400, "bad", {}, None)
        error.read = mock.Mock(return_value=body)
        mapped = worker._http_error(error)
        self.assertEqual(mapped.code, "invalid_request")
        self.assertIn("bad voice", mapped.message)
        rate_limit = urllib.error.HTTPError("url", 429, "busy", {}, None)
        rate_limit.read = mock.Mock(return_value=b"{}")
        self.assertEqual(worker._http_error(rate_limit).code, "rate_limited")
        auth = urllib.error.HTTPError("url", 403, "no", {}, None)
        auth.read = mock.Mock(return_value=b"{}")
        self.assertEqual(worker._http_error(auth).code, "authentication_failed")

    def test_raw_pcm_response_is_wrapped_into_mono_wav(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out.wav"
            worker.write_wav(b"\0\0" * 100, "audio/L16;codec=pcm;rate=24000", output)
            with wave.open(str(output), "rb") as audio:
                self.assertEqual(audio.getnchannels(), 1)
                self.assertEqual(audio.getframerate(), 24000)
                self.assertGreater(audio.getnframes(), 0)

    def test_riff_response_is_validated_and_published(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out.wav"
            worker.write_wav(wav_bytes(), "audio/wav", output)
            with wave.open(str(output), "rb") as audio:
                self.assertGreater(audio.getnframes(), 0)

    def test_stereo_or_invalid_audio_is_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out.wav"
            with self.assertRaises(worker.ProviderError) as error:
                worker.write_wav(wav_bytes(channels=2), "audio/wav", output)
            self.assertEqual(error.exception.code, "invalid_response")
            self.assertFalse(output.exists())
            with self.assertRaises(worker.ProviderError) as error:
                worker.write_wav(b"RIFF\x00\x00\x00\x00WAVEjunk", "audio/wav", output)
            self.assertEqual(error.exception.code, "invalid_response")
            self.assertFalse(output.exists())

    def test_synthesis_publishes_wav_and_never_returns_secret(self):
        seen = {}

        def download(key, model, payload, timeout):
            seen.update(key=key, model=model, payload=payload, timeout=timeout)
            return b"\0\0" * 100, {"mimeType": "audio/L16;codec=pcm;rate=24000"}

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test-secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", download):
            output = Path(directory) / "out.wav"
            response = worker.handle({
                "id": "r1",
                "operation": "synthesize",
                "text": "Hello.",
                "speaker": "Kore",
                "language": None,
                "output": str(output),
                "options": {"instructions": "Natural narration."},
            })
            with wave.open(str(output), "rb") as audio:
                self.assertGreater(audio.getnframes(), 0)
        self.assertEqual(response, {"id": "r1", "ok": True, "output": str(output)})
        self.assertEqual(seen["key"], "test-secret")
        self.assertNotIn("test-secret", json.dumps(response))

    def test_invalid_output_and_no_retry(self):
        with self.assertRaises(worker.ProviderError) as error:
            worker.validate_output("relative.wav")
        self.assertEqual(error.exception.code, "invalid_output")
        call_count = 0

        def fail(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            raise worker.ProviderError("network_error", "safe failure")

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, {"GEMINI_API_KEY": "secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", fail):
            with self.assertRaises(worker.ProviderError):
                worker.synthesize({
                    "text": "Hello.", "speaker": "Kore", "language": None,
                    "output": str(Path(directory) / "out.wav"), "options": {},
                })
        self.assertEqual(call_count, 1)


class TestVoiceListing(unittest.TestCase):
    def test_builtins_are_listed_without_network_or_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            response = worker.handle({"operation": "listVoices"})
        self.assertTrue(response["ok"])
        ids = [voice["id"] for voice in response["voices"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("Kore", ids)

    def test_credential_never_appears_in_structured_errors(self):
        secret = "a-key-that-must-not-leak"
        error = worker.ProviderError("authentication_failed", "authentication rejected")
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": secret}, clear=True):
            response = {"ok": False, "error": {"code": error.code, "message": error.message}}
        self.assertNotIn(secret, json.dumps(response))


if __name__ == "__main__":
    unittest.main()
