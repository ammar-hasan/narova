"""Tests for the background bed + spot sfx mix (narova_tts.pipeline.mix_audio).

Uses real ffmpeg/ffprobe with small synthetic wavs (anullsrc/sine) — no TTS
models involved. Skips cleanly when ffmpeg is absent."""
import shutil
import tempfile
import unittest
import wave
from pathlib import Path

from narova_tts.pipeline import RATE, mix_audio, probe, sh

FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")


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
            seg = samples[int(t0 * RATE):int(t1 * RATE)]
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


if __name__ == "__main__":
    unittest.main()
