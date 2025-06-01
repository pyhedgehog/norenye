import inspect
import pytest
import time
import pathlib
import logging
import json
import re
from icecream import ic
from pprint import pp
from _pytest.python import IdMaker
from _pytest.mark.structures import ParameterSet

log = logging.getLogger(__name__)

def notest_true():
    assert(True)

def assert_httpconn(conn, method, uri, body, reqbody=None, headers={}, status=200):
    dummy = conn.request(method, uri, body=reqbody, headers=headers)
    assert dummy is None
    resp = conn.getresponse()
    real_body = resp.read()
    error = resp.headers.get('x-norenye-error', resp.reason)
    assert resp.status == status, error
    assert body == real_body
    return resp, real_body

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
    root = pathlib.Path(norenyeprocess.server_root)
    children = list(root.rglob('*'))
    assert len(children) == 12
    assert json.loads(root.join('norenye.json').read_text('utf8')) == norenyeconfig()

def ic_(arg):
    ic(arg)

class LazyBool:
    def __init__(self, fn):
        self.fn = fn
    def __bool__(self):
        return self.fn()

def getstackvar(name, stacklevel=1):
    for i, s in enumerate(inspect.stack()):
        if i < stacklevel:
            continue
        v = s.frame.f_locals
        if name in v:
            return v[name]

def bodytmplhelper(approxregexp, bodytmpl, uri):
    if isinstance(bodytmpl, re.Pattern):
        return approxregexp(re.compile(bodytmpl.pattern%uri, bodytmpl.flags))
    return bodytmpl%uri

def _fixparametrize(m):
    if isinstance(m, pytest.MarkDecorator):
        m = m.mark
    assert isinstance(m, pytest.Mark)
    assert m.name == 'parametrize'
    assert len(m.args) == 2
    assert type(m.args[0]) == str
    assert isinstance(m.args[1], list)
    margs = m.args[0].split(',')
    largs = len(margs)
    mvalues = list(m.args[1])
    assert len(mvalues)>0
    for i in range(len(mvalues)):
        a = mvalues[i]
        if not isinstance(a, ParameterSet):
            if isinstance(a, (list, tuple)):
                assert len(a) == largs
                a = pytest.param(*a)
            else:
                assert 1 == largs
                a = pytest.param(a)
        assert len(a.values) == largs
        mvalues[i] = a
    ids = IdMaker(m.args[0],mvalues,None,None,None,None,None).make_unique_parameterset_ids()
    for i in range(len(mvalues)):
        a = mvalues[i]
        if not a.id:
            mvalues[i] = pytest.param(*a.values, marks=a.marks, id=ids[i])
    assert len(mvalues)>0
    res = pytest.mark.parametrize(m.args[0], mvalues).mark
    print(res)
    return res

def parametrizematrix(*marks):
    def _get_marks(m):
        if not m.marks:
            return []
        if isinstance(m.marks, pytest.MarkDecorator):
            return [m.marks]
        return m.marks

    args = []
    lfargs = 0
    values = []
    lvalues = 0
    for m in marks:
        m = _fixparametrize(m)
        margs = m.args[0].split(',')
        largs = len(margs)
        mvalues = list(m.args[1])
        if not values:
            values = mvalues
            lvalues = len(values)
        else:
            newvalues = []
            for a1 in values:
                for a2 in mvalues:
                    newvalues.append(pytest.param(*a1.values, *a2.values, marks=_get_marks(a1)+_get_marks(a2), id=a1.id+'-'+a2.id))
            values = newvalues
            lvalues *= len(mvalues)
        args.extend(margs)
        lfargs += largs
    assert len(args) == lfargs
    assert len(values) == lvalues
    res = pytest.mark.parametrize(','.join(args), values)
    # print(res)
    return res

def parametrizecut(m, varnames):
    def _filter_args(avalues):
        for i in range(len(avalues)):
            if margs[i] in varnames:
                yield avalues[i]

    varnames = varnames.split(',') if isinstance(varnames, str) else varnames
    m = _fixparametrize(m)
    margs = m.args[0].split(',')
    largs = len(margs)
    mvalues = list(m.args[1])
    values = []
    for a in mvalues:
        values.append(pytest.param(*_filter_args(a.values), marks=a.marks, id=a.id))
    res = pytest.mark.parametrize(','.join(varnames), values)
    print(res)
    return res

