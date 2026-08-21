from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


WORKER_PATH = Path(__file__).parents[1] / "tool" / "worker.py"
SPEC = importlib.util.spec_from_file_location("narova_runway_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(worker)


class TestProtocolAndMapping(unittest.TestCase):
    def test_handshake_needs_no_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.handle({"operation": "hello", "protocol": worker.PROTOCOL}), {
                "ok": True, "protocol": worker.PROTOCOL, "provider": "runway", "providerVersion": "1.0.0",
            })

    def test_defaults_and_size_mapping(self):
        payload, timeout = worker.build_request({"prompt": "A miniature city.", "options": {}})
        self.assertEqual(payload, {"model": "gen4.5", "promptText": "A miniature city.", "ratio": "1280:720", "duration": 5})
        self.assertEqual(timeout, 600.0)
        payload, _ = worker.build_request({"prompt": "x", "options": {"size": "720x1280", "duration": 8}})
        self.assertEqual(payload["ratio"], "720:1280")

    def test_invalid_options_and_long_prompt_are_rejected(self):
        for options in ({"size": "bad"}, {"ratio": "16:9", "size": "1280x720"}, {"duration": 2.5}, {"mystery": 1}):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError) as error:
                worker.build_request({"prompt": "x", "options": options})
            self.assertEqual(error.exception.code, "invalid_options")
        with self.assertRaises(worker.ProviderError) as error:
            worker.build_request({"prompt": "x" * 1001, "options": {}})
        self.assertEqual(error.exception.code, "invalid_request")


class TestGeneration(unittest.TestCase):
    def test_submit_uses_endpoint_version_auth_and_json(self):
        seen = {}
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self, _size=-1): return b'{"id":"task_1"}'
        def opening(request, timeout):
            seen.update(request=request, timeout=timeout)
            return Response()
        payload = {"model": "gen4.5", "promptText": "x", "ratio": "1280:720", "duration": 5}
        with mock.patch.object(worker, "_open", opening):
            value = worker.submit_video("secret", payload, 9)
        request = seen["request"]
        self.assertEqual(value["id"], "task_1")
        self.assertEqual(request.full_url, "https://api.dev.runwayml.com/v1/text_to_video")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(request.get_header("X-runway-version"), "2024-11-06")
        self.assertEqual(json.loads(request.data), payload)

    def test_generate_submits_once_polls_downloads_and_returns_safe_metadata(self):
        calls = {"submit": 0, "retrieve": 0, "download": 0}
        def submit(*_args):
            calls["submit"] += 1
            return {"id": "task_1"}
        def retrieve(*_args):
            calls["retrieve"] += 1
            return {"id": "task_1", "status": "SUCCEEDED", "output": ["https://cdn.example/video.mp4"]}
        def download(_url, output, _timeout):
            calls["download"] += 1
            output.write_bytes(b"video")
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"RUNWAYML_API_SECRET": "secret"}, clear=True), \
                mock.patch.object(worker, "submit_video", submit), mock.patch.object(worker, "retrieve_task", retrieve), \
                mock.patch.object(worker, "download_video", download), mock.patch.object(worker.time, "sleep"):
            output = Path(directory) / "stage.mp4"
            response = worker.handle({"id": "r1", "operation": "generate", "prompt": "x", "output": str(output), "options": {}})
            self.assertEqual(output.read_bytes(), b"video")
        self.assertEqual(calls, {"submit": 1, "retrieve": 1, "download": 1})
        self.assertEqual(response["metadata"]["params"]["ratio"], "1280:720")
        self.assertNotIn("secret", json.dumps(response))

    def test_failure_does_not_download_or_resubmit(self):
        calls = {"submit": 0, "download": 0}
        def submit(*_args):
            calls["submit"] += 1
            return {"id": "task_1", "status": "FAILED", "failure": "moderated"}
        def download(*_args): calls["download"] += 1
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"RUNWAYML_API_SECRET": "secret"}, clear=True), \
                mock.patch.object(worker, "submit_video", submit), mock.patch.object(worker, "download_video", download):
            with self.assertRaises(worker.ProviderError) as error:
                worker.generate({"prompt": "x", "output": str(Path(directory) / "stage.mp4"), "options": {}})
        self.assertEqual(error.exception.code, "generation_failed")
        self.assertEqual(calls, {"submit": 1, "download": 0})

    def test_missing_key_and_relative_output_are_structured(self):
        with mock.patch.dict(os.environ, {}, clear=True), tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(worker.ProviderError) as error:
                worker.generate({"prompt": "x", "output": str(Path(directory) / "out.mp4"), "options": {}})
            self.assertEqual(error.exception.code, "missing_environment")
        with self.assertRaises(worker.ProviderError) as error:
            worker.validate_output("relative.mp4")
        self.assertEqual(error.exception.code, "invalid_output")


if __name__ == "__main__":
    unittest.main()
