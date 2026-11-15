import asyncio,hashlib,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from harness.native_media import normalized_mp4
class NativeMediaTest(unittest.TestCase):
 def test_fragmented_mp4_is_remuxed_without_changing_media_packets_or_original(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'clip.mp4'
   subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=32x32:rate=2','-t','1','-c:v','libx264','-movflags','frag_keyframe+empty_moov',str(source)],check=True)
   original=source.read_bytes();self.assertIn(b'moof',original)
   target=asyncio.run(normalized_mp4(source,root));self.assertEqual(source.read_bytes(),original)
   self.assertNotIn(b'moof',target.read_bytes())
   def packet_hash(p):return subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-map','0','-c','copy','-f','hash','-hash','sha256','-'])
   self.assertEqual(packet_hash(source),packet_hash(target))
   with patch('harness.native_media.asyncio.create_subprocess_exec') as process:
    self.assertEqual(asyncio.run(normalized_mp4(source,root)),target);process.assert_not_called()
