import ast
import hashlib
import re
import tempfile
import unittest
from pathlib import Path

# Test path ownership without importing the optional ML/audio dependencies.
source = ast.parse(Path('prep.py').read_text())
function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'source_paths')

class SourcePathsTest(unittest.TestCase):
    def test_content_identity_and_collision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scope = {'ROOT': root, 'hashlib': hashlib, 're': re}
            exec(compile(ast.Module(body=[function], type_ignores=[]), 'prep.py', 'exec'), scope)
            paths = scope['source_paths']
            one, two = root / 'one.mp3', root / 'two.mp3'
            one.write_bytes(b'first'); two.write_bytes(b'second')
            slug, cache, out = paths(one, 'Song')
            self.assertEqual(paths(one, 'Song'), (slug, cache, out))
            with self.assertRaisesRegex(ValueError, 'another or unknown'):
                paths(two, 'Song')
            self.assertNotEqual(paths(two, 'Other')[1], cache)
            self.assertEqual(paths(one, 'Same audio')[1], cache)
            self.assertEqual(paths(one, '音楽')[0], 'song')
            legacy = root / 'songs' / 'legacy'; legacy.mkdir(); (legacy / 'song.json').write_text('{}')
            with self.assertRaises(ValueError): paths(one, 'Legacy')

if __name__ == '__main__': unittest.main()
