# norenye

Module for nginx that can be used to setup many-to-many mapping from virtual host to proxy_pass target.

Module name "nórenyë" can be translated as "dispatcher" (in the sense of "sorting mechanism").

## Client view

From client view all virtual hosts are separate.
There can be several "services" behind any virtual host.
If there are only one or client already selected "prefered" service all requests (except special - /_/ in example config) will be forwarded to it else selection page on /_/ will be shown.
Selection page sets cookie with prefered service.

## Site admin view

You can have services that want's to take several virtual hosts from shared namespace.
If services stuck with same virtual host name you want to allow user to choose which one it want to use. Usually it's prod/dev selection or something like AB-testing.

### Nginx configuration

Somewhere under `nginx.conf`:
```
load_module modules/ngx_http_js_module.so;
http {
js_path /opt/norenye/js/;  # path where you've installed norenye.js:
js_import norenye.js;
server {
    server_name *.example.com;
    js_set $norenye_fail norenye.getfail;  # Boolean. Set to 1 if no norenye cookie set and no default target for this host.
    js_set $norenye_target norenye.getenvtarget;  # URL. Should be passed to proxy_pass.
    set $norenye_config '/etc/nginx/snippets/norenye.json';  # path to config
    js_shared_dict_zone zone=norenye:1M;  # at least size of config
    set $norenye_shared_dict norenye;  # must match `js_shared_dict_zone` directive above
    location /_/static/ {
        alias "/opt/norenye/static/";  # path to css and other files you want to 
    }
    location @periodic {
        js_periodic norenye.periodic interval=60s;  # update hosts from `service.url` (see config below)
    }
    location /_/ {
        js_content norenye.api;
        # If you want to expose api via another interface/vhost replace with:
        #   js_content norenye.public_api;  # limit api to /_/, /_/index.html and /_/index.json
        #   js_content norenye.public_html;  # limit api to /_/, /_/index.html
        #   js_content norenye.admin_api;  # all api except /_/, /_/index.html and /_/index.json, '/_/' will return list of API endpoints, require token disregarding "read_token" config.
        # you cat replace '/_/' in location with /something-other/ and:
        #   set $norenye_uri /something-other/;
        # also you can patch where `/-/redirect` will redirect:
        #   set $norenye_redirect /;
        # API:
        #   GET /_/
        #   GET /_/index.html
        #     Selection page. List of links to redirect page for each service.
        #   GET /_/index.json
        #     Selection info. Object of services with objects like {"service":<service-meta>, "host":<host-meta>} for current host in JSON format.
        #   GET /_/redirect?set=servicename
        #     Redirect page. Will set cookie and redirect to root URI.
        #   PUT /_/service/
        #     Create new service. Object match format of config except additional "name" field. Requires "admin"/"all" right for service.
        #   GET /_/service/{service-name}/
        #     List of hosts for specified service. May require authentication depending on "read_token" config.
        #   POST /_/service/{service-name}/
        #     Replace list of hosts for specified service. Requires authentication with service or global token using 'Authorization: Bearer ***' header.
        #   DELETE /_/service/{service-name}/
        #     Delete specified service. Requires "admin"/"all" right for service.
        #   GET /_/service/{service-name}/{host-name}
        #     Returns host meta. May require authentication depending on "read_token" config.
        #   PUT /_/service/{service-name}/{host-name}
        #     Add item to list of hosts for specified service. Requires at least "update" right for service.
        #   POST /_/service/{service-name}/{host-name}
        #     Update host meta. Requires at least "update" right for service.
        #   DELETE /_/service/{service-name}/{host-name}
        #     Delete item from list of hosts for specified service. Requires at least "update" right for service.
        #   GET /_/config.json
        #     Reads whole config. If not with "admin" rights tokens and url-authinfo will be skipped.
    }
    location / {
        proxy_set_header Host $host;
        if ($norenye_target) {  # You maybe want to add other options (like add_header and alike)
          proxy_pass $norenye_target;
        }
        if ($norenye_fail) {
          return 302 '/_/';
        }
    }
}
}
```

### Configuration file

Referred as `/etc/nginx/snippets/norenye.json` in sample nginx config above.

