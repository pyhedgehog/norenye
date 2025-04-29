import http.client
import json
import re
import os
import py.path
import pytest
import pytest_docker_tools as ptdt
import pytest_nginx as ptnx

norenye_test_image = ptdt.build(
    path=py.path.local(__file__).join(os.pardir),
)

norenye_test_container = ptdt.container(
    image='{norenye_test_image.id}',
    ports={'8080/tcp': None},
)

srvroot = None

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

@pytest.fixture(scope="session")
def nginx_server_root(tmpdir_factory):
    global srvroot
    srvroot = tmpdir_factory.mktemp("nginx-server-root")
    altport = ptnx.factories.get_random_port("127.0.0.1")
    tmpl = srvroot / 'nginx.conf.tmpl'
    tests = py.path.local(__file__) / os.pardir
    assert tests.join('nginx', 'nginx.conf').exists()
    tmpl_data = ((tests / 'nginx' / 'nginx.conf')
                     .read_text('utf8')
                     .replace('/var/run/', '%TMPDIR%/')
                     .replace('/var/log/nginx/', '%TMPDIR%/')
                     .replace('/var/log/nginx/', '%TMPDIR%/')
                     .replace('/etc/nginx/', '%SERVER_ROOT%/')
                     .replace('/usr/share/nginx/', '%SERVER_ROOT%/')
                     .replace('user  nginx;\n', 'daemon  off;\n')
                     .replace('8080', '%PORT%')
                     .replace('8001', str(altport))
                     .replace('8002', str(altport+1))
                     .replace('8003', str(altport+2))
                     )
    tmpl.write_text(tmpl_data, 'utf8')
    assert tmpl.exists()
    srvroot.join('norenye.json').write_text(
        tests.join('nginx', 'norenye.json')
             .read_text('utf8')
             .replace(':8001', ':'+str(altport))
             .replace(':8002', ':'+str(altport+1))
             .replace(':8003', ':'+str(altport+2)), 'utf8')
    tgt = srvroot.mkdir('html')
    for f in (tests / 'nginx' / 'html').listdir(py.path.local.isfile):
        f.copy(tgt)
    tgt = srvroot.mkdir('html', '_').mkdir('static')
    (tests / os.pardir / 'norenye.ico').copy(tgt / 'favicon.ico')
    for f in (tests / 'nginx' / 'static').listdir(py.path.local.isfile):
        f.copy(tgt)
    (tests / os.pardir / 'js' / 'norenye.js').copy(srvroot.mkdir('js'))
    return srvroot

class nginx_template:
    def __fspath__(self):
        return os.fspath(srvroot / 'nginx.conf.tmpl')


norenyeprocess = ptnx.factories.nginx_proc('nginx_server_root', config_template=nginx_template(), port='')

@pytest.fixture
def norenyeaddr(request, norenyekind):
    if norenyekind == 'process':
        norenyeprocess = request.getfixturevalue('norenyeprocess')
        port = norenyeprocess.port
        return f'localhost:{port}'
    norenye_test_container = request.getfixturevalue('norenye_test_container')
    port = norenye_test_container.ports['8080/tcp'][0]
    addr = norenye_test_container.ips.primary
    norenye_test_container.exec_run('curl -s http://127.0.0.1:8080/_/')
    assert norenye_test_container.exec_run('curl -s http://127.0.0.1:8080/_/health')==(0,b'{"status": "ok"}')
    return dict(dockerports=f'{addr}:8080', docker=f'localhost:{port}')[norenyekind]

@pytest.fixture
def norenyeclient(request, norenyeaddr):
    return lambda:http.client.HTTPConnection(norenyeaddr)

@pytest.fixture
def norenyeconfig(request, norenyekind):
    if norenyekind == 'process':
        norenyeprocess = request.getfixturevalue('norenyeprocess')
        srvroot = py.path.local(norenyeprocess.server_root)
        return lambda:json.loads(srvroot.join('norenye.json').read_text('utf8'))
    norenye_test_container = request.getfixturevalue('norenye_test_container')
    norenyeaddr = request.getfixturevalue('norenyeaddr')
    return lambda:json.loads(norenye_test_container.get_files('/etc/nginx/norenye.json')['norenye.json'])

def pytest_addoption(parser):
    parser.addoption(
        "--norenye", action="store", default="docker", choices=("docker", "dockerports", "process"),
        help="how to run/connect to nginx with norenye: docker, dockerports, process",
    )

@pytest.fixture
def norenyekind(request):
    return request.config.getoption("--norenye")
