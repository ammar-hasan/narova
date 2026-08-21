"""Tests for verified Piper voice acquisition (NAR-018-073) and the
corrupt-model load diagnostic (NAR-018-074).

A local stub HTTP server plays the catalog source — no real network.

Run: PYTHONPATH=py python3 -m unittest discover -s py/tests -v"""
import contextlib
import http.server
import io
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest import mock

from narova_tts import __main__ as cli
from narova_tts import backends
from narova_tts.backends import PiperBackend, download_piper_voice

VOICE = "en_US-lessac-medium"
MODEL = b"fake-onnx-protobuf-bytes" * 500
CONFIG = b'{"audio": {"sample_rate": 22050}}'


class StubCatalog(http.server.BaseHTTPRequestHandler):
    """Routes: {".onnx" | ".onnx.json": [(body, declared_length_or_None), ...]}.
    Each request advances its route's script (the last entry repeats). A body
    shorter than the declared length models a truncated download; a None
    declared length omits the Content-Length header entirely."""

    routes: dict = {}
    counts: dict = {}

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        key = ".onnx.json" if path.endswith(".onnx.json") else ".onnx"
        script = type(self).routes.get(key)
        if not script:
            self.send_error(404)
            return
        n = type(self).counts.get(key, 0)
        type(self).counts[key] = n + 1
        body, declared = script[min(n, len(script) - 1)]
        self.send_response(200)
        if declared is not None:
            self.send_header("Content-Length", str(declared))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def fake_piper(load):
    """A stub `piper` module so _load tests need no piper-tts install."""
    module = types.ModuleType("piper")
    module.PiperVoice = types.SimpleNamespace(load=load)
    return mock.patch.dict(sys.modules, {"piper": module})


