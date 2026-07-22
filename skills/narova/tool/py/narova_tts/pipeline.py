"""narration.json -> per-scene wav/mp3 + timings.json.

This is the Python half of narova: TTS + timing only. Node owns render,
capture, assemble, serve.

The hard-won fix (LEARNINGS #1): after building each scene's final, post-loudnorm
wav we MEASURE its real duration and RESCALE that scene's word/turn timestamps by
`actual / computed`. loudnorm compresses each scene ~2.9%; without the rescale the
captions drift behind the voice. See `rescale_timings()` and the final assertion.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .backends import build_backends

RATE = 22050          # output sample rate (Piper-native; XTTS is resampled to it)
FADE = 0.012          # ~12ms fade at each sentence edge, or you get clicks (LEARNINGS #4)

# Sentence-level synthesis cache (iteration consistency): a processed sentence
# wav is kept keyed by backend+speaker+text+tempo, so re-running synth after an
# edit re-synthesizes ONLY the changed sentences. Unchanged scenes come out
# byte-identical — revisions never surprise the user. Outside the project on
# purpose (out/ is a build folder; the cache must survive it being deleted).
CACHE_DIR = Path(
    os.environ.get("NAROVA_CACHE")
    or Path(os.environ.get("NAROVA_HOME", Path.home() / ".narova")) / "cache" / "sentences"
)

# Fallback timing if the config omits a key (seconds). The JS resolver
# (src/schema.js DEFAULT_TIMING) is authoritative and always sends the gaps, so
# these only apply when narova_tts is run standalone — keep them mirrored to it.
# tempo is the exception: JS defaults it to null on purpose so this value wins.
TIMING_DEFAULTS = {
    "gapSentence": 0.24,
    "gapTurn": 0.44,
    "lead": 0.16,
    "tail": 0.58,
    "tempo": 1.18,
}


# ---- ffmpeg / ffprobe helpers -------------------------------------------------

def sh(*args: str) -> None:
    subprocess.run(list(args), check=True)


def probe(path: Path) -> float:
    """Measured media duration in seconds. Long-form -of flag (LEARNINGS #19)."""
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        text=True,
    )
    return float(out.strip())


def make_silence(dur: float, out: Path) -> None:
    sh("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
       "-i", f"anullsrc=r={RATE}:cl=mono", "-t", f"{dur}",
       "-c:a", "pcm_s16le", "-sample_fmt", "s16", str(out))


