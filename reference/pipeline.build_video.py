#!/usr/bin/env python3
"""Assemble the STD-003 course video — two-host Piper narration + a video rendered
FROM the interactive player, so the MP4 is pixel-identical to the web version
(kinetic captions, reactive reveals, motion).

Pipeline:
  Piper(vo) sentence-by-sentence (+fades, +loudnorm)  -> per-scene wav/mp3 + word timings
  inject audio+timings -> venture-factory-video.html (player) and record.html (capture page)
  capture player at each word onset via headless Chrome (still mode) -> frames
  assemble variable-duration frames + full audio -> venture-factory.mp4

REUSE=1 skips TTS and reuses existing audio/timings (fast iteration on the video).

Run:  /Users/.../friday-project/.venv/bin/python build_video.py
"""
import base64, json, os, re, subprocess, wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAMES, AUDIO, TMP, VOICES, CAP = HERE/"frames", HERE/"audio", HERE/"tmp", HERE/"voices", HERE/"cap"
for d in (AUDIO, TMP, CAP): d.mkdir(exist_ok=True)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RATE = 22050
REUSE = os.environ.get("REUSE") == "1"

def sh(*a, cwd=None): subprocess.run(list(a), check=True, cwd=cwd)
def probe(p):
    return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration",
        "-of","default=noprint_wrappers=1:nokey=1", str(p)], text=True).strip())

def rescale_timings(t, actual):
    """Scale a scene's word/turn timings to the MEASURED audio duration — loudnorm
    slightly compresses each scene, so the computed timeline drifts without this."""
    cur = t.get("dur", 0)
    if cur > 0 and actual > 0:
        f = actual / cur
        for w in t["words"]:
            w["t0"] = round(w["t0"] * f, 3); w["t1"] = round(w["t1"] * f, 3)
        t["turns"] = [round(x * f, 3) for x in t["turns"]]
        t["dur"] = round(actual, 3)
    return t

scenes = json.load(open(HERE/"narration.json"))
audio_map = {}

if REUSE and (HERE/"timings.json").exists():
    print("REUSE=1 — skipping TTS, loading existing audio + timings")
    timings = json.load(open(HERE/"timings.json"))
    for s in scenes:
        audio_map[s["id"]] = "data:audio/mpeg;base64," + base64.b64encode((AUDIO/f"{s['n']:02d}.mp3").read_bytes()).decode()
        rescale_timings(timings[s["id"]], probe(AUDIO/f"{s['n']:02d}.wav"))  # sync to actual audio
    (HERE/"timings.json").write_text(json.dumps(timings))