class BaseTests:
    has_debug = True
    has_adminloc = True

    svcprm = pytest.mark.parametrize('svc,bodytmpl', [
            pytest.param('svc1', b'svc1=%s', id='svc1'),
            pytest.param('svc2', b'svc2=%s', id='svc2'),
            pytest.param('svc3', re.compile(re.escape(b'svc3=GET %s HTTP/1.')+b'[01]'), id='svc3'),
        ])
    @parametrizematrix(svcprm, pytest.mark.parametrize('uri', ['/','/123']))
    def test_forward(self, api, svc, bodytmpl, approxregexp, uri):
        bodytmpl = bodytmplhelper(approxregexp, bodytmpl, bytes(uri,'utf8'))
        assert_httpconn(api.get_client(), 'GET', uri, headers={'Host': svc+'.example.com', 'Cookie': 'norenye='+svc}, body=bodytmpl)

    #@svcprm
    #def test_forward_uri(self, api, svc, bodytmpl, approxregexp, uri='/123'):
    #    self.test_forward(api, svc, bodytmpl, approxregexp, uri)

    def test_noservice(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc777'}, status=303, body=approxregexp(b'(?is)^<html>.*303 See Other'))
        assert 'location' in resp.headers
        assert resp.headers['location'] in {'http://svc1.example.com:8080/_/', 'http://svc1.example.com:8080/_/?uri=/'}

    def test_health(self, api):
        assert_httpconn(api.get_client(), 'GET', '/_/health', body=b'{"status": "ok"}')

    def test_config(self, api):
        config = api.get_norenye_config()
        assert list(config.keys()) == 'services tokens read_token template metadata writeback'.split()
        assert list(config['services'].keys()) == 'svc1 svc2 svc3'.split()
        assert list(config['services']['svc1'].keys()) == 'target hosts url metadata'.split()
        assert list(config['services']['svc3'].keys()) == 'target hosts url secrets metadata'.split()
        if api.norenyekind != 'process':
            assert config['services']['svc1']['target'] == 'http://127.0.0.1:8001'
        assert 'tokens' in config
        assert len(config['tokens']) == 4
        admin_tokens = [k for k,v in config['tokens'].items() if v == {'*':'admin'}]
        assert admin_tokens == ['0ADMINADMINADMINADMINADMINADMIN0'], 'Config incompatible with testsuite'

    def test_configjson(self, api, approxregexp):
        config = api.get_norenye_config()
        config['status'] = 2
        config['name'] = '/etc/nginx/norenye.json'
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/config.json', headers={'Host': '127.0.0.1:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        assert obj == config

    def test_redirect(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/redirect?set=svc1', headers={'Host': 'svc1.example.com:8080'}, status=307, body=approxregexp(b'(?is)^<html>.*307 Temporary Redirect'))
        assert 'set-cookie' in resp.headers
        assert resp.headers['set-cookie'].startswith('norenye=svc1')
        assert 'location' in resp.headers
        assert resp.headers['location'] == 'http://svc1.example.com:8080/'

    def test_redirect_uri(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/redirect?set=svc3&uri=/123', headers={'Host': 'svc1.example.com:8080'}, status=307, body=approxregexp(b'(?is)^<html>.*307 Temporary Redirect'))
        assert 'set-cookie' in resp.headers
        assert resp.headers['set-cookie'].startswith('norenye=svc3')
        assert 'location' in resp.headers
        assert resp.headers['location'] == 'http://svc1.example.com:8080/123'

    def test_indexjson(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/index.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        check = {"services":{"svc1":{"service":None,"host":None,'redirect_url':'/_/redirect?set=svc1'},"svc3":{"service":None,"host":None,"current":True,'redirect_url':'/_/redirect?set=svc3'}}}
        if self.has_tags:
            check['services']['svc1']['service'] = {'tags':['svc1']}
            check['services']['svc1']['host'] = {'tags':['host1']}
            #check = {'services':{'svc1':{'service':{'tags':['svc1']},'host':{'tags':['host1']},'redirect_url':'/_/redirect?set=svc1'},'svc3':{'service':None,'host':None,'current':True,'redirect_url':'/_/redirect?set=svc3'}}}
        assert obj == check
        assert list(obj.keys()) == ['services']
        assert list(obj['services'].keys()) == ['svc1', 'svc3']

    def test_indexjson_uri(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/index.json?uri=/123', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        check = {"services":{"svc1":{"service":None,"host":None,'redirect_url':'/_/redirect?set=svc1&uri=/123'},"svc3":{"service":None,"host":None,"current":True,'redirect_url':'/_/redirect?set=svc3&uri=/123'}}}
        if self.has_tags:
            check['services']['svc1']['service'] = {'tags':['svc1']}
            check['services']['svc1']['host'] = {'tags':['host1']}
            #check = {'services':{'svc1':{'service':{'tags':['svc1']},'host':{'tags':['host1']},'redirect_url':'/_/redirect?set=svc1&uri=123'},'svc3':{'service':None,'host':{},'current':True,'redirect_url':'/_/redirect?set=svc3&uri=123'}}}
        assert obj == check
        assert list(obj.keys()) == ['services']
        assert list(obj['services'].keys()) == ['svc1', 'svc3']

    def test_sessionjson(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/_session.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        assert obj == {'fail': 0, 'target': 'http://127.0.0.1:8003', 'service': 'svc3', 'rights': {'*': 'none'}}

    def test_apijson(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/_api.json', headers={'Host': 'svc1.example.com:8080'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        assert obj == {
            'config_url': 'http://svc1.example.com:8080/_/config.json',
            'debug_url': 'http://svc1.example.com:8080/_/_debug.json',
            'health_url': 'http://svc1.example.com:8080/_/health',
            'index_url': 'http://svc1.example.com:8080/_/index.json',
            'indexhtml_url': 'http://svc1.example.com:8080/_/index.html',
            'service_create_url': 'http://svc1.example.com:8080/_/service/',
            'service_host_url': 'http://svc1.example.com:8080/_/service/{service}/{host}',
            'service_hosts_url': 'http://svc1.example.com:8080/_/service/{service}',
            'session_url': 'http://svc1.example.com:8080/_/_session.json'}

    def test_adminapijson(self, api, approxregexp):
        if not self.has_adminloc:
            return pytest.skip(f'no /_admin_/ location')
        resp, body0 = assert_httpconn(api.get_client(), 'GET', '/_admin_/_api.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_admin_/', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        assert body == body0
        obj = json.loads(body)
        assert obj == {
            'config_url': 'http://svc1.example.com:8080/_admin_/config.json',
            'debug_url': 'http://svc1.example.com:8080/_admin_/_debug.json',
            'health_url': 'http://svc1.example.com:8080/_admin_/health',
            'service_create_url': 'http://svc1.example.com:8080/_admin_/service/',
            'service_host_url': 'http://svc1.example.com:8080/_admin_/service/{service}/{host}',
            'service_hosts_url': 'http://svc1.example.com:8080/_admin_/service/{service}',
            'session_url': 'http://svc1.example.com:8080/_admin_/_session.json'}

    def test_debugjson(self, api, approxregexp, asxfail):
        if not self.has_debug:
            return pytest.skip(f'no /_/_debug.json location')
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/_debug.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        with asxfail(AssertionError):
            assert list(obj.keys()) == ['error_log_path', 'req', 'worker_id', 'pid', 'ppid', 'env', 'argv', 'njs_engine', 'njs_version', 'ngx_version', 'ngx', 'memoryStats'], 'Can be changed unexpectedly'
        assert 'env' in obj
        assert obj['env'] == {'NORENYE_PERIODIC': '1', 'NORENYE_MODE': 'dev'}
        assert 'ngx' in obj
        assert 'shared' in obj['ngx']
        assert 'norenye' in obj['ngx']['shared']

    def test_indexhtml(self, api):
        if self.has_tags:
            body = index_svc1_tags.replace(b'@1',b'').replace(b'@2',b'').replace(b'@3',b'').replace(b'@4',b' (svc1, host1)').replace(b'@5',b' (svc3)')
        else:
            body = index_svc1.replace(b'@1',b'').replace(b'@2',b'').replace(b'@3',b'')
        assert_httpconn(api.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080'}, body=body)
        assert_httpconn(api.get_client(), 'GET', '/_/index.html', headers={'Host': 'svc1.example.com:8080'}, body=body)

    def test_indexhtml_current(self, api):
        if self.has_tags:
            body = index_svc1_tags.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'').replace(b'@4',b' (svc1, host1, current)').replace(b'@5',b' (svc3)')
        else:
            body = index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'')
        assert_httpconn(api.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=body)
        assert_httpconn(api.get_client(), 'GET', '/_/index.html', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=body)

    def test_indexhtml_uri(self, api):
        if self.has_tags:
            body = index_svc1_tags.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'&uri=/123').replace(b'@4',b' (svc1, host1, current)').replace(b'@5',b' (svc3)')
        else:
            body = index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'&uri=/123')
        assert_httpconn(api.get_client(), 'GET', '/_/?uri=/123', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=body)
        assert_httpconn(api.get_client(), 'GET', '/_/index.html?uri=/123', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=body)

    @pytest.mark.parametrize('svc', 'svc4')
    def test_service_put(self, api, svc, approxregexp):
        config1 = api.get_norenye_config()
        assert svc not in config1['services']
        reqbody = json.dumps(dict(name=svc,target='@svc4',hosts=['svc1.example.com']))
        headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0', 'Content-Length': str(len(reqbody))}
        resp, body = assert_httpconn(api.get_client(), 'PUT', '/_/service/', headers=headers, reqbody=reqbody, body=b'', status=201)
        config2 = api.get_norenye_config()
        assert svc in config2['services']

    @parametrizecut(svcprm, 'svc')
    def test_servicehosts_get(self, api, approxregexp, svc):
        config = api.get_norenye_config()
        assert svc in config['services']
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/service/%s/'%(svc,), headers={'Host': 'svc1.example.com', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        assert obj == config['services'][svc]['hosts']

    @svcprm
    def test_servicehosts_post(self, api, approxregexp, request, svc, bodytmpl):
        config0 = json.loads(api.norenye_json or api.get_norenye_config_text())
        assert svc in config0['services']
        with api.revertfinally():
            config1 = api.get_norenye_config()
            assert svc in config1['services']
            oldhosts = config1['services'][svc]['hosts']
            assert type(oldhosts) is dict
            assert 'svc4.example.com' not in oldhosts
            if self.has_tags:
                newhosts = {'svc4.example.com': dict(tags=['host4']), **oldhosts}
            else:
                newhosts = {'svc4.example.com': None, **oldhosts}
            reqbody = json.dumps(newhosts)
            headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0', 'Content-Length': str(len(reqbody))}
            resp, body = assert_httpconn(api.get_client(), 'POST', '/_/service/%s/'%(svc,), headers=headers, reqbody=reqbody, body=b'', status=201)
            config2 = api.get_norenye_config()
            assert 'svc4.example.com' in config2['services'][svc]['hosts']
            assert config2['services'][svc]['hosts'] == newhosts
            if svc == 'svc1':
                bodytmpl = b'svc1=/'
                assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc4.example.com', 'Cookie': 'norenye=svc1'}, body=bodytmpl)
        if svc == 'svc1':
            assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc4.example.com', 'Cookie': 'norenye=svc1'}, body=approxregexp(b'(?is)^<html>.*303 See Other'), status=303)

    #@pytest.mark.parametrize('svc', ['svc1'])  # , 'svc2', 'svc3'])
    def test_servicehosts_del(self, api, approxregexp, request):  # , svc):
        svc = 'svc1'
        config0 = json.loads(api.norenye_json or api.get_norenye_config_text())
        assert svc in config0['services']
        with api.revertfinally():
            config1 = api.get_norenye_config()
            assert svc in config1['services']
            oldhosts = config1['services'][svc]['hosts']
            assert type(oldhosts) is dict
            assert 'svc4.example.com' not in oldhosts
            headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}
            resp, body = assert_httpconn(api.get_client(), 'DELETE', '/_/service/%s/'%(svc,), headers=headers, body=b'', status=201)
            config2 = api.get_norenye_config()
            assert svc not in config2['services']
            if svc == 'svc1':
                assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=approxregexp(b'(?is)^<html>.*303 See Other'), status=303)
        if svc == 'svc1':
            bodytmpl = b'svc1=/'
            assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=bodytmpl)

    @parametrizecut(svcprm, 'svc')
    def test_servicehost_get(self, api, approxregexp, svc):
        config1 = api.get_norenye_config()
        assert config1['services'][svc]['hosts']
        host = next(iter(config1['services'][svc]['hosts'].keys()))
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/service/%s/%s'%(svc,host), headers={'Host': 'svc1.example.com', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}, body=approxregexp(b'^({.*}|null)[\n\r]*$'))
        obj = json.loads(body)
        check = config1['services'][svc]['hosts'][host]
        assert obj == check

    @parametrizematrix(parametrizecut(svcprm, 'svc'), pytest.mark.parametrize('host', [
            pytest.param('svc4.example.com', id='host4'),
            pytest.param('svc5.example.com', id='host5'),
            pytest.param('svc6.example.com', id='host6'),
        ]))
    def test_servicehost_put(self, api, approxregexp, svc, host):
        config1 = api.get_norenye_config()
        assert svc in config1['services']
        assert host not in config1['services'][svc]['hosts']
        with api.revertfinally():
            hostmeta = {'updated': True}
            if self.has_tags:
                hostmeta['tags'] = ['newhost']
            reqbody = json.dumps(hostmeta)
            headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0', 'Content-Length': str(len(reqbody))}
            assert_httpconn(api.get_client(), 'PUT', '/_/service/%s/%s'%(svc,host), headers=headers, reqbody=reqbody, body=b'', status=201)
            config2 = api.get_norenye_config()
            assert config2['services'][svc]['hosts'][host] == hostmeta
        config3 = api.get_norenye_config()
        assert host not in config3['services'][svc]['hosts']

    @parametrizecut(svcprm, 'svc')
    def test_servicehost_post(self, api, approxregexp, svc):
        config1 = api.get_norenye_config()
        assert svc in config1['services']
        assert config1['services'][svc]['hosts']
        with api.revertfinally():
            host = next(iter(config1['services'][svc]['hosts'].keys()))
            hostmeta = (config1['services'][svc]['hosts'][host] or {}).copy()
            hostmeta['updated'] = True
            reqbody = json.dumps(hostmeta)
            headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0', 'Content-Length': str(len(reqbody))}
            assert_httpconn(api.get_client(), 'POST', '/_/service/%s/%s'%(svc,host), headers=headers, reqbody=reqbody, body=b'', status=201)
            config2 = api.get_norenye_config()
            assert config2['services'][svc]['hosts'][host] == hostmeta
        config3 = api.get_norenye_config()
        assert config3['services'][svc]['hosts'][host] == config1['services'][svc]['hosts'][host]

    @parametrizecut(svcprm, 'svc')
    def test_servicehost_del(self, api, approxregexp, svc):
        config1 = api.get_norenye_config()
        assert svc in config1['services']
        assert config1['services'][svc]['hosts']
        with api.revertfinally():
            host = next(iter(config1['services'][svc]['hosts'].keys()))
            headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0'}
            assert_httpconn(api.get_client(), 'DELETE', '/_/service/%s/%s'%(svc,host), headers=headers, body=b'', status=201)
            config2 = api.get_norenye_config()
            assert host not in config2['services'][svc]['hosts']
        config3 = api.get_norenye_config()
        assert host in config3['services'][svc]['hosts']

    # @pytest.mark.skipif(LazyBool(lambda:getstackvar('item').cls.has_tags), reason='Skip if cls.tags set')
    # def test_fxtr(self, api):
    #     if self.has_tags: pytest.skip('Skip if self.has_tags set')

@pytest.mark.slow
class TestNoTags(BaseTests):
    has_tags = False

    @pytest.fixture(scope='class')
    def api(self, NorenyeAPIWrapper, norenyekind, norenye_test_api, norenye_get_tmpl):
        with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                               norenye_get_tmpl('nginx.def.conf'),
                               norenye_get_tmpl('norenye.notags.json')) as res:
            assert res.status == 'ready'
            yield res

