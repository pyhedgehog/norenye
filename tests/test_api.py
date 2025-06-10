import inspect
import pytest
import time
import pathlib
import logging
import json
import re
import sys
import subprocess
# from icecream import ic
# from pprint import pp
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

def getstackvar(name, stacklevel=1):
    for i, s in enumerate(inspect.stack()):
        if i < stacklevel:
            continue
        v = s.frame.f_locals
        if name in v:
            return v[name]

def check_altconfig():
    return getstackvar('item').cls.has_altconfig

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
    has_altconfig = False
    nginx_tmpl = 'nginx.def.conf'
    norenye_tmpl = 'norenye.def.json'

    @pytest.fixture(scope='class')
    def api(self, NorenyeAPIWrapper, norenyekind, norenye_test_api, norenye_get_tmpl):
        with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                               norenye_get_tmpl(self.nginx_tmpl),
                               norenye_get_tmpl(self.norenye_tmpl)) as res:
            assert res.status == 'ready'
            yield res

    skipif_altconfig = pytest.mark.skipif('check_altconfig()', reason='Skip if cls.has_altconfig set')
    svcprm = pytest.mark.parametrize('svc,bodytmpl', [
            pytest.param('svc1', b'svc1=%s', marks=[pytest.mark.fast], id='svc1'),
            pytest.param('svc2', b'svc2=%s', id='svc2'),
            pytest.param('svc3', re.compile(re.escape(b'svc3=GET /%s HTTP/1.')+b'[01]'), id='svc3'),
            pytest.param('svc4', b'svc4=GET=%s', marks=[skipif_altconfig], id='svc4'),
            pytest.param('svc5', b'svc4=GET=%s', marks=[skipif_altconfig], id='svc5'),
            pytest.param('svc6', b'svc6=GET=/svc6%s', marks=[skipif_altconfig], id='svc6'),
            pytest.param('svc7', b'svc1=/svc7%s', marks=[skipif_altconfig], id='svc7'),
        ])
    @parametrizematrix(svcprm, pytest.mark.parametrize('uri', [
            pytest.param('/'),
            pytest.param('/123', marks=[pytest.mark.slow]),
        ]))
    def test_forward(self, api, approxregexp, svc, bodytmpl, uri):
        bodytmpl = bodytmplhelper(approxregexp, bodytmpl, bytes(uri,'utf8'))
        assert_httpconn(api.get_client(), 'GET', uri, headers={'Host': svc+'.example.com', 'Cookie': 'norenye='+svc}, body=bodytmpl)

    def test_forward_post(self, api, approxregexp):
        assert_httpconn(api.get_client(), 'POST', '/test/123', reqbody='abcd', headers={'Host': 'svc3.example.com', 'Cookie': 'norenye=svc3'},
                        body=approxregexp(b'svc3=POST //test/123 HTTP/1\\.[01]\nabcd'))

    @pytest.mark.fast
    def test_noservice(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com'}, status=303, body=approxregexp(b'(?is)^<html>.*303 See Other'))
        assert 'location' in resp.headers
        assert resp.headers['location'] in {'http://svc1.example.com:8080/_/', 'http://svc1.example.com:8080/_/?uri=/'}

    @pytest.mark.fast
    def test_missingservice(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc777'}, status=303, body=approxregexp(b'(?is)^<html>.*303 See Other'))
        assert 'location' in resp.headers
        assert resp.headers['location'] in {'http://svc1.example.com:8080/_/', 'http://svc1.example.com:8080/_/?uri=/'}

    @pytest.mark.fast
    def test_priorityservice(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svc2.example.com'}, status=307, body=approxregexp(b'(?is)^<html>.*307 Temporary Redirect'))
        assert 'location' in resp.headers
        assert resp.headers['location'] in {'http://svc2.example.com:8080/_/?a=1', 'http://svc2.example.com:8080/_/?uri=/&a=1'}

    @pytest.mark.fast
    def test_health(self, api):
        assert_httpconn(api.get_client(), 'GET', '/_/health', body=b'{"status": "ok"}')

    @pytest.mark.fast
    def test_config(self, api):
        config = api.get_norenye_config()
        if not self.has_altconfig:
            assert list(config.keys()) == 'services tokens read_token template metadata writeback'.split()
            assert list(config['services'].keys()) == 'svc1 svc2 svc3 svc4 svc5 svc6 svc7'.split()
            assert list(config['services']['svc1'].keys()) == 'target hosts url metadata'.split()
            assert list(config['services']['svc3'].keys()) == 'target hosts url secrets metadata'.split()
            if api.norenyekind != 'process':
                assert config['services']['svc1']['target'] == 'http://127.0.0.1:8001'
        assert 'tokens' in config
        admin_tokens = [k for k,v in config['tokens'].items() if v == {'*':'admin'}]
        if not self.has_altconfig:
            assert len(config['tokens']) == 4
            assert len(admin_tokens) == 1
        assert '0ADMINADMINADMINADMINADMINADMIN0' in admin_tokens, 'Config incompatible with testsuite'

    @pytest.mark.fast
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

    @pytest.mark.fast
    def test_redirect_uri(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/redirect?set=svc3&uri=/123', headers={'Host': 'svc1.example.com:8080'}, status=307, body=approxregexp(b'(?is)^<html>.*307 Temporary Redirect'))
        assert 'set-cookie' in resp.headers
        assert resp.headers['set-cookie'].startswith('norenye=svc3')
        assert 'location' in resp.headers
        assert resp.headers['location'] == 'http://svc1.example.com:8080/123'

    def get_indexjson_check(self, approxregexp):
        check = {"services":{"svc1":{"service":{},"host":None,'redirect_url':'/_/redirect?set=svc1'},"svc3":{"service":{},"host":None,"current":True,'redirect_url':'/_/redirect?set=svc3'}}}
        if self.has_altconfig:
            check['services']['svc1']['service'] = None
            check['services']['svc1']['host'] = None
            check['services']['svc3']['service'] = None
            check['services']['svc3']['host'] = {}
        else:
            check['services']['svc1']['service']['info'] = 'Raw hosts dicts'
            check['services']['svc3']['service']['info'] = 'Hosts from URL'
            if self.has_tags:
                check['services']['svc1']['service']['tags'] = ['svc1']
                check['services']['svc1']['host'] = {'tags':['host1']}
        return check

    def test_indexjson(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/index.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        check = self.get_indexjson_check(approxregexp)
        assert obj == check
        assert list(obj.keys()) == ['services']
        assert list(obj['services'].keys()) == ['svc1', 'svc3']

    @pytest.mark.fast
    def test_indexjson_uri(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/index.json?uri=/123', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        check = self.get_indexjson_check(approxregexp)
        check["services"]["svc1"]['redirect_url'] = '/_/redirect?set=svc1&uri=/123'
        check["services"]["svc3"]['redirect_url'] = '/_/redirect?set=svc3&uri=/123'
        assert obj == check
        assert list(obj.keys()) == ['services']
        assert list(obj['services'].keys()) == ['svc1', 'svc3']

    def test_sessionjson(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/_session.json', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc3'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        assert obj == {'fail': 0, 'target': 'http://127.0.0.1:8003/', 'service': 'svc3', 'rights': {'*': approxregexp('none|read')}}

    @pytest.mark.fast
    def test_apijson(self, api, approxregexp):
        resp, body = assert_httpconn(api.get_client(), 'GET', '/_/_api.json', headers={'Host': 'svc1.example.com:8080'}, body=approxregexp(b'^{.*}[\n\r]*$'))
        obj = json.loads(body)
        assert obj == {
            'config_url': 'http://svc1.example.com:8080/_/config.json',
            'debug_url': 'http://svc1.example.com:8080/_/_debug.json',
            'health_url': 'http://svc1.example.com:8080/_/health',
            'index_url': 'http://svc1.example.com:8080/_/index.json',
            'indexhtml_url': 'http://svc1.example.com:8080/_/index.html',
            'redirect_url': 'http://svc1.example.com:8080/_/redirect?set={service}',
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

    def test_indexhtml(self, api, approxregexp):
        if self.has_tags:
            body = index_svc1_tags.replace(b'@1',b'').replace(b'@2',b'').replace(b'@3',b'').replace(b'@4',b' (svc1, host1)').replace(b'@5',b' (svc3)')
        else:
            body = index_svc1.replace(b'@1',b'').replace(b'@2',b'').replace(b'@3',b'')
        if self.has_altconfig:
            body = b'.*'.join(re.escape(p).replace(b'>',b'[^>]*>') for p in re.findall(b'<li>.*</li>', body))
            body = approxregexp(re.compile(b'.*'+body+b'.*', re.S))
        assert_httpconn(api.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080'}, body=body)
        assert_httpconn(api.get_client(), 'GET', '/_/index.html', headers={'Host': 'svc1.example.com:8080'}, body=body)

    @pytest.mark.fast
    def test_indexhtml_current(self, api, approxregexp):
        if self.has_tags:
            body = index_svc1_tags.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'').replace(b'@4',b' (svc1, host1, current)').replace(b'@5',b' (svc3)')
        else:
            body = index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'')
        if self.has_altconfig:
            body = b'.*'.join(re.escape(p).replace(b'>',b'[^>]*>') for p in re.findall(b'<li>.*</li>', body))
            body = approxregexp(re.compile(b'.*'+body+b'.*', re.S))
        assert_httpconn(api.get_client(), 'GET', '/_/', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=body)
        assert_httpconn(api.get_client(), 'GET', '/_/index.html', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=body)

    def test_indexhtml_uri(self, api, approxregexp):
        if self.has_tags:
            body = index_svc1_tags.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'&uri=/123').replace(b'@4',b' (svc1, host1, current)').replace(b'@5',b' (svc3)')
        else:
            body = index_svc1.replace(b'@1',b'<b>').replace(b'@2',b'</b>').replace(b'@3',b'&uri=/123')
        if self.has_altconfig:
            body = b'.*'.join(re.escape(p).replace(b'>',b'[^>]*>') for p in re.findall(b'<li>.*</li>', body))
            body = approxregexp(re.compile(b'.*'+body+b'.*', re.S))
        assert_httpconn(api.get_client(), 'GET', '/_/?uri=/123', headers={'Host': 'svc1.example.com:8080', 'Cookie': 'norenye=svc1'}, body=body)
        assert_httpconn(api.get_client(), 'GET', '/_/index.html?uri=/123', headers={'Host': 'svc1.example.com', 'Cookie': 'norenye=svc1'}, body=body)

    @pytest.mark.parametrize('svc', ['svc8'])
    def test_service_put(self, api, svc, approxregexp):
        config1 = api.get_norenye_config()
        assert svc not in config1['services']
        with api.revertfinally():
            reqbody = json.dumps(dict(name=svc,target='@svc5',hosts=['svc1.example.com']))
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
            assert 'svcX.example.com' not in oldhosts
            if self.has_tags:
                newhosts = {'svcX.example.com': dict(tags=['host4']), **oldhosts}
            else:
                newhosts = {'svcX.example.com': None, **oldhosts}
            reqbody = json.dumps(newhosts)
            headers = {'Host': 'svc1.example.com:8080', 'Cookie': 'token=0ADMINADMINADMINADMINADMINADMIN0', 'Content-Length': str(len(reqbody))}
            resp, body = assert_httpconn(api.get_client(), 'POST', '/_/service/%s/'%(svc,), headers=headers, reqbody=reqbody, body=b'', status=201)
            newhosts = {k.lower(): v for k,v in newhosts.items()}
            config2 = api.get_norenye_config()
            assert 'svcx.example.com' in config2['services'][svc]['hosts']
            assert config2['services'][svc]['hosts'] == newhosts
            #if svc == 'svc1':
            #    bodytmpl = b'svc1=/'
            bodytmpl = bodytmplhelper(approxregexp, bodytmpl, b'/')
            assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svcX.example.com', 'Cookie': 'norenye='+svc}, body=bodytmpl)
        #if svc == 'svc1':
        assert_httpconn(api.get_client(), 'GET', '/', headers={'Host': 'svcX.example.com', 'Cookie': 'norenye='+svc}, body=approxregexp(b'(?is)^<html>.*303 See Other'), status=303)

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
            pytest.param('svc10.example.com', id='host10'),
            pytest.param('svc11.example.com', marks=[pytest.mark.slow], id='host11'),
            pytest.param('svc12.example.com', marks=[pytest.mark.slow], id='host12'),
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

    # @skipif_altconfig
    # def test_fxtr(self, api):
    #     if self.has_tags: pytest.skip('Skip if self.has_tags set')

class TestNoTags(BaseTests):
    has_tags = False
    nginx_tmpl = 'nginx.def.conf'
    norenye_tmpl = 'norenye.notags.json'

class TestTags(BaseTests):
    has_tags = True
    nginx_tmpl = 'nginx.def.conf'
    norenye_tmpl = 'norenye.tags.json'

@pytest.mark.slow
class TestRootNoTags(BaseTests):
    has_tags = False
    has_adminloc = False
    nginx_tmpl = 'nginx.rootapi.conf'
    norenye_tmpl = 'norenye.notags.json'

class TestRootTags(BaseTests):
    has_tags = True
    has_adminloc = False
    nginx_tmpl = 'nginx.rootapi.conf'
    norenye_tmpl = 'norenye.tags.json'

@pytest.mark.slow
class TestSplitNoTags(BaseTests):
    has_tags = False
    has_adminloc = True
    nginx_tmpl = 'nginx.splitapi.conf'
    norenye_tmpl = 'norenye.notags.json'

class TestSplitTags(BaseTests):
    has_tags = True
    has_adminloc = True
    nginx_tmpl = 'nginx.splitapi.conf'
    norenye_tmpl = 'norenye.tags.json'

@pytest.mark.slow
class NoTestQJSRootNoTags(BaseTests):
    has_tags = False
    has_adminloc = False
    nginx_tmpl = 'nginx.qjsapi.conf'
    norenye_tmpl = 'norenye.notags.json'

@pytest.mark.slow
class NoTestQJSRootTags(BaseTests):
    has_tags = True
    has_adminloc = False
    nginx_tmpl = 'nginx.qjsapi.conf'
    norenye_tmpl = 'norenye.tags.json'

@pytest.fixture(scope='session')
def gen_docs_tmpl(norenye_get_tmpl):
    import subprocess
    root = pathlib.Path(__file__).parent / 'nginx'
    subprocess.check_call([sys.executable, pathlib.Path(__file__).parents[1]/'scripts'/'readme2tests.py', '-q'])
    assert (root / TestDocs.nginx_tmpl).exists()
    norenye_confpath = root / TestDocs.norenye_tmpl
    assert norenye_confpath.exists()
    norenye_conforig = norenye_confpath.read_text()
    config = json.loads(norenye_conforig)
    config.setdefault('tokens', {})
    admin_tokens = [k for k,v in config['tokens'].items() if v == {'*':'admin'}]
    for svc in 'svc1 svc2 svc3'.split():
        host = svc+'.example.com'
        if 'hosts' in config['services'][svc]:
            if isinstance(config['services'][svc]['hosts'], list):
                if host not in config['services'][svc]['hosts']:
                    config['services'][svc]['hosts'].append(host)
            else:
                if host not in config['services'][svc]['hosts']:
                    config['services'][svc]['hosts'][host] = None
    config['tokens']['0ADMINADMINADMINADMINADMINADMIN0'] = {'*':'admin'}
    norenye_confpath.write_text(json.dumps(config))
    yield True
    norenye_confpath.write_text(norenye_conforig)

@pytest.mark.usefixtures('gen_docs_tmpl')
@pytest.mark.slow
class TestDocs(BaseTests):
    has_tags = False
    has_adminloc = False
    has_altconfig = True
    nginx_tmpl = 'nginx.gen-readme-nginx-configuration.conf'
    norenye_tmpl = 'norenye.gen-readme-configuration-file.json'