else:
    BACKEND = os.environ.get("BACKEND", "piper")
    GAP_SENTENCE, GAP_TURN, LEAD, TAIL, FADE = 0.24, 0.44, 0.16, 0.58, 0.012
    TEMPO = float(os.environ.get("TEMPO", "1.18" if BACKEND == "xtts" else "1.0"))
    if BACKEND == "xtts":
        os.environ["COQUI_TOS_AGREED"] = "1"
        import xtts_compat  # noqa: F401  (shims newest transformers)
        import torch
        from TTS.api import TTS
        dev = os.environ.get("XTTS_DEVICE", "mps" if torch.backends.mps.is_available() else "cpu")
        print(f"loading XTTS-v2 on {dev} …")
        _xtts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        try: _xtts.to(dev)
        except Exception as e: print("device fallback cpu:", e); _xtts.to("cpu")
        SPK = {"m": os.environ.get("XTTS_M", "Damien Black"),
               "f": os.environ.get("XTTS_F", "Sofia Hellen")}
        print("speakers:", SPK)
        def raw_synth(who, text, raw):
            _xtts.tts_to_file(text=text, speaker=SPK[who], language="en", file_path=str(raw))
    else:
        from piper import PiperVoice, SynthesisConfig
        CFG = SynthesisConfig(length_scale=1.06)
        print("loading Piper voices …")
        VMODEL = {"m": PiperVoice.load(str(VOICES/"en_US-ryan-high.onnx")),
                  "f": PiperVoice.load(str(VOICES/"en_US-hfc_female-medium.onnx"))}
        def raw_synth(who, text, raw):
            with wave.open(str(raw), "wb") as wf: VMODEL[who].synthesize_wav(text, wf, syn_config=CFG)

    def silence(dur, out):
        sh("ffmpeg","-y","-loglevel","error","-f","lavfi",f"-i","anullsrc=r=%d:cl=mono"%RATE,
           "-t",f"{dur}","-c:a","pcm_s16le","-sample_fmt","s16",str(out))
    SIL = {}
    for name,d in (("s",GAP_SENTENCE),("t",GAP_TURN),("lead",LEAD),("tail",TAIL)):
        SIL[name]=TMP/f"sil_{name}.wav"; silence(d,SIL[name])
    def sentences(t): return [p for p in re.split(r'(?<=[.!?])\s+', t.strip()) if p]
    def synth(who, text, out):
        raw=TMP/"_raw.wav"; raw_synth(who, text, raw)
        d=probe(raw)/TEMPO; fo=max(0.0,d-FADE)   # duration on the post-tempo timeline
        sh("ffmpeg","-y","-loglevel","error","-i",str(raw),
           "-af",f"atempo={TEMPO},afade=t=in:st=0:d={FADE},afade=t=out:st={fo}:d={FADE}",
           "-ar",str(RATE),"-ac","1","-c:a","pcm_s16le",str(out))
        return probe(out)
    def concat(pieces,out,norm=False):
        lst=TMP/"_list.txt"; lst.write_text("".join(f"file '{p}'\n" for p in pieces))
        af=["-af","loudnorm=I=-16:TP=-1.5:LRA=11"] if norm else []
        sh("ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(lst),
           *af,"-ar",str(RATE),"-ac","1","-c:a","pcm_s16le",str(out))

    timings={}
    for s in scenes:
        nn=f"{s['n']:02d}"; pieces=[SIL["lead"]]; clock=0.18; words=[]; turns=[]; si=0
        for ti,turn in enumerate(s["segments"]):
            if ti>0: pieces.append(SIL["t"]); clock+=0.52
            turns.append(round(clock,3))
            for k,sent in enumerate(sentences(turn["text"])):
                if k>0: pieces.append(SIL["s"]); clock+=0.30
                w=TMP/f"{nn}_{si:03d}.wav"; d=synth(turn["who"],sent,w); pieces.append(w)
                toks=sent.split(); wts=[len(t)+1 for t in toks]; tot=sum(wts); wt=clock
                for tok,wg in zip(toks,wts):
                    wd=d*(wg/tot); words.append({"w":tok,"t0":round(wt,3),"t1":round(wt+wd,3),"who":turn["who"],"si":si}); wt+=wd
                clock+=d; si+=1
        pieces.append(SIL["tail"]); clock+=0.66
        raw=TMP/f"scene_{nn}.wav"; concat(pieces,raw); wav=AUDIO/f"{nn}.wav"; concat([raw],wav,norm=True)
        sh("ffmpeg","-y","-loglevel","error","-i",str(wav),"-ac","1","-b:a","72k",str(AUDIO/f"{nn}.mp3"))
        audio_map[s["id"]]="data:audio/mpeg;base64,"+base64.b64encode((AUDIO/f"{nn}.mp3").read_bytes()).decode()
        timings[s["id"]]={"dur":round(clock,3),"turns":turns,"words":words}
        rescale_timings(timings[s["id"]], probe(wav))  # sync timeline to actual (post-loudnorm) audio
        print(f"scene {nn} [{s['id']:9}] {clock:5.1f}s  turns={''.join(t['who'] for t in s['segments'])}")
    (HERE/"timings.json").write_text(json.dumps(timings))

