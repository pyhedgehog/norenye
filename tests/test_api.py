import pytest
import logging
import pprint
import json

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

@pytest.mark.parametrize("norenyeclient", ["localclient", "dckhostclient"], indirect=True)
def test_root(norenyeclient):
    assert_httpconn(norenyeclient(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=b'svc1=/')

@pytest.mark.parametrize("norenyeclient", ["localclient", "dckhostclient"], indirect=True)
def test_health(norenyeclient):
    assert_httpconn(norenyeclient(), 'GET', '/_/health', body=b'{"status": "ok"}')

index_svc1 = b'''<html><head><title>Select env for host svc1.example.com</title></head><body>
<ul><li><a href="/_/redirect?set=svc1">svc1</a></li>
<li><a href="/_/redirect?set=svc3">svc3</a></li>
</ul>
</body></html>
'''

@pytest.mark.parametrize("norenyeclient", ["localclient", "dckhostclient"], indirect=True)
def test_index(norenyeclient):
    assert_httpconn(norenyeclient(), 'GET', '/_/', headers={'Host': 'svc1.example.com'}, body=index_svc1)

def test_config(norenyeconfig):
    config = norenyeconfig()
    assert list(config.keys()) == 'services token writeback'.split()
    assert list(config['services'].keys()) == 'svc1 svc2 svc3'.split()
    assert list(config['services']['svc1'].keys()) == 'target hosts'.split()
    assert list(config['services']['svc3'].keys()) == 'target hosts secrets'.split()
    assert config['services']['svc1']['target'] == 'http://127.0.0.1:8001'
