"""Validate and build the SiYuan marketplace package using Python's standard library."""
from pathlib import Path
import argparse
import json
import re
import struct
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = ['index.js', 'index.css', 'core.js', 'selection.js', 'references.js',
         'visibility.js', 'workspace.js', 'atlas.js', 'atlas.html', 'atlas.css',
         'plugin.json', 'README.md', 'LICENSE', 'icon.png', 'icon.svg', 'preview.png']

def validate():
    manifest = json.loads((ROOT / 'plugin.json').read_text(encoding='utf-8-sig'))
    assert manifest['name'] == 'personal-knowledge-atlas'
    assert re.fullmatch(r'\d+\.\d+\.\d+', manifest['version'])
    assert re.fullmatch(r'https://github\.com/[^/]+/personal-knowledge-atlas', manifest['url'])
    assert manifest['author'] and manifest['minAppVersion']
    assert manifest['disabledInPublish'] is True
    for key in ['displayName', 'description', 'readme']:
        assert manifest[key].get('default')
        assert all('_' not in locale for locale in manifest[key])
    for name in FILES:
        assert (ROOT / name).is_file(), f'Missing file: {name}'
    for name, expected, limit in [('icon.png', (160,160), 64*1024), ('preview.png', (1024,768), 512*1024)]:
        data = (ROOT / name).read_bytes()
        assert data[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II', data[16:24]) == expected, f'Wrong dimensions: {name}'
        assert len(data) <= limit, f'Image too large: {name}'
    for name in FILES:
        if Path(name).suffix in ['.js','.json','.html','.css','.md']:
            text = (ROOT / name).read_text(encoding='utf-8-sig')
            assert not re.search(r'\b\d{14}-[a-z0-9]{7}\b', text), f'Hard-coded notebook ID found: {name}'
            assert not re.search(r'(?i)\b[A-Z]:[\\/]', text), f'Absolute local path found: {name}'
    return manifest

def build(output):
    manifest = validate()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(FILES):
            entry=zipfile.ZipInfo(name, (2026,1,1,0,0,0))
            entry.compress_type=zipfile.ZIP_DEFLATED
            entry.external_attr=0o644 << 16
            archive.writestr(entry,(ROOT/name).read_bytes())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert sorted(archive.namelist()) == sorted(FILES)
    print(json.dumps({'version':manifest['version'],'files':len(FILES),'bytes':Path(output).stat().st_size}, ensure_ascii=True))

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'package.zip')
    build(parser.parse_args().output)
