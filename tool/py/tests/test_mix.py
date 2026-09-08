"""Tests for the background bed + spot sfx mix (narova_tts.pipeline.mix_audio).

Uses real ffmpeg/ffprobe with small synthetic wavs (anullsrc/sine) — no TTS
models involved. Skips cleanly when ffmpeg is absent."""
import shutil
import json
import tempfile
import unittest
import wave
import struct
from unittest.mock import patch
from pathlib import Path

from narova_tts.pipeline import RATE, MIX_RATE, mix_audio, probe, sh, scene_starts

FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")


class TestSharedAnchors(unittest.TestCase):
    def test_shared_measured_and_external_anchor_contract(self):
        fixtures = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "audio-anchors.json"
        for case in json.loads(fixtures.read_text()):
            starts = scene_starts(case["scenes"], case["timings"])
            self.assertEqual(starts, case["starts"])
            for effect in case["effects"]:
                at = starts[effect["scene"]] if "scene" in effect else 0
                self.assertEqual(at + effect["at"], effect["expected"])


def sine(path: Path, freq: int, dur: float) -> None:
    sh("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
       "-i", f"sine=frequency={freq}:duration={dur}", "-ar", str(RATE), "-ac", "1",
       "-c:a", "pcm_s16le", str(path))


def rms(path: Path) -> float:
    with wave.open(str(path), "rb") as wf:
        frames = wf.readframes(wf.getnframes())
    import struct
    samples = struct.unpack(f"<{len(frames)//2}h", frames)
    return (sum(s * s for s in samples) / max(1, len(samples))) ** 0.5


