import http.client
import json
import pytest
import pytest_docker_tools as ptdt

norenye_test_image = ptdt.build(
    path='.',
)

norenye_test_container = ptdt.container(
    image='{norenye_test_image.id}',
    environment={},
    ports={'8080/tcp': None},
)

@pytest.fixture
def localclient(norenye_test_container):
    port = norenye_test_container.ports['8080/tcp'][0]
    assert norenye_test_container.exec_run('curl -s http://127.0.0.1:8080/_/health')==(0,b'{"status": "ok"}')
    return lambda:http.client.HTTPConnection(f'localhost:{port}')

@pytest.fixture
def dckhostclient(norenye_test_container):
    addr = norenye_test_container.ips.primary
    assert norenye_test_container.exec_run('curl -s http://127.0.0.1:8080/_/health')==(0,b'{"status": "ok"}')
    return lambda:http.client.HTTPConnection(f'{addr}:8080')

@pytest.fixture
def norenyeconfig(norenye_test_container):
    return lambda:json.loads(norenye_test_container.get_files('/etc/nginx/norenye.json')['norenye.json'])

@pytest.fixture
def norenyeclient(request, localclient, dckhostclient):
    return dict(localclient=localclient, dckhostclient=dckhostclient)[request.param]
