import pytest
import time
import py.path
import logging
import json

log = logging.getLogger(__name__)

def test_true():
    assert(True)

def assert_httpconn(conn, method, uri, body, reqbody=None, headers={}, status=200):
    dummy = conn.request(method, uri, body=reqbody, headers=headers)
    assert dummy is None
    resp = conn.getresponse()
    assert resp.status == status
    real_body = resp.read()
    assert body==real_body
    return resp, real_body



def test_forward_root_svc1(norenye_wrapper_notags):
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=b'svc1=/')

def test_forward_root_svc2(norenye_wrapper_notags):
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/', headers={'Host': 'svc2.example.com', 'Cookie': 'norenye=svc2'}, body=b'svc2=/')

def test_forward_root_svc3(norenye_wrapper_notags):
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc3'}, body=b'svc3=GET / HTTP/1.0')

def test_noservice(norenye_wrapper_notags, approxregexp):
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc4'}, status=302, body=approxregexp(b'(?is)^<html>.*302 Found'))
    assert 'location' in resp.headers
    assert resp.headers['location'] in {'http://svc1.example.com:8080/_/', 'http://svc1.example.com:8080/_/?uri=/'}

def test_health(norenye_wrapper_notags):
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/health', body=b'{"status": "ok"}')

index_svc1 = b'''<html><head><title>Select env for host svc1.example.com</title></head><body>
<ul><li>@1<a href="/_/redirect?set=svc1@3">svc1</a>@2</li>
<li><a href="/_/redirect?set=svc3@3">svc3</a></li>
</ul>
</body></html>
'''

index_svc1_tags = b'''<html><head><title>Select env for host svc1.example.com</title></head><body>
<ul><li>@1<a href="/_/redirect?set=svc1@3">svc1</a>@2@4</li>
<li><a href="/_/redirect?set=svc3@3">svc3</a>@5</li>
</ul>
</body></html>
'''

@pytest.mark.skipif('config.getoption("--norenye")!="process"', reason="--norenye is not 'process'")
def notest_nginx(norenyeprocess, norenyeconfig):
    #out = os.popen('find %s -ls' % (norenyeprocess.server_root,)).read()
    root = py.path.local(norenyeprocess.server_root)
    children = list(root.visit())
    assert len(children) == 12
    assert json.loads(root.join('norenye.json').read_text('utf8')) == norenyeconfig()

def test_config(norenye_wrapper_notags):
    config = norenye_wrapper_notags.get_norenye_config()
    assert list(config.keys()) == 'services tokens read_token template metadata writeback'.split()
    assert list(config['services'].keys()) == 'svc1 svc2 svc3'.split()
    assert list(config['services']['svc1'].keys()) == 'target hosts url metadata'.split()
    assert list(config['services']['svc3'].keys()) == 'target hosts url secrets metadata'.split()
    if norenye_wrapper_notags.norenyekind != 'process':
        assert config['services']['svc1']['target'] == 'http://127.0.0.1:8001'
    assert 'tokens' in config
    assert len(config['tokens']) == 4
    admin_tokens = [k for k,v in config['tokens'].items() if v == {'*':'admin'}]
    assert admin_tokens == ['0ADMINADMINADMINADMINADMINADMIN0']

def test_configjson(norenye_wrapper_notags, approxregexp):
    config = norenye_wrapper_notags.get_norenye_config()
    config['status'] = 2
    config['name'] = '/etc/nginx/norenye.json'
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/config.json', headers={'Host': '127.0.0.1:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}, body=approxregexp(b'^{.*}[\n\r]*$'))
    obj = json.loads(body)
    assert obj == config

def test_indexhtml(norenye_wrapper_notags):
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080'}, body=index_svc1.replace(b'@1',b'').replace(b'@2',b'').replace(b'@3',b''))
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/index.html', headers={'Host': 'svc1.example.com:8080'}, body=index_svc1.replace(b'@1',b'').replace(b'@2',b'').replace(b'@3',b''))

