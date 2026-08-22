from __future__ import annotations

import base64
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


WORKER_PATH = Path(__file__).parents[1] / "tool" / "video-worker.py"
SPEC = importlib.util.spec_from_file_location("narova_google_video_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(worker)


def veo_response(payload: bytes) -> dict:
    return {
        "candidates": [{
            "content": {"parts": [{"inlineData": {
                "mimeType": "video/mp4",
                "data": base64.b64encode(payload).decode(),
            }}]},
        }],
    }


class TestProtocolAndMapping(unittest.TestCase):
    def test_handshake_needs_no_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.handle({"operation": "hello", "protocol": worker.PROTOCOL}), {
                "ok": True, "protocol": worker.PROTOCOL, "provider": "veo", "providerVersion": "1.0.0",
            })

    def test_wrong_protocol_is_structured(self):
        with self.assertRaises(worker.ProviderError) as error:
            worker.handle({"operation": "hello", "protocol": "v2"})
        self.assertEqual(error.exception.code, "unsupported_protocol")

    def test_defaults_map_to_veo_generate_content(self):
        payload, timeout, params = worker.build_request({"prompt": "A miniature city.", "options": {}})
        self.assertEqual(payload["contents"][0]["parts"][0]["text"], "A miniature city.")
        self.assertEqual(payload["generationConfig"]["responseModalities"], ["VIDEO"])
        self.assertEqual(timeout, worker.DEFAULT_TIMEOUT)
        self.assertEqual(params["durationSeconds"], 8)

    def test_options_duration_ratio_and_seed_map(self):
        payload, _timeout, params = worker.build_request({
            "prompt": "x",
            "options": {"model": "veo-3.1-fast-generate-preview", "durationSeconds": 4,
                        "aspectRatio": "9:16", "seed": 7},
        })
        text = payload["contents"][0]["parts"][0]["text"]
        self.assertIn("9:16", text)
        self.assertIn("x", text)
        self.assertEqual(payload["generationConfig"]["durationSeconds"], 4)
        self.assertEqual(params["aspectRatio"], "9:16")
        self.assertEqual(params["durationSeconds"], 4)
        self.assertEqual(payload["generationConfig"]["seed"], 7)

    def test_invalid_options_and_long_prompt_are_rejected(self):
        for options in (
            {"mystery": 1},
            {"model": "veo-live-1"},
            {"durationSeconds": 5},
            {"durationSeconds": "8"},
            {"aspectRatio": "21:9"},
            {"seed": -1},
        ):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError) as error:
                worker.build_request({"prompt": "x", "options": options})
            self.assertEqual(error.exception.code, "invalid_options")
        with self.assertRaises(worker.ProviderError) as error:
            worker.build_request({"prompt": "x" * (worker.MAX_PROMPT_LENGTH + 1), "options": {}})
        self.assertEqual(error.exception.code, "invalid_request")
        with self.assertRaises(worker.ProviderError) as error:
            worker.build_request({"prompt": "  ", "options": {}})
        self.assertEqual(error.exception.code, "invalid_request")

    def test_falsy_non_object_options_and_fractional_seed_are_rejected(self):
        for options in ([], "", 0, False, {"seed": 1.9}, {"seed": True}):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError) as error:
                worker.build_request({"prompt": "x", "options": options})
            self.assertEqual(error.exception.code, "invalid_options")

    def test_bounded_read_enforces_limit(self):
        class Response:
            def __init__(self):
                self.calls = 0

            def read(self, _size):
                self.calls += 1
                return b"x" * 8 if self.calls <= 5 else b""

        with self.assertRaises(worker.ProviderError) as error:
            worker._read_bounded(Response(), 16)
        self.assertEqual(error.exception.code, "invalid_response")


class TestGeneration(unittest.TestCase):
    def test_http_request_uses_gemini_endpoint_header_auth_and_json(self):
        seen = {}

        class Response:
            def __init__(self):
                self.body = json.dumps(veo_response(b"video")).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size=-1):
                body, self.body = self.body, b""
                return body

        def opening(request, timeout):
            seen.update(request=request, timeout=timeout)
            return Response()

        payload = {"contents": []}
        with mock.patch.object(worker, "_open", opening):
            video, metadata = worker.generate_video("test-secret", "m1", payload, 9)
        request = seen["request"]
        self.assertEqual(request.full_url, worker._api_url("m1"))
        self.assertNotIn("test-secret", request.full_url)
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.get_header("X-goog-api-key"), "test-secret")
        self.assertEqual(json.loads(request.data), payload)
        self.assertEqual(seen["timeout"], 9)
        self.assertEqual(video, b"video")
        self.assertEqual(metadata["mimeType"], "video/mp4")

    def test_generate_submits_once_and_returns_safe_metadata(self):
        calls = {"network": 0}

        def network(*_args):
            calls["network"] += 1
            return b"video-bytes", {"mimeType": "video/mp4"}

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, {"GEMINI_API_KEY": "secret"}, clear=True), \
                mock.patch.object(worker, "generate_video", network):
            output = Path(directory) / "stage.mp4"
            response = worker.handle({
                "id": "r1", "operation": "generate", "prompt": "x",
                "output": str(output),
                "options": {"durationSeconds": 6},
            })
            self.assertEqual(output.read_bytes(), b"video-bytes")
        self.assertEqual(calls, {"network": 1})
        self.assertEqual(response["metadata"]["model"], worker.DEFAULT_MODEL)
        self.assertEqual(response["metadata"]["params"]["durationSeconds"], 6)
        self.assertNotIn("secret", json.dumps(response))

    def test_empty_or_malformed_response_is_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "stage.mp4"
            with self.assertRaises(worker.ProviderError) as error:
                worker.write_video(b"", output)
            self.assertEqual(error.exception.code, "invalid_response")
            self.assertFalse(output.exists())

    def test_missing_key_relative_output_and_unsupported_operation(self):
        with mock.patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(worker.ProviderError) as error:
                worker.generate({"prompt": "x", "output": str(Path(directory) / "out.mp4"), "options": {}})
            self.assertEqual(error.exception.code, "missing_environment")
        with self.assertRaises(worker.ProviderError) as error:
            worker.validate_output("relative.mp4")
        self.assertEqual(error.exception.code, "invalid_output")
        with self.assertRaises(worker.ProviderError) as error:
            worker.handle({"operation": "synthesize"})
        self.assertEqual(error.exception.code, "unsupported_operation")


if __name__ == "__main__":
    unittest.main()
