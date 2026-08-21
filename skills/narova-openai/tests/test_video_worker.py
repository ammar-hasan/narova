from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


WORKER_PATH = Path(__file__).parents[1] / "tool" / "video-worker.py"
SPEC = importlib.util.spec_from_file_location("narova_openai_video_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(worker)


class TestProtocolAndMapping(unittest.TestCase):
    def test_handshake_needs_no_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(worker.handle({"operation": "hello", "protocol": worker.PROTOCOL}), {
                "ok": True, "protocol": worker.PROTOCOL, "provider": "sora", "providerVersion": "1.0.0",
            })

    def test_request_defaults_and_supported_values(self):
        payload, timeout = worker.build_request({"prompt": "A paper boat at sea.", "options": {}})
        self.assertEqual(payload, {"model": "sora-2", "prompt": "A paper boat at sea.", "size": "1280x720", "seconds": "4"})
        self.assertEqual(timeout, 300.0)
        payload, _ = worker.build_request({"prompt": "x", "options": {"model": "sora-2-pro", "size": "1792x1024", "duration": 12}})
        self.assertEqual(payload["seconds"], "12")

    def test_invalid_options_are_rejected_before_network(self):
        for options in ({"duration": 5}, {"size": "640x480"}, {"model": "unknown"}, {"mystery": True}):
            with self.subTest(options=options), self.assertRaises(worker.ProviderError) as error:
                worker.build_request({"prompt": "x", "options": options})
            self.assertEqual(error.exception.code, "invalid_options")


class TestGeneration(unittest.TestCase):
    def test_submit_is_multipart_and_authenticated(self):
        seen = {}
        class Response:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self, _size=-1): return json.dumps({"id": "video_1", "status": "queued"}).encode()
        def opening(request, timeout):
            seen.update(request=request, timeout=timeout)
            return Response()
        with mock.patch.object(worker, "_open", opening):
            value = worker.submit_video("secret", {"model": "sora-2", "prompt": "x", "size": "1280x720", "seconds": "4"}, 9)
        self.assertEqual(value["id"], "video_1")
        self.assertEqual(seen["request"].full_url, "https://api.openai.com/v1/videos")
        self.assertEqual(seen["request"].get_header("Authorization"), "Bearer secret")
        self.assertIn("multipart/form-data", seen["request"].get_header("Content-type"))
        self.assertIn(b'name="seconds"', seen["request"].data)

    def test_generate_submits_once_polls_downloads_and_returns_safe_metadata(self):
        calls = {"submit": 0, "retrieve": 0, "download": 0}
        def submit(*_args):
            calls["submit"] += 1
            return {"id": "video_1", "status": "queued"}
        def retrieve(*_args):
            calls["retrieve"] += 1
            return {"id": "video_1", "status": "completed"}
        def download(_key, _video_id, output, _timeout):
            calls["download"] += 1
            output.write_bytes(b"video")
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {"OPENAI_API_KEY": "secret"}, clear=True), \
                mock.patch.object(worker, "submit_video", submit), mock.patch.object(worker, "retrieve_video", retrieve), \
                mock.patch.object(worker, "download_video", download), mock.patch.object(worker.time, "sleep"):
            output = Path(directory) / "stage.mp4"
            response = worker.handle({"id": "r1", "operation": "generate", "prompt": "x", "output": str(output), "options": {}})
            self.assertEqual(output.read_bytes(), b"video")
        self.assertEqual(calls, {"submit": 1, "retrieve": 1, "download": 1})
        self.assertEqual(response["metadata"]["model"], "sora-2")
        self.assertNotIn("secret", json.dumps(response))

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
