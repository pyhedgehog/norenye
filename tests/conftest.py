import http.client
import time
import functools
import contextlib
import json
import re
import os
import io
import tarfile
import pathlib
import pytest
import pytest_docker_tools as ptdt
import logging

log = logging.getLogger('norenye.conftest')
norenye_test_image = ptdt.build(
    path=os.fspath(pathlib.Path(__file__).parent.parent),
    tag='norenye-test:pytest',
    scope='session'
)

class ApproxRegexp:
    def __init__(self, pattern: re.Pattern|str|bytes):
        if not isinstance(pattern, re.Pattern):
            pattern = re.compile(pattern)
        self.pattern = pattern

    def __eq__(self, other):
        return self.pattern.match(other) is not None

    __req__ = __eq__

    def __repr__(self):
        return 'ApproxRegexp(%r)' % (self.pattern,)

@pytest.fixture
def approxregexp():
    return ApproxRegexp

class NginxConfigError(RuntimeError): ...

norenye_test_container = ptdt.container(
    image='{norenye_test_image.id}',
    name='norenye_pytest',
    command='testapid.sh',
    ports={'8080/tcp': None},
    environment={'NORENYE_PERIODIC': '1', 'TESTAPI_START': '1'},
    timeout=2,
    scope='session'
)

class NorenyeDockerTestAPI:
    def __init__(self, ctr):
        self.ctr = ctr
    def _cmd(self, cmd):
        assert self.ctr.status == "running"
        res,output = self.ctr.exec_run(['testapictl.sh', cmd])
        log.warning('$ %s %s ~~ %s\n%s', 'testapictl.sh', cmd, res, output)
        assert res == 0
        return output.decode('utf-8')
    def info(self):
        info = self._cmd('info')
        log.info(f'info: info={info!r}')
        return {k:bool(int(v)) for k,v in (s.split('=', 1) for s in info.split('\n') if s)}
    @property
    def status(self):
        if self.ctr.status != "running":
            return self.ctr.status
        try:
            info = self.info()
        except Exception:
            log.exception("Can't get nginx info:")
        log.warning(f'status: info={info}')
        if all(info.values()):
            return 'ready'
        if not info['confok']:
            return 'conferr'
        if not info['procok']:
            return 'piderr'
        log.error("Can't detect error precisely: %r", info)
        return 'error'
    def userstatus(self):
        return self._cmd('status')
    def start(self):
        return self._cmd('start')
    def stop(self):
        return self._cmd('stop')
    def _push_file(self, filename, value, uid=101, gid=101):
        if False:
            res,output = self.ctr.exec_run(['sh', '-c', 'echo -n "$value" > "$filename"'], environment=dict(filename=filename, value=value.replace('\\','\\\\')))
            assert res == 0, output
        else:
            fp = io.BytesIO(value.encode('utf-8'))
            tfp = io.BytesIO()
            with tarfile.open(mode='w:', fileobj=tfp) as tar:
                info = tarfile.TarInfo(filename)
                info.size = len(fp.getvalue())
                info.uid, info.gid = uid, gid
                tar.addfile(info, fileobj=fp)
            res = self.ctr._container.put_archive('/', tfp.getvalue())
            assert res
    def reload(self):
        return self._cmd('reload')
    def ensure(self, nginx_conf=None, norenye_json=None, want_reload=False):
        log.debug(f'ensure: ctr.status={self.ctr.status}')
        if self.ctr.status == "paused":
            self.ctr._container.unpause()
            self.ctr.reload()
        if self.ctr.status in {"exited", "created"}:
            self.ctr.restart()
        assert self.ctr.status == "running"
        if nginx_conf:
            want_reload = want_reload or self.get_files('/etc/nginx/nginx.conf')['nginx.conf'].decode('utf-8') != nginx_conf
        if norenye_json:
            want_reload = want_reload or self.get_files('/etc/nginx/norenye.json')['norenye.json'].decode('utf-8') != norenye_json
        info = self.info()
        if want_reload and info['confok'] and info.get('procok'):
            log.warning('nginx stop before config rewrite')
            self.stop()
        if nginx_conf:
            self._push_file('/etc/nginx/nginx.conf', nginx_conf)
            log.debug('pushed nginx_conf')
            assert self.get_files('/etc/nginx/nginx.conf')['nginx.conf'].decode('utf-8') == nginx_conf
        if nginx_conf:
            self._push_file('/etc/nginx/norenye.json', norenye_json)
            log.debug('pushed norenye_json')
            assert self.get_files('/etc/nginx/norenye.json')['norenye.json'].decode('utf-8') == norenye_json
        info = self.info()
        if not info['confok']:
            if info.get('procok'):
                self.stop()
            raise NginxConfigError(self._cmd('test'))
            return False
        if all(info.values()):
            return True
        self.start()
        info = self.info()
        return all(info.values())
    def get_files(self, files):
        return self.ctr.get_files(files)
    def get_external_addr(self):
        port = self.ctr.ports['8080/tcp'][0]
        return f'localhost:{port}'
    def get_internal_addr(self):
        addr = self.ctr.ips.primary
        return f'{addr}:8080'

