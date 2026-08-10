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

from .align import align_scenes
from .backends import BUILTIN_BACKENDS, build_backends, close_backends

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


# ---- background bed + spot sfx (mixed AFTER loudnorm; never re-loudnorm'd) --------

def scene_starts(scenes, timings) -> dict[str, float]:
    """Global start time of each scene: cumulative durs in narration order."""
    starts, clock = {}, 0.0
    for s in scenes:
        starts[s["id"]] = round(clock, 3)
        clock += timings[s["id"]]["dur"]
    return starts


def mix_audio(scenes, timings, config, audio_dir: Path) -> None:
    """Overlay the background bed + spot sfx onto full.wav -> audio/mix.wav, in
    one ffmpeg filter_complex pass. The bed is looped/trimmed to the exact
    narration length with `volume` gain and afade in/out; each sfx is adelay'd
    to its global time (scene-anchored = scene start + `at`). loudnorm is NOT
    re-applied (narration is already loudnorm'd): amix normalize=0 keeps the
    narration level and an alimiter catches bed+sfx clipping instead.
    With neither bed nor sfx configured, any stale mix.wav is deleted so
    compose never picks up an old one."""
    full = audio_dir / "full.wav"
    mix = audio_dir / "mix.wav"
    bed = config.get("bed") or config.get("music")  # config.bed, fallback legacy config.music
    sfx = config.get("sfx") or []
    if not bed and not sfx:
        mix.unlink(missing_ok=True)
        return

    total = probe(full)
    starts = scene_starts(scenes, timings)

    def check_file(p, what: str) -> None:
        if not Path(p).is_file():
            raise ValueError(f"{what}: file not found or unreadable: {p}")

    inputs: list[list[str]] = []        # ffmpeg argv fragments per -i
    chains: list[str] = []              # per-source filter chains
    labels: list[str] = []              # amix input labels, after [0:a]

    if bed:
        check_file(bed["file"], "config.bed.file")
        idx = len(labels) + 1
        inputs.append(["-stream_loop", "-1", "-i", str(bed["file"])])  # loop to length
        fin = bed.get("fadeIn", 0.5)
        fout = bed.get("fadeOut", 1.5)
        chain = (f"[{idx}:a]aresample={RATE},aformat=channel_layouts=mono,"
                 f"atrim=0:{total:.3f},asetpts=PTS-STARTPTS,volume={bed.get('volume', 0.14)}")
        if fin > 0:
            chain += f",afade=t=in:st=0:d={fin}"
        if fout > 0:
            chain += f",afade=t=out:st={max(0.0, total - fout):.3f}:d={fout}"
        chains.append(chain + "[mus]")
        labels.append("mus")

    for i, e in enumerate(sfx):
        check_file(e["file"], f"config.sfx[{i}].file")
        idx = len(labels) + 1
        inputs.append(["-i", str(e["file"])])
        at = e.get("at", 0)
        sc = e.get("scene")
        if sc is not None:
            if sc not in starts:
                raise ValueError(f"config.sfx[{i}].scene: {sc!r} is not a scene id")
            at = starts[sc] + at
        chains.append(f"[{idx}:a]aresample={RATE},aformat=channel_layouts=mono,"
                      f"volume={e.get('volume', 0.8)},adelay={round(at * 1000)}[fx{i}]")
        labels.append(f"fx{i}")

    n = 1 + len(labels)
    fc = ";".join(chains + [
        f"[0:a]{''.join(f'[{l}]' for l in labels)}"
        f"amix=inputs={n}:duration=first:normalize=0:dropout_transition=0,"
        f"aresample={RATE},aformat=channel_layouts=mono,alimiter=limit=0.891[mix]"
    ])
    args = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(full)]
    for frag in inputs:
        args += frag
    sh(*args, "-filter_complex", fc, "-map", "[mix]",
       "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(mix))
    drift = abs(probe(mix) - total)
    assert drift < 0.05, f"mix duration {probe(mix):.3f}s drifts {drift*1000:.0f}ms from narration {total:.3f}s"
    what = ([f"bed={Path(bed['file']).name}@{bed.get('volume', 0.14)}"] if bed else []) \
        + ([f"sfx={len(sfx)}"] if sfx else [])
    print(f"mix   {total:5.1f}s  {' '.join(what)} -> audio/mix.wav", flush=True)


_SENTENCE_RE = re.compile(r"(?<=[.!?۔؟])\s+")


def sentences(text: str) -> list[str]:
    return [p for p in _SENTENCE_RE.split(text.strip()) if p]


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

def sentence_cache_key(kind: str, speaker: str, text: str, tempo: float, lang: str | None = None) -> str:
    """Stable identity of one synthesized sentence. Bump v1 when the processing
    chain (rate/fades/atempo) changes so old entries are naturally abandoned."""
    h = hashlib.sha1()
    parts = f"v1|{kind}|{speaker}|{tempo}|{RATE}|{FADE}|{text}"
    if lang:
        parts += f"|lang={lang}"
    h.update(parts.encode("utf-8"))
    return h.hexdigest()


def _clone_sample_cache_identity(kind: str | None, speaker: str) -> str:
    """Include clone recording contents in the cache identity. A path alone is
    insufficient: users commonly replace a take in place, and serving sentences
    cloned from the previous file would be both stale and surprising."""
    if kind not in {"xtts", "chatterbox"}:
        return speaker
    sample = Path(speaker)
    if sample.suffix.lower() not in {".wav", ".mp3", ".flac", ".m4a"}:
        return speaker
    if not sample.is_absolute():
        return f"{speaker}|sample=invalid-relative"
    digest = hashlib.sha1()
    try:
        with sample.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as e:
        # Force a miss so the backend reports the actual missing/unreadable-file
        # error instead of silently using a cache entry from an earlier run.
        return f"{speaker}|sample-error={type(e).__name__}"
    return f"{speaker}|sample-sha1={digest.hexdigest()}"


def voice_cache_speaker(v: dict, who: str, effective_backend: str | None = None) -> str:
    """The speaker fragment of a voice's cache identity: its speaker plus any
    delivery direction — qwen's `instruct`, or chatterbox's `exaggeration` /
    `cfg_weight` / `lang` — so a changed direction re-synthesizes instead of
    serving stale audio."""
    kind = effective_backend or v.get("backend")
    spk = _clone_sample_cache_identity(kind, v.get("speaker", who))
    parts = [spk]
    if v.get("instruct"):
        parts.append(v["instruct"])
    if kind == "chatterbox" and (
            v.get("exaggeration") is not None or v.get("cfg_weight") is not None):
        parts.append(f"exg={v.get('exaggeration')}|cfg={v.get('cfg_weight')}")
    if kind == "chatterbox" and v.get("lang"):
        parts.append(f"lang={v['lang']}")
    # External providers are identified by their registered protocol and
    # implementation version. providerOptions is opaque to Narova, but sorted
    # JSON makes semantically identical objects hash identically.
    if kind is not None and kind not in BUILTIN_BACKENDS:
        parts.append(f"protocol={v.get('providerProtocol', '')}")
        parts.append(f"providerVersion={v.get('providerVersion', '')}")
        parts.append("providerOptions=" + json.dumps(
            v.get("providerOptions", {}), sort_keys=True,
            separators=(",", ":"), ensure_ascii=False))
    if v.get("gainDb") is not None:
        parts.append(f"gainDb={v['gainDb']}")
    return "|".join(parts)


def synth_sentence(backend, who: str, text: str, tmp: Path, out: Path, tempo: float,
                   cache_key: str | None = None, lang: str | None = None,
                   gain_db: float = 0.0) -> float:
    """Synthesize one sentence, speed via atempo (pitch-preserving; NEVER the XTTS
    speed param, LEARNINGS #9), then fade the edges. Returns the MEASURED duration
    of the processed clip — word timing is distributed across this real value.
    With cache_key, a hit skips TTS + processing entirely (byte-identical copy)."""
    cached = CACHE_DIR / f"{cache_key}.wav" if cache_key else None
    if cached is not None and cached.exists():
        shutil.copyfile(cached, out)
        return probe(out)
    raw = tmp / "_raw.wav"
    backend.synthesize(who, text, raw, lang=lang)
    d = probe(raw) / tempo                 # duration on the post-tempo timeline
    fo = max(0.0, d - FADE)
    gain = f",volume={gain_db}dB" if gain_db != 0.0 else ""
    sh("ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
       "-af", f"atempo={tempo}{gain},"
              f"afade=t=in:st=0:d={FADE},afade=t=out:st={fo}:d={FADE}",
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

    # Forced alignment replaces estimated word times with measured ones. Runs on
    # the reuse path too (config.align may change without the text changing).
    if config.get("align"):
        align_scenes(scenes, timings, audio_dir, config["align"].get("engine", "auto"))

    timings_path.write_text(json.dumps(timings))

    total = _verify_total(scenes, timings, audio_dir, tmp)
    # Bed/sfx also run on the reuse path: the mix config may change without
    # the spoken text changing.
    mix_audio(scenes, timings, config, audio_dir)
    return {"totalDuration": round(total, 3), "scenes": len(scenes), "out": str(out_dir)}


def _synthesize(scenes, config, timing, audio_dir, tmp, default_backend) -> dict[str, Any]:
    voices = config.get("voices", {})
    router = build_backends(voices, default_backend)
    try:
        return _synthesize_with_router(
            scenes, config, timing, audio_dir, tmp, default_backend, voices, router)
    finally:
        close_backends(router)


def _synthesize_with_router(
        scenes, config, timing, audio_dir, tmp, default_backend, voices, router
) -> dict[str, Any]:
    gap_sentence = timing["gapSentence"]
    gap_turn = timing["gapTurn"]
    lead = timing["lead"]
    tail = timing["tail"]
    tempo = float(timing["tempo"])

    # Cache identity per voice: backend kind + speaker name + (below) sentence text.
    voice_kind = {who: v.get("backend", default_backend) for who, v in voices.items()}
    voice_speaker = {
        who: voice_cache_speaker(v, who, voice_kind[who])
        for who, v in voices.items()
    }
    # Per-voice default lang for chatterbox/qwen/xtts (may be overridden per-turn).
    voice_lang = {who: v.get("lang") for who, v in voices.items() if v.get("lang")}
    voice_gain_db = {who: float(v.get("gainDb", 0.0)) for who, v in voices.items()}

    sil = {}
    for name, d in (("s", gap_sentence), ("t", gap_turn), ("lead", lead), ("tail", tail)):
        sil[name] = tmp / f"sil_{name}.wav"
        make_silence(d, sil[name])

    timings: dict[str, Any] = {}
    for s in scenes:
        nn = f"{s['n']:02d}"
        # Silent scene: no narration, just a fixed-duration silence block.
        if not s["segments"]:
            dur = float(s.get("dur", 2.0))
            wav = audio_dir / f"{nn}.wav"
            make_silence(dur, wav)
            timings[s["id"]] = {"dur": round(probe(wav), 3), "turns": [], "words": []}
            print(f"scene {nn} [{s['id']:>9}] {timings[s['id']]['dur']:5.1f}s  turns=(silent)", flush=True)
            continue
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

            backend_kind = voice_kind.get(who, default_backend)
            is_external = backend_kind not in BUILTIN_BACKENDS
            synth_text = turn.get("synthesisText") if is_external else None

            if synth_text:
                # External provider with separate synthesis text.
                # Split both texts; use synth for TTS, text for caption words.
                synth_sents = sentences(synth_text)
                clean_sents = sentences(turn["text"])
                if len(synth_sents) != len(clean_sents):
                    print(f"[narova] scene {nn} turn {ti}: synthesisText sentence count"
                          f" ({len(synth_sents)}) != text count ({len(clean_sents)})"
                          f" — falling back to text-only for {who!r}", flush=True)
                    synth_sents = clean_sents
                sent_pairs = list(zip(synth_sents, clean_sents))
            else:
                # Local backend or no synthesisText: use text for everything.
                clean_sents = sentences(turn["text"])
                sent_pairs = [(s, s) for s in clean_sents]

            for k, (synth_sent, clean_sent) in enumerate(sent_pairs):
                if k > 0:
                    pieces.append(sil["s"])
                    clock += gap_sentence
                w = tmp / f"{nn}_{si:03d}.wav"
                turn_lang = turn.get("lang") or voice_lang.get(who)
                key = sentence_cache_key(
                    voice_kind.get(who, default_backend),
                    voice_speaker.get(who, who),
                    synth_sent,
                    tempo,
                    lang=turn_lang,
                )
                d = synth_sentence(
                    router[who], who, synth_sent, tmp, w, tempo,
                    cache_key=key, lang=turn_lang,
                    gain_db=voice_gain_db.get(who, 0.0),
                )
                pieces.append(w)
                # Distribute clean text words across the sentence's real duration
                toks = clean_sent.split()
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
