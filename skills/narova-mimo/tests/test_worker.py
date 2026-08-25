from __future__ import annotations

import base64
import hashlib
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
SPEC = importlib.util.spec_from_file_location("narova_mimo_worker", WORKER_PATH)
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


def mimo_response(payload: bytes) -> dict:
    return {
        "choices": [{
            "message": {"audio": {"data": base64.b64encode(payload).decode()}},
        }],
    }


class FakeResponse:
    def __init__(self, body: bytes):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _size=-1):
        body, self.body = self.body, b""
        return body


class TestProtocol(unittest.TestCase):
    def test_handshake_needs_no_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.handle({
                "operation": "hello",
                "protocol": "narova-tts-provider/v1",
            }), {
                "ok": True,
                "protocol": "narova-tts-provider/v1",
                "provider": "mimo",
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
                "speaker": "Chloe",
                "output": str(Path(directory) / "out.wav"),
                "options": {},
            }
            with mock.patch("urllib.request.urlopen") as urlopen, \
                    self.assertRaises(worker.ProviderError) as error:
                worker.handle(request)
            urlopen.assert_not_called()
        self.assertEqual(error.exception.code, "missing_environment")


class TestRequestMapping(unittest.TestCase):
    def test_preset_defaults_map_to_chat_completions(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            base_url, payload, timeout = worker.build_request({
                "text": "你好。", "speaker": "冰糖", "options": {},
            })
        self.assertEqual(base_url, "https://api.xiaomimimo.com/v1")
        self.assertEqual(payload, {
            "model": "mimo-v2.5-tts",
            "messages": [
                {"role": "user", "content": ""},
                {"role": "assistant", "content": "你好。"},
            ],
            "audio": {"format": "wav", "voice": "冰糖"},
        })
        self.assertEqual(timeout, 120.0)

    def test_instructions_map_to_the_user_message(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            _base, payload, timeout = worker.build_request({
                "text": "Hello.",
                "speaker": "Chloe",
                "options": {
                    "model": "mimo-v2.5-tts",
                    "instructions": "Warm, confident documentary narration.",
                    "requestTimeoutSeconds": 12,
                },
            })
        self.assertEqual(payload["messages"][1],
                         {"role": "assistant", "content": "Hello."})
        self.assertEqual(payload["messages"][0],
                         {"role": "user", "content": "Warm, confident documentary narration."})
        self.assertEqual(payload["audio"]["voice"], "Chloe")
        self.assertEqual(timeout, 12.0)

    def test_endpoint_option_and_env_override_select_the_base_url(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            base_url, _payload, _timeout = worker.build_request({
                "text": "Hello.", "speaker": "Mia",
                "options": {"endpoint": "token-plan-sgp"},
            })
        self.assertEqual(base_url, "https://token-plan-sgp.xiaomimimo.com/v1")
        with mock.patch.dict(os.environ, {"MIMO_BASE_URL": "https://proxy.example.test/v1"}, clear=True):
            base_url, _payload, _timeout = worker.build_request({
                "text": "Hello.", "speaker": "Mia",
                "options": {"endpoint": "token-plan-cn"},
            })
        self.assertEqual(base_url, "https://proxy.example.test/v1")
        with mock.patch.dict(os.environ, {"MIMO_BASE_URL": "http://insecure.example.test"}, clear=True):
            with self.assertRaises(worker.ProviderError) as error:
                worker.build_request({"text": "Hello.", "speaker": "Mia", "options": {}})
        self.assertEqual(error.exception.code, "invalid_options")

    def test_unknown_options_models_and_endpoints_are_rejected(self):
        base = {"text": "Hello.", "speaker": "Chloe"}
        with mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch("urllib.request.urlopen") as urlopen:
            for options in (
                {"mystery": 1},
                {"model": "mimo-v2-tts"},
                {"endpoint": "trial"},
            ):
                with self.subTest(options=options), \
                        self.assertRaises(worker.ProviderError) as error:
                    worker.build_request({**base, "options": options})
                self.assertEqual(error.exception.code, "invalid_options")
            urlopen.assert_not_called()

    def test_ranges_and_text_limits_are_rejected_before_network(self):
        base = {"text": "Hello.", "speaker": "Chloe"}
        with mock.patch.dict(os.environ, {}, clear=True):
            for options in ({"requestTimeoutSeconds": 0.5}, {"requestTimeoutSeconds": 601}):
                with self.subTest(options=options), \
                        self.assertRaises(worker.ProviderError) as error:
                    worker.build_request({**base, "options": options})
                self.assertEqual(error.exception.code, "invalid_options")
            for request in (
                {**base, "text": ""},
                {**base, "text": "x" * (worker.MAX_TEXT_LENGTH + 1)},
                {**base, "speaker": ""},
            ):
                with self.subTest(request=request), \
                        self.assertRaises(worker.ProviderError) as error:
                    worker.build_request(request)
                self.assertEqual(error.exception.code, "invalid_request")


class TestVoiceDesign(unittest.TestCase):
    def test_design_brief_is_the_user_message_and_voice_is_omitted(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            _base, payload, _timeout = worker.build_request({
                "text": "你好，世界。",
                "options": {
                    "model": "mimo-v2.5-tts-voicedesign",
                    "design": "A warm female narrator in her thirties, calm and steady.",
                },
            })
        self.assertEqual(payload["model"], "mimo-v2.5-tts-voicedesign")
        self.assertEqual(payload["messages"][0], {
            "role": "user",
            "content": "A warm female narrator in her thirties, calm and steady.",
        })
        self.assertEqual(payload["messages"][1],
                         {"role": "assistant", "content": "你好，世界。"})
        self.assertEqual(payload["audio"], {"format": "wav"})

    def test_design_is_required_and_instructions_are_rejected(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(worker.ProviderError) as error:
                worker.build_request({
                    "text": "Hello.", "options": {"model": "mimo-v2.5-tts-voicedesign"},
                })
            self.assertEqual(error.exception.code, "invalid_options")
            with self.assertRaises(worker.ProviderError) as error:
                worker.build_request({
                    "text": "Hello.",
                    "options": {
                        "model": "mimo-v2.5-tts-voicedesign",
                        "design": "A calm narrator.",
                        "instructions": "Speak faster.",
                    },
                })
            self.assertEqual(error.exception.code, "invalid_options")

    def test_speaker_is_optional_but_must_be_non_empty_when_present(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(worker.ProviderError) as error:
                worker.build_request({
                    "text": "Hello.", "speaker": "  ",
                    "options": {"model": "mimo-v2.5-tts-voicedesign", "design": "Calm."},
                })
            self.assertEqual(error.exception.code, "invalid_request")
            _base, payload, _timeout = worker.build_request({
                "text": "Hello.", "speaker": "anchor-take-1",
                "options": {"model": "mimo-v2.5-tts-voicedesign", "design": "Calm."},
            })
        self.assertNotIn("voice", payload["audio"])


class TestVoiceClone(unittest.TestCase):
    def _request(self, speaker: str, **options):
        return {
            "text": "Hello.",
            "speaker": speaker,
            "options": {"model": "mimo-v2.5-tts-voiceclone", **options},
        }

    def test_reference_file_becomes_a_data_uri(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "anchor.wav"
            reference.write_bytes(wav_bytes())
            mp3 = Path(directory) / "anchor.mp3"
            mp3.write_bytes(b"\xff\xfb" * 50)
            with mock.patch.dict(os.environ, {}, clear=True):
                _base, payload, _timeout = worker.build_request(
                    self._request(str(reference)))
                self.assertEqual(
                    payload["audio"]["voice"],
                    "data:audio/wav;base64," + base64.b64encode(wav_bytes()).decode(),
                )
                _base, payload, _timeout = worker.build_request(self._request(str(mp3)))
                self.assertTrue(payload["audio"]["voice"].startswith("data:audio/mpeg;base64,"))

    def test_reference_digest_is_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "anchor.wav"
            data = wav_bytes()
            reference.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            with mock.patch.dict(os.environ, {}, clear=True):
                _base, payload, _timeout = worker.build_request(
                    self._request(str(reference), referenceDigest=digest))
                self.assertIn("voice", payload["audio"])
                with self.assertRaises(worker.ProviderError) as error:
                    worker.build_request(
                        self._request(str(reference), referenceDigest="0" * 64))
                self.assertEqual(error.exception.code, "invalid_request")
                with self.assertRaises(worker.ProviderError) as error:
                    worker.build_request(
                        self._request(str(reference), referenceDigest="not-hex"))
                self.assertEqual(error.exception.code, "invalid_options")

    def test_invalid_references_fail_before_any_network_call(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.wav"
            text_file = Path(directory) / "notes.txt"
            text_file.write_text("not audio")
            cases = [
                self._request("relative/anchor.wav"),
                self._request(str(text_file)),
                self._request(str(missing)),
            ]
            with mock.patch.dict(os.environ, {"MIMO_API_KEY": "secret"}, clear=True), \
                    mock.patch("urllib.request.urlopen") as urlopen:
                for request in cases:
                    with self.subTest(speaker=request["speaker"]), \
                            self.assertRaises(worker.ProviderError) as error:
                        worker.build_request(request)
                    self.assertEqual(error.exception.code, "invalid_request")
                urlopen.assert_not_called()

    def test_oversized_reference_fails_before_any_network_call(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "big.wav"
            reference.write_bytes(b"\0" * 256)
            with mock.patch.dict(os.environ, {"MIMO_API_KEY": "secret"}, clear=True), \
                    mock.patch.object(worker, "MAX_REFERENCE_BASE64", 100), \
                    mock.patch("urllib.request.urlopen") as urlopen:
                with self.assertRaises(worker.ProviderError) as error:
                    worker.build_request(self._request(str(reference)))
                self.assertEqual(error.exception.code, "invalid_request")
                urlopen.assert_not_called()


class TestSynthesis(unittest.TestCase):
    def test_http_request_uses_chat_completions_header_auth_and_json(self):
        seen = {}

        def open_request(request, timeout):
            seen.update(request=request, timeout=timeout)
            return FakeResponse(json.dumps(mimo_response(wav_bytes())).encode())

        payload = {"model": "mimo-v2.5-tts", "messages": [], "audio": {"format": "wav"}}
        with mock.patch.object(worker, "_open", open_request):
            audio = worker.download_speech(
                "test-secret", "https://api.xiaomimimo.com/v1", payload, 9.0)
        request = seen["request"]
        self.assertEqual(request.full_url, "https://api.xiaomimimo.com/v1/chat/completions")
        self.assertNotIn("test-secret", request.full_url)
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.get_header("Api-key"), "test-secret")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(request.data), payload)
        self.assertEqual(seen["timeout"], 9.0)
        self.assertEqual(audio, wav_bytes())

    def test_http_errors_are_structured(self):
        for status, code in (
            (401, "authentication_failed"),
            (403, "authentication_failed"),
            (429, "rate_limited"),
            (400, "invalid_request"),
            (500, "service_error"),
        ):
            error = urllib.error.HTTPError("url", status, "bad", {}, None)
            error.read = mock.Mock(return_value=b"{}")
            with self.subTest(status=status):
                self.assertEqual(worker._http_error(error).code, code)

    def test_network_failure_is_structured(self):
        def fail(_request, timeout):
            raise urllib.error.URLError("unreachable")

        with mock.patch("urllib.request.urlopen", fail):
            with self.assertRaises(worker.ProviderError) as error:
                worker.download_speech(
                    "key", "https://api.xiaomimimo.com/v1", {}, 1.0)
        self.assertEqual(error.exception.code, "network_error")

    def test_invalid_json_and_missing_audio_are_structured(self):
        bodies = (
            b"not json",
            json.dumps({"choices": [{"message": {}}]}).encode(),
        )
        for body in bodies:
            with self.subTest(body=body), \
                    mock.patch.object(worker, "_open", lambda _r, _t: FakeResponse(body)):
                with self.assertRaises(worker.ProviderError) as error:
                    worker.download_speech("key", "https://api.xiaomimimo.com/v1", {}, 1.0)
                self.assertEqual(error.exception.code, "invalid_response")

    def test_credential_echoed_by_vendor_is_redacted(self):
        secret = "leaky-secret-123"
        body = json.dumps({"error": {"message": f"invalid key {secret}"}}).encode()
        with mock.patch.dict(os.environ, {"MIMO_API_KEY": secret}, clear=True):
            error = urllib.error.HTTPError("url", 400, "bad", {}, None)
            error.read = mock.Mock(return_value=body)
            mapped = worker._http_error(error)
            self.assertNotIn(secret, mapped.message)
            self.assertIn("[redacted]", mapped.message)

    def test_raw_pcm_response_is_wrapped_into_mono_wav(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out.wav"
            worker.write_wav(b"\0\0" * 100, output)
            with wave.open(str(output), "rb") as audio:
                self.assertEqual(audio.getnchannels(), 1)
                self.assertEqual(audio.getframerate(), 24000)
                self.assertGreater(audio.getnframes(), 0)

    def test_stereo_or_invalid_audio_is_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out.wav"
            with self.assertRaises(worker.ProviderError) as error:
                worker.write_wav(wav_bytes(channels=2), output)
            self.assertEqual(error.exception.code, "invalid_response")
            self.assertFalse(output.exists())
            with self.assertRaises(worker.ProviderError) as error:
                worker.write_wav(b"RIFF\x00\x00\x00\x00WAVEjunk", output)
            self.assertEqual(error.exception.code, "invalid_response")
            self.assertFalse(output.exists())

    def test_synthesis_publishes_wav_and_never_returns_secret(self):
        seen = {}

        def download(key, base_url, payload, timeout):
            seen.update(key=key, base_url=base_url, payload=payload, timeout=timeout)
            return b"\0\0" * 100

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, {"MIMO_API_KEY": "test-secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", download):
            output = Path(directory) / "out.wav"
            response = worker.handle({
                "id": "r1",
                "operation": "synthesize",
                "text": "Hello.",
                "speaker": "Mia",
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
                mock.patch.dict(os.environ, {"MIMO_API_KEY": "secret"}, clear=True), \
                mock.patch.object(worker, "download_speech", fail):
            with self.assertRaises(worker.ProviderError):
                worker.synthesize({
                    "text": "Hello.", "speaker": "Mia",
                    "output": str(Path(directory) / "out.wav"), "options": {},
                })
        self.assertEqual(call_count, 1)


class TestVoiceListing(unittest.TestCase):
    def test_preset_catalog_is_listed_without_network_or_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch("urllib.request.urlopen") as urlopen:
            response = worker.handle({"operation": "listVoices"})
            urlopen.assert_not_called()
        self.assertTrue(response["ok"])
        voices = response["voices"]
        self.assertEqual(len(voices), 9)
        ids = [voice["id"] for voice in voices]
        self.assertEqual(len(ids), len(set(ids)))
        for expected in ("mimo_default", "冰糖", "茉莉", "苏打", "白桦",
                         "Mia", "Chloe", "Milo", "Dean"):
            self.assertIn(expected, ids)
        default = next(voice for voice in voices if voice["id"] == "mimo_default")
        self.assertIn("cluster", default["name"])

    def test_credential_never_appears_in_structured_errors(self):
        secret = "a-key-that-must-not-leak"
        error = worker.ProviderError("authentication_failed", "authentication rejected")
        with mock.patch.dict(os.environ, {"MIMO_API_KEY": secret}, clear=True):
            response = {"ok": False, "error": {"code": error.code, "message": error.message}}
        self.assertNotIn(secret, json.dumps(response))


if __name__ == "__main__":
    unittest.main()
