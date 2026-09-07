"""Discord-only routing for non-critical JDDM scraper alerts."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

def post_notification(kind: str, body: str) -> list[str]:
    if not body:
        return []
    node = os.environ.get('JDDM_NODE_BIN') or shutil.which('node') or str(Path.home()/'.nvm/versions/node/v20.20.2/bin/node')
    helper = Path(__file__).resolve().parent/'send-discord-notification.mjs'
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', suffix='.txt', delete=False) as f:
        f.write(body)
        filename = f.name
    try:
        subprocess.run([node,str(helper),'--kind',kind,'--message-file',filename],check=True,capture_output=True,text=True,timeout=120)
        return ['Discord:'+kind]
    finally:
        Path(filename).unlink(missing_ok=True)