@unittest.skipUnless(FFMPEG, "ffmpeg/ffprobe not on PATH")
class TestMixAudio(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.audio = self.tmp / "audio"
        self.audio.mkdir()
        # 5s of near-silence stands in for narration full.wav
        sh("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
           "-i", f"anullsrc=r={RATE}:cl=mono", "-t", "5",
           "-c:a", "pcm_s16le", str(self.audio / "full.wav"))
        sine(self.tmp / "bed.wav", 440, 10)   # longer than narration: must trim
        sine(self.tmp / "hit.wav", 880, 1)
        self.scenes = [{"n": 1, "id": "intro"}, {"n": 2, "id": "main"}]
        self.timings = {"intro": {"dur": 2.0}, "main": {"dur": 3.0}}

    def tearDown(self):
        self._tmp.cleanup()

    def mix(self, config):
        mix_audio(self.scenes, self.timings, config, self.audio)
        return self.audio / "mix.wav"

    def test_bed_trimmed_to_narration_length(self):
        out = self.mix({"bed": {"file": str(self.tmp / "bed.wav"),
                                  "volume": 0.5, "fadeIn": 0.1, "fadeOut": 0.5}})
        self.assertTrue(out.exists())
        self.assertAlmostEqual(probe(out), probe(self.audio / "full.wav"), delta=0.05)
        self.assertGreater(rms(out), 100)  # the bed is actually in there

    def test_scene_anchored_sfx_delays_by_scene_start(self):
        # scene "main" starts at 2.0s; at=1.0 -> sfx at 3.0s global. The mix
        # must be quiet at 0.5s and loud at 3.2s.
        out = self.mix({"sfx": [{"file": str(self.tmp / "hit.wav"),
                                 "scene": "main", "at": 1.0, "volume": 1.0}]})
        with wave.open(str(out), "rb") as wf:
            frames = wf.readframes(wf.getnframes())
        import struct
        samples = struct.unpack(f"<{len(frames)//2}h", frames)

        def window_rms(t0, t1):
            seg = samples[int(t0 * MIX_RATE)*2:int(t1 * MIX_RATE)*2]
            return (sum(s * s for s in seg) / len(seg)) ** 0.5

        self.assertLess(window_rms(0.3, 0.8), 10)        # before the sfx: silence
        self.assertGreater(window_rms(3.2, 3.7), 100)    # inside the sfx: tone
        self.assertAlmostEqual(probe(out), 5.0, delta=0.05)

    def test_global_sfx_uses_timeline_time(self):
        out = self.mix({"sfx": [{"file": str(self.tmp / "hit.wav"),
                                 "scene": None, "at": 0.0, "volume": 1.0}]})
        self.assertTrue(out.exists())
        self.assertAlmostEqual(probe(out), 5.0, delta=0.05)

    def test_no_bed_no_sfx_deletes_stale_mix(self):
        stale = self.audio / "mix.wav"
        stale.write_bytes(b"stale")
        mix_audio(self.scenes, self.timings, {}, self.audio)
        self.assertFalse(stale.exists())

    def test_missing_bed_file_raises_naming_it(self):
        with self.assertRaisesRegex(ValueError, "bed.*nope/bed.wav"):
            self.mix({"bed": {"file": "/nope/bed.wav", "volume": 0.14}})

    def test_missing_sfx_file_raises_naming_it(self):
        with self.assertRaisesRegex(ValueError, r"sfx\[0\].*nope/hit.wav"):
            self.mix({"sfx": [{"file": "/nope/hit.wav", "scene": None, "at": 0}]})

    def test_unknown_scene_anchor_raises(self):
        with self.assertRaisesRegex(ValueError, "not a scene id"):
            self.mix({"sfx": [{"file": str(self.tmp / "hit.wav"),
                               "scene": "nope", "at": 0}]})

    def test_full_wav_untouched(self):
        before = (self.audio / "full.wav").read_bytes()
        self.mix({"bed": {"file": str(self.tmp / "bed.wav"), "volume": 0.5}})
        self.assertEqual((self.audio / "full.wav").read_bytes(), before)

    def test_stereo_bed_and_anchored_effect_survive_mix_and_aac(self):
        stereo = self.tmp / "stereo.wav"
        sh("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
           r"aevalsrc=0.1*sin(2*PI*440*t)*between(t\,0.1\,0.4)|0.1*sin(2*PI*880*t)*between(t\,0.6\,0.9):s=48000:d=1",
           "-c:a", "pcm_s16le", str(stereo))
        for voiced in [False, True]:
            if voiced:
                sine(self.audio / "full.wav", 220, 5)
            original = (self.audio / "full.wav").read_bytes()
            for layer in ["bed", "sfx"]:
                with self.subTest(voiced=voiced, layer=layer):
                    config = ({"bed": {"file": str(stereo), "volume": 1, "fadeIn": 0, "fadeOut": 0}}
                              if layer == "bed" else
                              {"sfx": [{"file": str(stereo), "scene": "main", "at": 1, "volume": 1}]})
                    out = self.mix(config)
                    with wave.open(str(out), "rb") as wf:
                        self.assertEqual((wf.getframerate(), wf.getnchannels()), (48000, 2))
                    encoded = self.tmp / "encoded.m4a"
                    sh("ffmpeg", "-y", "-loglevel", "error", "-i", str(out), "-c:a", "aac", "-b:a", "192k", str(encoded))
                    decoded = self.tmp / "decoded.wav"
                    sh("ffmpeg", "-y", "-loglevel", "error", "-i", str(encoded), "-c:a", "pcm_s16le", str(decoded))
                    for audio in [out, decoded]:
                        with wave.open(str(audio), "rb") as wf:
                            samples = struct.unpack("<%dh" % (wf.getnframes()*2), wf.readframes(wf.getnframes()))
                        offset = 0 if layer == "bed" else 3
                        for start, active in [(0.2, 0), (0.7, 1)]:
                            values = samples[int((offset+start)*48000)*2:int((offset+start+0.1)*48000)*2]
                            energy = [sum(v*v for v in values[ch::2])/len(values[ch::2]) for ch in [0,1]]
                            self.assertGreater(energy[active], energy[1-active] + 1000000)
                    self.assertEqual((self.audio / "full.wav").read_bytes(), original)

    def test_mono_source_is_centered_without_changing_canonical_input(self):
        sine(self.audio / "full.wav", 330, 5)
        original = (self.audio / "full.wav").read_bytes()
        out = self.mix({"sfx": [{"file": str(self.tmp / "hit.wav"), "at": 3}]})
        with wave.open(str(out), "rb") as wf:
            samples = struct.unpack("<%dh" % (wf.getnframes()*2), wf.readframes(wf.getnframes()))
        self.assertEqual(samples[::2], samples[1::2])
        with wave.open(str(self.audio / "full.wav"), "rb") as wf:
            raw = struct.unpack("<%dh" % wf.getnframes(), wf.readframes(wf.getnframes()))
        src_rms = (sum(v*v for v in raw[RATE:2*RATE])/RATE)**0.5
        left = samples[48000*2:96000*2:2]
        dst_rms = (sum(v*v for v in left)/len(left))**0.5
        # Existing limiter makeup is 1/0.891. Mono expansion adds no attenuation.
        self.assertAlmostEqual(dst_rms/src_rms, 1/0.891, delta=0.015)
        self.assertEqual((self.audio / "full.wav").read_bytes(), original)
        with wave.open(str(self.audio / "full.wav"), "rb") as wf:
            self.assertEqual((wf.getframerate(), wf.getnchannels()), (RATE, 1))

    def test_failed_mix_or_duration_check_cannot_leave_stale_or_partial_mix(self):
        config = {"bed": {"file": str(self.tmp / "bed.wav")}}
        for failure in ["encode", "duration"]:
            (self.audio / "mix.wav").write_bytes(b"obsolete")
            def failed_write(*args):
                Path(args[-1]).write_bytes(b"partial")
                raise RuntimeError("encoding failed")
            with self.subTest(failure=failure):
                ctx = (patch("narova_tts.pipeline.sh", side_effect=failed_write) if failure == "encode" else
                       patch("narova_tts.pipeline.probe", side_effect=[5, 5.1]))
                with ctx, self.assertRaises((RuntimeError, AssertionError)):
                    self.mix(config)
                self.assertFalse((self.audio / "mix.wav").exists())
                self.assertFalse((self.audio / "mix.pending.wav").exists())


if __name__ == "__main__":
    unittest.main()