class VoiceAcquisitionTest(unittest.TestCase):
    def setUp(self):
        StubCatalog.routes = {}
        StubCatalog.counts = {}
        # HTTP/1.0 (the default) closes each connection, so a short body ends
        # at EOF — exactly how a truncated download presents to urlopen.
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), StubCatalog)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.server.server_close)
        port = self.server.server_address[1]
        patcher = mock.patch.object(
            backends, "PIPER_URL_FORMAT",
            f"http://127.0.0.1:{port}/{{lang_family}}/{{lang_code}}/{{voice_name}}/"
            "{voice_quality}/{lang_code}-{voice_name}-{voice_quality}{extension}"
            "?download=true")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data_dir = Path(self.tmp.name)
        self.model_path = self.data_dir / f"{VOICE}.onnx"
        self.config_path = self.data_dir / f"{VOICE}.onnx.json"

    def assert_fail_closed(self, ctx):
        message = str(ctx.exception)
        self.assertIn(str(self.model_path), message)
        self.assertIn("delete", message)
        self.assertIn("re-run", message)
        self.assertFalse(self.model_path.exists())
        self.assertFalse(self.config_path.exists())
        self.assertEqual(list(self.data_dir.glob("*.part")), [])

    def test_short_body_retried_once_then_complete(self):
        StubCatalog.routes = {
            ".onnx": [(MODEL[:100], len(MODEL)), (MODEL, len(MODEL))],
            ".onnx.json": [(CONFIG, len(CONFIG))],
        }
        model = download_piper_voice(VOICE, self.data_dir)
        self.assertEqual(model, self.model_path)
        self.assertEqual(model.read_bytes(), MODEL)
        self.assertEqual(self.config_path.read_bytes(), CONFIG)
        self.assertEqual(StubCatalog.counts[".onnx"], 2)
        self.assertEqual(StubCatalog.counts[".onnx.json"], 1)
        self.assertEqual(list(self.data_dir.glob("*.part")), [])

    def test_persistent_short_body_fails_closed(self):
        StubCatalog.routes = {
            ".onnx": [(MODEL[:100], len(MODEL))],
            ".onnx.json": [(CONFIG, len(CONFIG))],
        }
        with self.assertRaises(RuntimeError) as ctx:
            download_piper_voice(VOICE, self.data_dir)
        self.assert_fail_closed(ctx)
        self.assertEqual(StubCatalog.counts[".onnx"], 2)  # one retry, then stop

    def test_undeclared_length_fails_closed(self):
        StubCatalog.routes = {
            ".onnx": [(MODEL, None)],
            ".onnx.json": [(CONFIG, len(CONFIG))],
        }
        with self.assertRaises(RuntimeError) as ctx:
            download_piper_voice(VOICE, self.data_dir)
        self.assert_fail_closed(ctx)
        self.assertIn("content length", str(ctx.exception))

    def test_short_sidecar_reacquires_pair(self):
        StubCatalog.routes = {
            ".onnx": [(MODEL, len(MODEL))],
            ".onnx.json": [(CONFIG[:5], len(CONFIG)), (CONFIG, len(CONFIG))],
        }
        model = download_piper_voice(VOICE, self.data_dir)
        self.assertEqual(model.read_bytes(), MODEL)
        self.assertEqual(self.config_path.read_bytes(), CONFIG)
        # The pair is one unit: the model was fetched again alongside the sidecar.
        self.assertEqual(StubCatalog.counts[".onnx"], 2)
        self.assertEqual(StubCatalog.counts[".onnx.json"], 2)

    def test_missing_sidecar_reacquires_pair(self):
        backend = PiperBackend.__new__(PiperBackend)
        backend._data_dir = self.data_dir
        self.model_path.write_bytes(MODEL)  # model present, sidecar missing
        StubCatalog.routes = {
            ".onnx": [(MODEL, len(MODEL))],
            ".onnx.json": [(CONFIG, len(CONFIG))],
        }
        path = backend._ensure_voice(VOICE)
        self.assertEqual(path, self.model_path)
        self.assertEqual(self.config_path.read_bytes(), CONFIG)
        self.assertEqual(StubCatalog.counts[".onnx"], 1)
        self.assertEqual(StubCatalog.counts[".onnx.json"], 1)

    def test_existing_pair_skips_download(self):
        backend = PiperBackend.__new__(PiperBackend)
        backend._data_dir = self.data_dir
        self.model_path.write_bytes(MODEL)
        self.config_path.write_bytes(CONFIG)
        path = backend._ensure_voice(VOICE)
        self.assertEqual(path, self.model_path)
        self.assertEqual(StubCatalog.counts, {})  # no requests at all

    def test_load_parse_failure_diagnostic(self):
        backend = PiperBackend.__new__(PiperBackend)
        self.model_path.write_bytes(b"truncated")
        original = RuntimeError("InvalidProtobuf: unexpected end of stream")
        with fake_piper(mock.Mock(side_effect=original)):
            with self.assertRaises(RuntimeError) as ctx:
                backend._load(self.model_path)
        message = str(ctx.exception)
        self.assertIn(str(self.model_path), message)
        self.assertIn("corrupt or an incomplete download", message)
        self.assertIn("delete", message)
        self.assertIn("re-run", message)
        self.assertIs(ctx.exception.__cause__, original)

    def test_healthy_load_no_new_output(self):
        backend = PiperBackend.__new__(PiperBackend)
        sentinel = object()
        with fake_piper(lambda path: sentinel):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                voice = backend._load(self.model_path)
        self.assertIs(voice, sentinel)
        self.assertEqual(out.getvalue(), "")

    def test_voices_get_shares_verified_download(self):
        StubCatalog.routes = {
            ".onnx": [(MODEL, len(MODEL))],
            ".onnx.json": [(CONFIG, len(CONFIG))],
        }
        with mock.patch.dict(os.environ, {"NAROVA_PIPER_DIR": str(self.data_dir)}):
            rc = cli._voices(["get", VOICE, "--backend", "piper"])
        self.assertEqual(rc, 0)
        self.assertEqual(self.model_path.read_bytes(), MODEL)
        self.assertEqual(self.config_path.read_bytes(), CONFIG)


if __name__ == "__main__":
    unittest.main()