def test_indexhtml_tags(norenye_wrapper_tags):
    assert_httpconn(norenye_wrapper_tags.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080'}, body=index_svc1_tags.replace(b'@1',b'').replace(b'@2',b'').replace(b'@3',b'').replace(b'@4',b' (svc1, host1)').replace(b'@5',b' (svc3)'))
    assert_httpconn(norenye_wrapper_tags.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=index_svc1_tags.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'').replace(b'@4',b' (svc1, host1, current)').replace(b'@5',b' (svc3)'))

def test_indexhtml_current(norenye_wrapper_notags):
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b''))
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/index.html', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b''))

def test_indexhtml_uri(norenye_wrapper_notags):
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/?uri=/123', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'&uri=/123'))
    assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/index.html?uri=/123', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'&uri=/123'))

def test_redirect(norenye_wrapper_notags, approxregexp):
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/redirect?set=svc1', headers={'Host': 'svc1.example.com:8080'}, status=307, body=approxregexp(b'(?is)^<html>.*307 Temporary Redirect'))
    assert 'set-cookie' in resp.headers
    assert resp.headers['set-cookie'].startswith('norenye=svc1')
    assert 'location' in resp.headers
    assert resp.headers['location'] == 'http://svc1.example.com:8080/'

def test_redirect_uri(norenye_wrapper_notags, approxregexp):
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/redirect?set=svc3&uri=/123', headers={'Host': 'svc1.example.com:8080'}, status=307, body=approxregexp(b'(?is)^<html>.*307 Temporary Redirect'))
    assert 'set-cookie' in resp.headers
    assert resp.headers['set-cookie'].startswith('norenye=svc3')
    assert 'location' in resp.headers
    assert resp.headers['location'] == 'http://svc1.example.com:8080/123'

def test_indexjson(norenye_wrapper_notags, approxregexp):
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/index.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
    obj = json.loads(body)
    for svc in obj['services'].values():
        svc.pop('redirect_url', None)
    assert obj == {"services":{"svc1":{"service":None,"host":None},"svc3":{"service":None,"host":{},"current":True}}}
    assert list(obj.keys()) == ['services']
    assert list(obj['services'].keys()) == ['svc1', 'svc3']

def test_sessionjson(norenye_wrapper_notags, approxregexp):
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/_session.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
    obj = json.loads(body)
    assert obj == {'fail': 0, 'target': 'http://127.0.0.1:8003', 'service': 'svc3', 'rights': {'*': 'none'}}

def test_debugjson(norenye_wrapper_notags, approxregexp, asxfail):
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'GET', '/_/_debug.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
    obj = json.loads(body)
    with asxfail(AssertionError):
        assert list(obj.keys()) == ['error_log_path', 'req', 'worker_id', 'pid', 'ppid', 'env', 'argv', 'njs_engine', 'njs_version', 'ngx_version', 'ngx', 'memoryStats'], 'Can be changed unexpectedly'
    assert 'env' in obj
    assert obj['env'] == {'NORENYE_PERIODIC': '1', 'NORENYE_MODE': 'dev'}
    assert 'ngx' in obj
    assert 'shared' in obj['ngx']
    assert 'norenye' in obj['ngx']['shared']

def test_put_svc4(norenye_wrapper_notags, approxregexp):
    config1 = norenye_wrapper_notags.get_norenye_config()
    assert 'svc4' not in config1['services']
    reqbody = json.dumps(dict(name='svc4',target='@svc4',hosts=['svc1.example.com']))
    headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0', 'Content-Length': str(len(reqbody))}
    resp, body = assert_httpconn(norenye_wrapper_notags.get_client(), 'PUT', '/_/service/', headers=headers, reqbody=reqbody, body=b'', status=201)
    config2 = norenye_wrapper_notags.get_norenye_config()
    assert 'svc4' in config2['services']