class TestTags(BaseTests):
    has_tags = True

    @pytest.fixture(scope='class')
    def api(self, NorenyeAPIWrapper, norenyekind, norenye_test_api, norenye_get_tmpl):
        with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                               norenye_get_tmpl('nginx.def.conf'),
                               norenye_get_tmpl('norenye.tags.json')) as res:
            assert res.status == 'ready'
            yield res

@pytest.mark.slow
class TestRootNoTags(BaseTests):
    has_tags = False
    has_adminloc = False

    @pytest.fixture(scope='class')
    def api(self, NorenyeAPIWrapper, norenyekind, norenye_test_api, norenye_get_tmpl):
        with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                               norenye_get_tmpl('nginx.rootapi.conf'),
                               norenye_get_tmpl('norenye.notags.json')) as res:
            assert res.status == 'ready'
            yield res

@pytest.mark.slow
class TestRootTags(BaseTests):
    has_tags = True
    has_adminloc = False

    @pytest.fixture(scope='class')
    def api(self, NorenyeAPIWrapper, norenyekind, norenye_test_api, norenye_get_tmpl):
        with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                               norenye_get_tmpl('nginx.rootapi.conf'),
                               norenye_get_tmpl('norenye.tags.json')) as res:
            assert res.status == 'ready'
            yield res

class NoTestQJSRootNoTags(BaseTests):
    has_tags = False
    has_adminloc = False

    @pytest.fixture(scope='class')
    def api(self, NorenyeAPIWrapper, norenyekind, norenye_test_api, norenye_get_tmpl):
        with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                               norenye_get_tmpl('nginx.qjsapi.conf'),
                               norenye_get_tmpl('norenye.notags.json')) as res:
            assert res.status == 'ready'
            yield res

class NoTestQJSRootTags(BaseTests):
    has_tags = True
    has_adminloc = False

    @pytest.fixture(scope='class')
    def api(self, NorenyeAPIWrapper, norenyekind, norenye_test_api, norenye_get_tmpl):
        with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                               norenye_get_tmpl('nginx.qjsapi.conf'),
                               norenye_get_tmpl('norenye.tags.json')) as res:
            assert res.status == 'ready'
            yield res