def concat(pieces: list[Path], out: Path, tmp: Path, norm: bool = False) -> None:
    """Concat wav pieces. With norm=True apply loudnorm for broadcast headroom
    and consistent loudness across voices (LEARNINGS #5) — this changes duration,
    which is exactly why the per-scene rescale is required."""
    lst = tmp / "_list.txt"
    # concat-demuxer quoting: a ' in the path (e.g. "Ammar's Mac") must be escaped
    esc = lambda p: str(p).replace("'", "'\\''")
    lst.write_text("".join(f"file '{esc(p)}'\n" for p in pieces))
    af = ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] if norm else []
    sh("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
       *af, "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(out))


def to_mp3(wav: Path, mp3: Path) -> None:
    sh("ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-b:a", "72k", str(mp3))


def sentences(text: str) -> list[str]:
    return [p for p in re.split(r"(?<=[.!?])\s+", text.strip()) if p]


# ---- timing rescale (LEARNINGS #1) -------------------------------------------

def rescale_timings(t: dict[str, Any], actual: float) -> dict[str, Any]:
    """Scale a scene's word/turn timings to the MEASURED audio duration. loudnorm
    compresses each scene uniformly, so a single linear factor is exact."""
    cur = t.get("dur", 0)
    if cur > 0 and actual > 0:
        f = actual / cur
        for w in t["words"]:
            w["t0"] = round(w["t0"] * f, 3)
            w["t1"] = round(w["t1"] * f, 3)
        t["turns"] = [round(x * f, 3) for x in t["turns"]]
        t["dur"] = round(actual, 3)
    return t


# ---- sentence synthesis (raw voice -> tempo + fades + resample) --------------

def sentence_cache_key(kind: str, speaker: str, text: str, tempo: float) -> str:
    """Stable identity of one synthesized sentence. Bump v1 when the processing
    chain (rate/fades/atempo) changes so old entries are naturally abandoned."""
    h = hashlib.sha1()
    h.update(f"v1|{kind}|{speaker}|{tempo}|{RATE}|{FADE}|{text}".encode("utf-8"))
    return h.hexdigest()


def voice_cache_speaker(v: dict, who: str) -> str:
    """The speaker fragment of a voice's cache identity: its speaker plus (for
    qwen) the delivery `instruct`, so a changed direction re-synthesizes
    instead of serving stale audio."""
    spk = v.get("speaker", who)
    return f"{spk}|{v['instruct']}" if v.get("instruct") else spk


def synth_sentence(backend, who: str, text: str, tmp: Path, out: Path, tempo: float,
                   cache_key: str | None = None) -> float:
    """Synthesize one sentence, speed via atempo (pitch-preserving; NEVER the XTTS
    speed param, LEARNINGS #9), then fade the edges. Returns the MEASURED duration
    of the processed clip — word timing is distributed across this real value.
    With cache_key, a hit skips TTS + processing entirely (byte-identical copy)."""
    cached = CACHE_DIR / f"{cache_key}.wav" if cache_key else None
    if cached is not None and cached.exists():
        shutil.copyfile(cached, out)
        return probe(out)
    raw = tmp / "_raw.wav"
    backend.synthesize(who, text, raw)
    d = probe(raw) / tempo                 # duration on the post-tempo timeline
    fo = max(0.0, d - FADE)
    sh("ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
       "-af", f"atempo={tempo},afade=t=in:st=0:d={FADE},afade=t=out:st={fo}:d={FADE}",
       "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(out))
    dur = probe(out)
    if cached is not None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(out, cached)
    return dur


# ---- main pipeline ------------------------------------------------------------

def run(narration_path: Path, config_path: Path, out_dir: Path,
        default_backend: str = "piper", reuse: bool = False) -> dict[str, Any]:
    scenes = json.loads(narration_path.read_text())
    config = json.loads(config_path.read_text())
    # The JS resolver serializes unset keys as null (e.g. tempo) — a plain merge
    # would let None clobber the defaults and crash float() below.
    timing = {**TIMING_DEFAULTS,
              **{k: v for k, v in config.get("timing", {}).items() if v is not None}}

    audio_dir = out_dir / "audio"
    tmp = out_dir / ".tmp"
    audio_dir.mkdir(parents=True, exist_ok=True)
    tmp.mkdir(parents=True, exist_ok=True)
    timings_path = out_dir / "timings.json"

    if reuse and timings_path.exists():
        # Skip synth, but STILL rescale each scene to its existing (post-loudnorm) wav.
        print("reuse — skipping synth, rescaling timings to existing audio", flush=True)
        timings = json.loads(timings_path.read_text())
        for s in scenes:
            wav = audio_dir / f"{s['n']:02d}.wav"
            rescale_timings(timings[s["id"]], probe(wav))
    else:
        timings = _synthesize(scenes, config, timing, audio_dir, tmp, default_backend)

    timings_path.write_text(json.dumps(timings))

    total = _verify_total(scenes, timings, audio_dir, tmp)
    return {"totalDuration": round(total, 3), "scenes": len(scenes), "out": str(out_dir)}


def _synthesize(scenes, config, timing, audio_dir, tmp, default_backend) -> dict[str, Any]:
    voices = config.get("voices", {})
    router = build_backends(voices, default_backend)

    gap_sentence = timing["gapSentence"]
    gap_turn = timing["gapTurn"]
    lead = timing["lead"]
    tail = timing["tail"]
    tempo = float(timing["tempo"])

    # Cache identity per voice: backend kind + speaker name + (below) sentence text.
    voice_kind = {who: v.get("backend", default_backend) for who, v in voices.items()}
    voice_speaker = {who: voice_cache_speaker(v, who) for who, v in voices.items()}

    sil = {}
    for name, d in (("s", gap_sentence), ("t", gap_turn), ("lead", lead), ("tail", tail)):
        sil[name] = tmp / f"sil_{name}.wav"
        make_silence(d, sil[name])

    timings: dict[str, Any] = {}
    for s in scenes:
        nn = f"{s['n']:02d}"
        pieces = [sil["lead"]]
        clock = lead
        words, turns = [], []
        si = 0
        for ti, turn in enumerate(s["segments"]):
            who = turn["who"]
            if who not in router:
                raise ValueError(f"scene {nn}: no voice configured for who={who!r}")
            if ti > 0:
                pieces.append(sil["t"])
                clock += gap_turn
            turns.append(round(clock, 3))
            for k, sent in enumerate(sentences(turn["text"])):
                if k > 0:
                    pieces.append(sil["s"])
                    clock += gap_sentence
                w = tmp / f"{nn}_{si:03d}.wav"
                key = sentence_cache_key(voice_kind.get(who, default_backend),
                                         voice_speaker.get(who, who), sent, tempo)
                d = synth_sentence(router[who], who, sent, tmp, w, tempo, cache_key=key)
                pieces.append(w)
                # distribute words across the sentence's real duration, weighted by length
                toks = sent.split()
                wts = [len(tok) + 1 for tok in toks]
                tot = sum(wts)
                wt = clock
                for tok, wg in zip(toks, wts):
                    wd = d * (wg / tot)
                    words.append({"w": tok, "t0": round(wt, 3), "t1": round(wt + wd, 3),
                                  "who": who, "si": si})
                    wt += wd
                clock += d
                si += 1
        pieces.append(sil["tail"])
        clock += tail

        raw = tmp / f"scene_{nn}.wav"
        wav = audio_dir / f"{nn}.wav"
        concat(pieces, raw, tmp)                       # pre-loudnorm splice
        concat([raw], wav, tmp, norm=True)             # loudnorm -> final wav
        to_mp3(wav, audio_dir / f"{nn}.mp3")

        timings[s["id"]] = {"dur": round(clock, 3), "turns": turns, "words": words}
        rescale_timings(timings[s["id"]], probe(wav))  # sync timeline to actual audio
        print(f"scene {nn} [{s['id']:>9}] {timings[s['id']]['dur']:5.1f}s  "
              f"turns={''.join(t['who'] for t in s['segments'])}", flush=True)
    return timings


def _verify_total(scenes, timings, audio_dir, tmp) -> float:
    """Assert sum(scene.dur) == duration(concatenated audio) within a few ms
    (the caption-sync guarantee, LEARNINGS #1 / #14). The concatenated track is
    kept as audio/full.wav — it is the narration track of the composition."""
    sum_dur = sum(timings[s["id"]]["dur"] for s in scenes)
    full = audio_dir / "full.wav"
    concat([audio_dir / f"{s['n']:02d}.wav" for s in scenes], full, tmp)
    measured = probe(full)
    drift = abs(measured - sum_dur)
    tol = 0.005 * len(scenes) + 0.01     # rounding accumulates ~0.5ms/scene
    assert drift < tol, (
        f"timing drift {drift*1000:.1f}ms exceeds {tol*1000:.1f}ms: "
        f"sum(dur)={sum_dur:.3f} vs concat audio={measured:.3f}"
    )
    return measured
