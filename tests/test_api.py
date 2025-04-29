import pytest
import py.path
import logging
import pprint
import json
from conftest import ApproxRegexp

log = logging.getLogger(__name__)

def test_true():
    assert(True)

def assert_httpconn(conn, method, uri, body, headers={}, status=200):
    dummy = conn.request(method, uri, headers=headers)
    assert dummy is None
    resp = conn.getresponse()
    assert resp.status == status
    real_body = resp.read()
    assert body==real_body
    return resp

def test_root(norenyeclient):
    assert_httpconn(norenyeclient(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=b'svc1=/')
    assert_httpconn(norenyeclient(), 'GET', '/', headers={'Host': 'svc2.example.com', 'Cookie': 'norenye=svc2'}, body=b'svc2=/')

def test_noservice(norenyeclient):
    assert_httpconn(norenyeclient(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc4'}, status=302, body=ApproxRegexp(b'(?is)^<html>.*302 Found'))

def test_health(norenyeclient):
    assert_httpconn(norenyeclient(), 'GET', '/_/health', body=b'{"status": "ok"}')

index_svc1 = b'''<html><head><title>Select env for host svc1.example.com</title></head><body>
<ul><li><a href="/_/redirect?set=svc1">svc1</a></li>
<li><a href="/_/redirect?set=svc3">svc3</a></li>
</ul>
</body></html>
'''

@pytest.mark.skipif('config.getoption("--norenye")!="process"', reason="--norenye is not 'process'")
def test_nginx(norenyeprocess, norenyeconfig):
    #out = os.popen('find %s -ls' % (norenyeprocess.server_root,)).read()
    root = py.path.local(norenyeprocess.server_root)
    children = list(root.visit())
    assert len(children) == 12
    assert json.loads(root.join('norenye.json').read_text('utf8')) == norenyeconfig()

def test_index(norenyeclient):
    assert_httpconn(norenyeclient(), 'GET', '/_/', headers={'Host': 'svc1.example.com'}, body=index_svc1)

def test_config(norenyeconfig, norenyekind):
    config = norenyeconfig()
    assert list(config.keys()) == 'services tokens template metadata writeback'.split()
    assert list(config['services'].keys()) == 'svc1 svc2 svc3'.split()
    assert list(config['services']['svc1'].keys()) == 'target hosts url metadata'.split()
    assert list(config['services']['svc3'].keys()) == 'target hosts url secrets metadata'.split()
    if norenyekind != 'process':
        assert config['services']['svc1']['target'] == 'http://127.0.0.1:8001'

def test_misunderstood():
    misunderstood = pytest.importorskip('misunderstood')
    assert misunderstood
