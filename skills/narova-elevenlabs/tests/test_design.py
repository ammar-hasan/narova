from __future__ import annotations

import importlib.util
import io
import json
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock


DESIGN_PATH = Path(__file__).parents[1] / "tool" / "design.py"
SPEC = importlib.util.spec_from_file_location("narova_elevenlabs_design", DESIGN_PATH)
design = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(design)


class Args:
    """Minimal argument namespace matching main()'s parser fields."""

    def __init__(self, **overrides):
        base = {
            "description": "A warm grandmother, gentle and unhurried",
            "text": None, "out": "out/voice-design", "model": design.DEFAULT_MODEL,
            "seed": None, "language": None, "loudness": None,
            "guidance_scale": None, "enhance": False, "remix": None,
            "create": None, "name": None, "timeout": design.DEFAULT_TIMEOUT,
        }
        base.update(overrides)
        for key, value in base.items():
            setattr(self, key, value)


def preview_response(count=3):
    import base64
    return {
        "text": "preview text",
        "previews": [
            {
                "generated_voice_id": f"gen{i}",
                "audio_base_64": base64.b64encode(f"audio-{i}".encode()).decode(),
                "media_type": "audio/mpeg",
                "duration_secs": 12.3 + i,
                "language": "ur",
            }
            for i in range(1, count + 1)
        ],
    }


class TestDesignPayload(unittest.TestCase):
    def test_requires_description(self):
        with self.assertRaises(design.DesignError) as error:
            design.build_design_payload(Args(description="   "))
        self.assertEqual(error.exception.code, "invalid_request")

    def test_rejects_unknown_model(self):
        with self.assertRaises(design.DesignError) as error:
            design.build_design_payload(Args(model="eleven_monolingual_v1"))
        self.assertEqual(error.exception.code, "invalid_options")

    def test_preview_text_bounds_are_local(self):
        for text in ("short", "x" * 1001):
            with self.assertRaises(design.DesignError) as error:
                design.build_design_payload(Args(text=text))
            self.assertEqual(error.exception.code, "invalid_request")
            self.assertIn("characters", error.exception.message)

    def test_payload_carries_only_supplied_options(self):
        payload = design.build_design_payload(Args(seed=7, loudness=0.1, guidance_scale=5.0, enhance=True))
        self.assertEqual(payload["seed"], 7)
        self.assertEqual(payload["loudness"], 0.1)
        self.assertEqual(payload["guidance_scale"], 5.0)
        self.assertTrue(payload["should_enhance"])
        self.assertNotIn("text", payload)
        self.assertNotIn("previous_voice_id", payload)

    def test_remix_uses_previous_voice_id(self):
        payload = design.build_design_payload(Args(remix="JBFqnCBsd6RMkjVDRZzb"))
        self.assertEqual(payload["previous_voice_id"], "JBFqnCBsd6RMkjVDRZzb")

    def test_option_ranges(self):
        with self.assertRaises(design.DesignError):
            design.build_design_payload(Args(loudness=2.0))
        with self.assertRaises(design.DesignError):
            design.build_design_payload(Args(guidance_scale=99.0))


class TestWritePreviews(unittest.TestCase):
    def test_previews_index_and_parameters_are_written(self):
        import tempfile
        payload = design.build_design_payload(Args(seed=7))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "voice-design"
            rows = design.write_previews(preview_response(), payload, out)
            self.assertEqual(len(rows), 3)
            self.assertTrue((out / "preview-01-gen1.mp3").exists())
            self.assertTrue((out / "preview-03-gen3.mp3").exists())
            index = (out / "index.md").read_text(encoding="utf-8")
            self.assertIn("`gen2`", index)
            self.assertIn("--create", index)
            record = json.loads((out / "design.json").read_text(encoding="utf-8"))
            self.assertEqual(record["request"]["seed"], 7)
            self.assertEqual(len(record["previews"]), 3)
            self.assertEqual(record["previews"][0]["generated_voice_id"], "gen1")

    def test_empty_previews_fail_structured(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(design.DesignError) as error:
                design.write_previews({"previews": []}, {"voice_description": "x"}, Path(tmp))
            self.assertEqual(error.exception.code, "invalid_response")


class TestCreate(unittest.TestCase):
    def test_create_requires_name(self):
        with self.assertRaises(design.DesignError) as error:
            design.build_create_payload(Args(create="gen1", name=None))
        self.assertEqual(error.exception.code, "invalid_request")

    def test_create_payload_shape(self):
        payload = design.build_create_payload(Args(create=" gen2 ", name="Dadi", description="Warm grandmother"))
        self.assertEqual(payload, {
            "voice_name": "Dadi",
            "generated_voice_id": "gen2",
            "voice_description": "Warm grandmother",
        })


class TestMain(unittest.TestCase):
    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = design.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_missing_key_fails_cleanly(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            code, _, err = self.run_main(["a description"])
        self.assertEqual(code, 1)
        self.assertIn("missing_credentials", err)

    def test_short_text_fails_before_network(self):
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "k"}), \
                mock.patch.object(design, "request_json") as request_json:
            code, _, err = self.run_main(["a description", "--text", "too short"])
        self.assertEqual(code, 1)
        self.assertIn("invalid_request", err)
        request_json.assert_not_called()

    def test_design_writes_previews(self):
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "k"}), \
                mock.patch.object(design, "request_json", return_value=preview_response()), \
                __import__("tempfile").TemporaryDirectory() as tmp:
            out_dir = str(Path(tmp) / "vd")
            code, _, err = self.run_main(["a grandmother voice", "--out", out_dir, "--seed", "7"])
        self.assertEqual(code, 0)
        self.assertIn("index.md", err)
        self.assertIn("gen1", err)

    def test_create_prints_voice_id_and_config_fragment(self):
        created = {"voice_id": "PERMANENT123"}
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": "k"}), \
                mock.patch.object(design, "request_json", return_value=created) as request_json:
            code, out, _ = self.run_main(["--create", "gen2", "--name", "Dadi"])
        self.assertEqual(code, 0)
        self.assertIn("PERMANENT123", out)
        self.assertIn('speaker: "PERMANENT123"', out)
        self.assertIn("elevenlabs", out)
        request_json.assert_called_once()
        self.assertEqual(request_json.call_args[0][0], "/v1/text-to-voice")
        self.assertEqual(request_json.call_args[0][1]["generated_voice_id"], "gen2")

    def test_http_error_classification(self):
        import urllib.error
        error = design._http_error(urllib.error.HTTPError(
            "url", 401, "Unauthorized", hdrs=None, fp=io.BytesIO(b'{"detail":{"message":"bad key"}}')))
        self.assertEqual(error.code, "authentication")
        error = design._http_error(urllib.error.HTTPError(
            "url", 429, "Too Many Requests", hdrs=None, fp=io.BytesIO(b"{}")))
        self.assertEqual(error.code, "rate_limited")


if __name__ == "__main__":
    unittest.main()