```json
{
  "services": {
    "service1": {
      "target": "http://127.0.0.1:8001",
      "hosts": [
        "svc1a.example.com",
        "svc1b.example.com",
        "svc1c.example.com",
        "svc1d.example.com",
      ]
    },
    "service2": {
      "target": "https://127.0.0.1:8002",
      "url": "https://127.0.0.1:8002/domains.json"  # must return JSON list of hosts
    },
    "service3": {
      "target": "https://127.0.0.1:8003",
      "url": "file:///etc/nginx/snippets/service3.json"  # must contains JSON list of hosts
    },
    "service4": {
      "target": "https://127.0.0.1:8004",
      "token": "token1"   # will be used to authenticate push-update of list of hosts (see `POST /_/service/{}.json`)
                          # same as `"token1": {"service4": "update"}` record in global "tokens"
    }
    "service5": {  #
      "target": "http://127.0.0.1:8005/secretstring/",
      "hosts": {
        "svc1a.example.com": {"tags": ["a1", "b2"]},   # any object that will be accessible as $host_meta
        "svc1d.example.com": null,
      },
      "secrets": ["secretstring"]  # this substring will be replaced with "***" on non-admin reads.
      "metadata": {}  # any object that will be accessible as $service_meta
    },
  },
  "template": {   # head, item, cur-item, tail. Placeholders in $variable_name form will be replaced with value. Look separate section for available variables.
    "head": "<html><head><title>Select env for host $host</title><link rel=\"stylesheet\" href=\"https://unpkg.com/missing.css@1.1.1\"><link rel=\"stylesheet\" href=\"static/selector.css\"/></head><body>\n<ul>",
    "item": "<li><a href=\"$redirect_url\" data-service="$service_meta" data-host="$host_meta">$service</a></li>\n",
    "cur-item": "<li><b><a href=\"$redirect_url\" data-service="$service_meta" data-host="$host_meta">$service</a></b></li>\n",
    "tail": "</ul>\n</body></html>\n"
  },
  "metadata": {}  # any object that will be accessible as $meta
  "token": "token2",  # same as `"token2": {"*": "all"}` record in "tokens"
  "read_token": false,  # false (or absent) - GET for JSON's available without auth,
                        # true - "token" should be used,
                        # "token3" - declares separate token, like "token3": {"*": "read"}
  "tokens": {
    "token4": {"service6":"all"},	# undefined service. You can use token to create/update/read/delete it.
    "token5": {"service4":"update"},	# You can use token to update/read it.
    "token6": {"*":"push"},		# You can use token to update any service, but not to read anything (if "read_token" set)
    "token7": {"*":"read"},		# You can use token to read any service
    "token7": {"*":"admin"},		# You can use token to do anything. Difference from "all" is that allows to read tokens. Use with care.
  },
  "writeback": true	# Save modified config back to file, or if a string, use it as a path to mutable copy, read from it, keeping original config intact. NB: Will parse twice.
}
```

### Templates

It can be just skipped and simple template will be used that doesn't uses static files or external resources.

In "head"/"tail" templates you can use only "global" variables:

- `$host` - same as nginx var
- `$services_json` - JSON-encoded object like /-/index.json returns
- `$services` - comma-separated list of service names
- `$meta` - JSON-encoded object with "metadata" field of global config

In "item"/"cur-item" templates in addition there are service-specific variables:

- `$service` - name of service
- `$redirect_url` - can be put to `<a href="$redirect_url">`
- `$service_meta` - JSON-encoded object with "metadata" field of service config
- `$host_meta` - JSON-encoded object with value of hosts mapping
- `$current` - Can be true if cookie set to current service or false otherwise
- `$tags` - If this placeholder presents in "item"/"cur-item" template that template could define additional fields "tag" and "tag-sep"

If `$tags` placeholder used and host metadata has "tags" attribute, it will be parsed:
1. Tt can be string, with tags separated by commas.
2. It can be array of strings.
3. It can be object where keys become tags and values become `$tag_meta`.

In "tag" template you can also use:

- `$tag` - name of tag
- `$tag_meta` - value of tag if host_meta.tags is object

There also can be following template entries in which placeholders will not be processed:

- `"item-sep"` - will be used to join items
- `"tag-sep"` - will be used to join tags

## Features

- List of vhosts:
  - Static (in config)
  - Dynamic (downloaded from URL)
  - Controlled (can be manipulated via API)
- Customizable UI:
  - Selector page can be templated
  - You can emit direct links to redirect page that will set cookie
- Securable:
  - Sensetive parts of API protected by tokens
  - Tokens mechanism has precise rights management
  - Sensetive parts of API can be exposed via another interface (i.e. via socket) or disabled completely
  - Default setup is secure enough.

## For developer

Tests uses [`pytest`](https://pytest.org/) and [`docker`](https://pypi.org/project/pytest-docker-tools/). Beware.

### TODO

**Before 1.0**:

- More control for "default service". To start with - priority.
- Tests:
  - Switch `norenyaclient` from `pytest.mark.parametrize` to pytest option and add process-spawn variant.
  - Write tests for all APIs.
- Autotests against different versions of Nginx/Angie + NJS/QJS.

**Future**:

- `js_body_filter` to add to site floating menu to switch services.
- Prometheus metrics.

### NOGO

- Plugins. Security is our first priority.

### Ideas for PRs

- Rewrite README. Write more docs at all.
- Write more tests.
- Implement any item in [#TODO].
