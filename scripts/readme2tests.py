#!/usr/bin/env python
import os
import sys
import json
import argparse
import pathlib
#import subprocess
import json5
import panflute
from panflute.elements import *
import slugify

def main(argv=None):
    argv = argv or sys.argv
    parser = argparse.ArgumentParser(prog=pathlib.Path(argv[0]).name)
    root = pathlib.Path(__file__).parent.parent
    parser.add_argument('filename', nargs='?', type=pathlib.Path, default=root/'README.md')
    parser.add_argument('--output-dir', '-o', type=pathlib.Path, default=root/'tests'/'nginx')
    parser.add_argument('--dry-run', '-n', action='store_true')
    parser.add_argument('--quiet', '-q', action='store_true')
    args = parser.parse_args(argv[1:])
    doc = panflute.convert_text(args.filename.read_text(), standalone=True)
    section = ''
    filename = None
    transaction = []
    for b in doc.content:
        if isinstance(b, Header):
            section = panflute.convert_text(b, 'panflute', 'plain').strip()
            filename = None
        elif isinstance(b, CodeBlock):
            if filename is None:
                print('WARN: Found CodeBlock in section %s without filename mentioned before.' % (section,))
                continue
            codeslug = slugify.slugify('gen-'+args.filename.stem+'-'+section)
            fn = '%s.%s%s' % (filename.stem, codeslug, filename.suffix)
            s = b.text
            assert isinstance(s, str)
            if filename.name == 'nginx.conf':
                assert 'http {' in s
                assert 'server {' in s
                s = '# '+fn+'\nerror_log /var/log/nginx/error.log warn;\npid /var/run/nginx.pid;\n'+s
                s = s.replace('http {\n', 'http {\ndefault_type application/octet-stream;\naccess_log /var/log/nginx/access.log combined;\n')
                s = s.replace('server {\n', 'server {\nlisten 8080;\nroot /usr/share/nginx/html;\n')
                if 'events {' not in s:
                    s = s.replace('http {\n', 'events {\n}\nhttp {\n')
                s = s.rstrip('\n')
                if s[-1:] == '}':
                    s = s[:-1]+"\n# added by readme2tests.py script\nserver {\nlisten 8001;\ndefault_type text/plain;\nserver_name svc1.example.com;\nlocation / {\nadd_header X-Nginx-Block svc1;\nadd_header X-Nginx-Host $host;\nreturn 200 svc1=$uri;\n}\n}\nserver {\nlisten 8002;\ndefault_type text/plain;\nserver_name svc2.example.com;\nlocation / {\nadd_header X-Nginx-Block svc2;\nadd_header X-Nginx-Host $host;\nreturn 200 svc2=$uri;\n}\n}\nserver {\nlisten 8003;\ndefault_type text/plain;\nserver_name svc3.example.com;\nlocation = /_urls.json {\ndefault_type application/json;\nreturn 200 '{\"svc1.example.com\":{},\"svc3.example.com\":{}}';\n}\nlocation / {\nadd_header X-Nginx-Block svc3;\nadd_header X-Nginx-Host $host;\nset $bodypage 'svc3=$request';\njs_content norenye.bodypage;\n}\n}\n}\n"
            elif filename.name == 'norenye.json':
                if any(s.lower().startswith('json5') for s in b.classes):
                    #s = subprocess.check_output('json5', input=s, encoding='utf-8')
                    obj = json5.loads(s)
                else:
                    obj = json.loads(s)
                s = json.dumps(obj, indent=2)
            fp = args.output_dir / fn
            if not args.quiet:
                print('%s (%d)' % (fp, len(s)))
            transaction.append((fp, s))
        else:
            for sb in panflute_walk(b):
                if isinstance(sb, Code) and '.' in sb.text:
                    filename = pathlib.PurePosixPath(sb.text.strip())
    if args.dry_run:
        print('No write step (got a --dry-run).')
        return
    for fp,s in transaction:
        fp.write_text(s)

def panflute_walk(el):
    res = []
    el.walk(lambda subel,doc:res.append(subel))
    return res

if __name__=='__main__':
    main()
