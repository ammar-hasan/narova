"""CLI entry: `python -m narova_tts`. Node invokes this as the `synth` stage.

    python -m narova_tts \
        --narration out/narration.json \
        --config    reel.config.json \
        --out       out \
        --backend   piper \
        [--reuse]

Emits <out>/audio/NN.wav, <out>/audio/NN.mp3, <out>/timings.json, and prints a
one-line JSON summary to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .pipeline import run

# A few well-known starter voices per backend. `list` stays lightweight (no model
# load, no network); XTTS ships 58 studio speakers built into the cached model.
KNOWN_VOICES = {
    "piper": ["en_US-ryan-high", "en_US-hfc_female-medium", "en_US-lessac-medium"],
    "xtts": ["Damien Black", "Sofia Hellen", "Craig Gutsy", "Alison Dietlinde"],
    # Qwen3-TTS CustomVoice presets (all 9): first five suit English well;
    # Dylan/Uncle_Fu are Chinese-flavored, Ono_Anna Japanese, Sohee Korean.
    "qwen": ["Ryan", "Serena", "Vivian", "Eric", "Aiden",
             "Dylan", "Uncle_Fu", "Ono_Anna", "Sohee"],
}


def _voices(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="narova_tts voices", description="list / get TTS voices")
    ap.add_argument("sub", nargs="?", default="list", choices=["list", "get"])
    ap.add_argument("name", nargs="?", help="voice to get (piper only)")
    ap.add_argument("--backend", default="piper", choices=["piper", "xtts", "qwen"])
    args = ap.parse_args(argv)

    if args.sub == "list":
        for name in KNOWN_VOICES.get(args.backend, []):
            print(name)
        if args.backend == "xtts":
            print("… + 58 studio speakers built into the cached XTTS-v2 model", file=sys.stderr)
        elif args.backend == "qwen":
            print("… all 9 CustomVoice presets; voice cloning/design not wired into narova yet", file=sys.stderr)
        else:
            print("… more at https://github.com/rhasspy/piper/blob/master/VOICES.md", file=sys.stderr)
        return 0

    # get
    if args.backend != "piper":
        print(f"{args.backend} speakers are built into the model — nothing to download", file=sys.stderr)
        return 0
    if not args.name:
        print("usage: voices get <name> --backend piper", file=sys.stderr)
        return 2
    import os
    import subprocess
    from pathlib import Path
    # Same default as PiperBackend (honors NAROVA_PIPER_DIR).
    data_dir = Path(os.environ.get("NAROVA_PIPER_DIR", Path.home() / ".cache" / "narova" / "piper"))
    data_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, "-m", "piper.download_voices", args.name,
                    "--data-dir", str(data_dir)], check=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "voices":
        return _voices(argv[1:])

    ap = argparse.ArgumentParser(prog="narova_tts", description="narova TTS + timing")
    ap.add_argument("--narration", required=True, type=Path, help="path to narration.json")
    ap.add_argument("--config", required=True, type=Path, help="path to config JSON (voices, timing)")
    ap.add_argument("--out", required=True, type=Path, help="output directory")
    ap.add_argument("--backend", default="piper", choices=["piper", "xtts", "qwen"],
                    help="default backend; per-voice config.backend overrides it")
    ap.add_argument("--reuse", action="store_true",
                    help="skip synth; rescale existing timings to existing audio")
    ns = ap.parse_args(argv)

    summary = run(ns.narration, ns.config, ns.out,
                  default_backend=ns.backend, reuse=ns.reuse)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