class NorenyeAPIWrapper:
    def __init__(self, norenyekind, api, nginx_conf=None, norenye_json=None, **flags):
        self.api = api
        self.norenyekind = norenyekind
        self.nginx_conf = nginx_conf
        self.norenye_json = norenye_json
        self.__dict__.update(flags)
    def __enter__(self):
        self.api.ensure(nginx_conf=self.nginx_conf, norenye_json=self.norenye_json)
        return self
    def __exit__(self, *exc_info):
        self.api.stop()
    def get_norenye_config_text(self):
        # assert self.api.status == 'ready'
        return self.api.get_files('/etc/nginx/norenye.json')['norenye.json'].decode('utf-8')
    def get_norenye_config(self):
        # assert self.api.status == 'ready'
        return json.loads(self.get_norenye_config_text())
    def get_nginx_config(self):
        # assert self.api.status == 'ready'
        return self.api.get_files('/etc/nginx/nginx.conf')['nginx.conf'].decode('utf-8')
    @property
    def status(self):
        return self.api.status
    def get_addr(self):
        assert self.status == 'ready'
        if self.norenyekind == 'docker':
            return self.api.get_external_addr()
        return self.api.get_internal_addr()
    def get_client(self):
        return http.client.HTTPConnection(self.get_addr())
    @contextlib.contextmanager
    def revertfinally(self):
        norenye_json = self.norenye_json or self.get_norenye_config_text()
        try:
            yield
        finally:
            self.api.ensure(nginx_conf=self.nginx_conf, norenye_json=norenye_json)

@pytest.fixture(scope='session')
def norenye_test_api(request, norenye_test_container, norenyekind):
    assert norenyekind != 'process'
    #norenye_test_container = request.getfixturevalue('norenye_test_container')
    return NorenyeDockerTestAPI(norenye_test_container)

@pytest.fixture(scope='session')
def norenye_get_tmpl():
    root = pathlib.Path(__file__).parent / 'nginx'
    def _norenye_get_tmpl(fn, *rest):
        return root.joinpath(fn, *rest).read_text()
    return _norenye_get_tmpl

@pytest.fixture(name='NorenyeAPIWrapper', scope='session')
def fixture_NorenyeAPIWrapper():
    return NorenyeAPIWrapper

@pytest.fixture(scope='class')
def norenye_wrapper_tags(norenyekind, norenye_test_api, norenye_get_tmpl):
    with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                           norenye_get_tmpl('nginx.def.conf'),
                           norenye_get_tmpl('norenye.tags.json'),
                           tags=True) as res:
        #assert res.status == 'ready'
        yield res

@pytest.fixture(scope='class')
def norenye_wrapper_notags(norenyekind, norenye_test_api, norenye_get_tmpl):
    with NorenyeAPIWrapper(norenyekind, norenye_test_api,
                           norenye_get_tmpl('nginx.def.conf'),
                           norenye_get_tmpl('norenye.notags.json'),
                           tags=False) as res:
        #assert res.status == 'ready'
        yield res

@pytest.fixture(scope='session')
def norenyeprocess():
    pytest.skip('norenyeprocess not yet reimplemented')
    # replace with patched cut-nginxproc.pytmp

@contextlib.contextmanager
def wrap_exception(tgt, catch=(Exception,)):
    try:
        yield
    except catch as exc:
        raise tgt from exc
    
#@pytest.fixture
def asxfail0():
    return wrap_exception(pytest.xfail.Exception)

@pytest.fixture(scope='session')
def asxfail():
    @contextlib.contextmanager
    def _asxfail(catch=(Exception,)):
        try:
            yield
        except catch as exc:
            pytest.xfail(str(exc))
    return _asxfail

@pytest.fixture(scope='session')
def norenyekind(request):
    return request.config.getoption("--norenye")

def pytest_addoption(parser):
    default = "dockerports" if ptdt.utils.tests_inside_container() else "docker"
    parser.addoption(
        "--norenye", action="store", default=default, choices=("docker", "dockerports",
        #"process"
        ),
        help="how to run/connect to nginx with norenye: docker, dockerports",
    )