# ---- full audio track ----
lst=TMP/"full_list.txt"; lst.write_text("".join(f"file '{AUDIO}/{s['n']:02d}.wav'\n" for s in scenes))
full=HERE/"full.m4a"
sh("ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(lst),"-c:a","aac","-b:a","192k",str(full))

# ---- inject into player + record page ----
frag=(HERE/"player-fragment.html").read_text()
player=frag.replace("__AUDIO_DATA__",json.dumps(audio_map)).replace("__TIMINGS_DATA__",json.dumps(timings))
(HERE/"venture-factory-video.html").write_text(player)
rec=frag.replace("__AUDIO_DATA__","{}").replace("__TIMINGS_DATA__",json.dumps(timings))
RECORD=HERE/"record.html"
RECORD.write_text("<!doctype html><html lang=en><head><meta charset=utf-8><style>"
  "html,body{margin:0;background:#070b13}"
  "#vf-root{max-width:none!important;margin:0!important;padding:0!important}"
  ".controls,.hint{display:none!important}"
  ".scenewrap{width:1280px!important;height:720px!important;aspect-ratio:auto!important}"
  ".stage{border-radius:0!important;border:0!important}"
  "</style></head><body>"+rec+"</body></html>")
print(f"player + record page written")

# ---- keyframe times (word onsets) ----
acc=0.0; times=[]
for s in scenes:
    st=acc; t=timings[s["id"]]; times.append(round(st+0.01,3))
    for w in t["words"]: times.append(round(st+w["t0"]+0.01,3))
    acc+=t["dur"]
total=acc; times=sorted(set(t for t in times if t < total))
print(f"capturing {len(times)} keyframes across {total:.1f}s …")

def shot(i_t):
    i,t=i_t; out=CAP/f"{i:06d}.png"
    try:
        subprocess.run([CHROME,"--headless=new","--disable-gpu","--hide-scrollbars","--no-sandbox",
            "--disable-dev-shm-usage","--disable-extensions","--mute-audio",
            "--force-device-scale-factor=1","--window-size=1280,720","--virtual-time-budget=340",
            f"--screenshot={out}", f"file://{RECORD}?t={t:.3f}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=45, start_new_session=True)
    except subprocess.TimeoutExpired:
        pass  # headless Chrome hung; the PNG is written before it hangs
    return out
def bad(i): p=CAP/f"{i:06d}.png"; return (not p.exists()) or p.stat().st_size < 2000
WORKERS=int(os.environ.get("WORKERS","10"))
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    list(ex.map(shot, list(enumerate(times))))
retry=[i for i in range(len(times)) if bad(i)]
if retry:
    print(f"re-shooting {len(retry)} bad frames …")
    for i in retry: shot((i, times[i]))
missing=[i for i in range(len(times)) if bad(i)]
print(f"captured {len(times)-len(missing)}/{len(times)} frames" + (f"  STILL-BAD {missing[:5]}" if missing else ""))

# ---- assemble variable-duration frames + audio ----
concatf=HERE/"frames_concat.txt"; lines=[]
for i in range(len(times)):
    d=(times[i+1]-times[i]) if i+1<len(times) else max(0.2, total-times[i])
    lines.append(f"file '{CAP}/{i:06d}.png'\nduration {max(0.03,round(d,3))}")
lines.append(f"file '{CAP}/{len(times)-1:06d}.png'")   # concat demuxer needs last file repeated
concatf.write_text("\n".join(lines)+"\n")

final=HERE/"venture-factory.mp4"
sh("ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(concatf),"-i",str(full),
   "-map","0:v","-map","1:a","-r","30","-vsync","cfr","-pix_fmt","yuv420p",
   "-c:v","libx264","-preset","medium","-crf","20","-c:a","aac","-b:a","192k","-shortest",str(final))
print(f"\nMP4 -> {final}  ({probe(final):.1f}s)")
print(f"player -> venture-factory-video.html  ({len(player)//1024} KB)")
