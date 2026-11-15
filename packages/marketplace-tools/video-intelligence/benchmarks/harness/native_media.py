"""Lossless MP4 container normalization for native provider ingestion."""
import asyncio,hashlib,os,tempfile
from pathlib import Path
from .common import DomainError

async def normalized_mp4(source:Path, root:Path):
    digest=hashlib.sha256()
    with source.open('rb') as reader:
        while block:=reader.read(1024*1024):digest.update(block)
    folder=root/'artifacts/native-media';folder.mkdir(parents=True,exist_ok=True)
    output=folder/(digest.hexdigest()+'.mp4')
    if output.is_file() and output.stat().st_size:return output
    fd,name=tempfile.mkstemp(suffix='.mp4',dir=folder);os.close(fd)
    try:
        process=await asyncio.create_subprocess_exec('ffmpeg','-nostdin','-v','error','-i',str(source),'-map','0','-c','copy','-movflags','+faststart','-y',name,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.PIPE)
        try:
            _,errors=await process.communicate()
        finally:
            if process.returncode is None:process.kill();await process.wait()
        if process.returncode or not Path(name).stat().st_size:raise DomainError('NATIVE_CONTAINER_NORMALIZATION_FAILED')
        os.replace(name,output);return output
    finally:
        Path(name).unlink(missing_ok=True)
