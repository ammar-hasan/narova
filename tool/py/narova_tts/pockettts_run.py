#!/usr/bin/env python3
"""Locate the independently installed Pocket runtime; never install on use."""
import os
from pathlib import Path
import sys

home = Path(os.environ.get('NAROVA_HOME', str(Path.home()/'.narova'))).expanduser()
venv = Path(os.environ.get('NAROVA_POCKETTTS_VENV', str(home/'venv-pockettts'))).expanduser()
python = venv/'bin'/'python'
if not python.is_file():
    sys.exit('Pocket runtime missing; run narova-setup --pockettts first')
if os.environ.get('NAROVA_POCKETTTS_OFFLINE') == '1':
    os.environ['HF_HUB_OFFLINE'] = '1'
os.execv(str(python), [str(python), str(Path(__file__).with_name('pockettts_worker.py')), *sys.argv[1:]])
