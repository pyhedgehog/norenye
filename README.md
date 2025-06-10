# norenye

Module for nginx that can be used to setup many-to-many mapping from virtual host to proxy_pass target.

Module name "nórenyë" can be translated as "dispatcher" (in the sense of "sorting mechanism").

## Client view

From client view all virtual hosts are separate.
There can be several "services" behind any virtual host.
If there are only one service or client already selected "prefered" service all requests (except special - /_/ in example config) will be forwarded to it else selection page on /_/ will be shown.
Selection page sets cookie with prefered service.

### Public API

- `GET /_/static/`
  Directory that can contain resources used in `/_/index.html` templates (styles, scripts, images, etc.).
- `GET /_/`
  `GET /_/index.html`
  Selection page. List of links to redirect page for each service. Can be customized by admin using simple templates.
- `GET /_/index.json`
  Selection info. Object of services with objects like {"service":<service-meta>, "host":<host-meta>} for current host in JSON format.
  Can be used in scripts to customize `/_/index.html` or service-specific pages.
- `GET /_/redirect?set={servicename}[&uri=/]`
  Redirect page. Will set cookie and redirect to root URI.
  Most important part of norenye ecosystem - can be used to create persistent links to specific service.
- `GET /_/health`
  Returns `{"status": "ok"}`.
- `* /*`
  If service seleted (or default one set by admin) request will be forwarded to service.
  On other case request will be redirected to `/_/`.

## Site admin view

You can have services that want's to take several virtual hosts from shared namespace.
If services stuck with same virtual host name you want to allow user to choose which one it want to use.
Usually it's prod/dev selection or something like AB-testing.

### Admin API

In addition of endpoints available in [Public API](#Public API) above there are:

- `GET /_/config.json`
  Reads whole config. If not with "admin" rights tokens and url-authinfo will be skipped.
- `PUT /_/service/`
  Create new service. Object match format of config except additional "name" field. Requires "admin"/"all" right for service.
- `GET /_/service/{service-name}/`
  List of hosts for specified service. May require authentication depending on "read_token" config.
- `POST /_/service/{service-name}/`
  Replace list of hosts for specified service. Requires authentication with service or global token using 'Authorization: Bearer ***' header.
- `DELETE /_/service/{service-name}/`
  Delete specified service. Requires "admin"/"all" right for service.
- `GET /_/service/{service-name}/{host-name}`
  Returns host meta. May require authentication depending on "read_token" config.
- `PUT /_/service/{service-name}/{host-name}`
  Add item to list of hosts for specified service. Requires at least "update" right for service.
- `POST /_/service/{service-name}/{host-name}`
  Update host meta. Requires at least "update" right for service.
- `DELETE /_/service/{service-name}/{host-name}`
  Delete item from list of hosts for specified service. Requires at least "update" right for service.

### Nginx configuration

Somewhere under `/etc/nginx/nginx.conf`:
```
env NORENYE_PERIODIC;
env NORENYE_MODE;
load_module modules/ngx_http_js_module.so;
http {
js_path /etc/nginx/js/;  # path where you've installed norenye.js:
js_import norenye.js;
js_shared_dict_zone zone=norenye:1M;  # at least size of processed config (as in `/_/config.json` with admin token)
server {
    server_name *.example.com;
    js_set $norenye_autoselected norenye.getautoselected;  # Boolean. Set to 1 if $norenye_fail=1, but there are default service.
    js_set $norenye_fail norenye.getfail;  # Boolean. Set to 1 if no norenye cookie set and no default target for this host.
    js_set $norenye_target norenye.gettarget;  # URL. Should be passed to proxy_pass.
    # See: https://github.com/nginx/njs/issues/907
    # Normal Request object can use any nginx variable,
    # but js_periodic creates pseudo-request that can see
    # only variables from core (and js) module.
    js_var $norenye_config '/etc/nginx/norenye.json';  # path to config
    js_var $norenye_shared_dict 'norenye';  # must match name in `js_shared_dict_zone` directive
    location /_/static/ {
        alias "/opt/norenye/static/";  # path to css and other files you want to
    }
    location @periodic {
        js_periodic norenye.periodic interval=60s;  # update hosts from `service.url` (see config below)
        js_periodic norenye.reloadconf interval=9999999999; # see https://github.com/nginx/njs/issues/914#issuecomment-2914869904
    }
    location = /_/health { # may be implemented by norenye.[public_]api, but static one is faster
      default_type application/json;
      return 200 '{"status": "ok"}';
    }
    location /_/ {
        js_content norenye.api;
        # If you want to expose api via another interface/vhost replace with:
        #   js_content norenye.public_api;  # limit api to /_/, /_/index.html, /_/index.json, /_/health and /_/redirect
        #   js_content norenye.public_html;  # limit api to /_/, /_/index.html, /_/health and /_/redirect. Can be useful to hide metadata.
        #   js_content norenye.admin_api;  # all api except /_/, /_/index.html, /_/index.json and /_/redirect, '/_/' will return list of API endpoints, require token disregarding "read_token" config.
        # you cat replace '/_/' in location with /something-other/ and:
        #   set $norenye_uri /something-other/;
        # also you can patch where `/-/redirect` will redirect:
        #   set $norenye_redirect /;
    }
    location / {
        proxy_set_header Host $host;
        if ($norenye_target) {  # You maybe want to add other options (like add_header and alike)
          proxy_pass $norenye_target;
        }
        if ($norenye_autoselected) {
          return 307 '/_/?uri=$uri&a=1';
        }
        if ($norenye_fail) {
          return 303 '/_/?uri=$uri';
        }
        js_content norenye.serviceforward;   # Last resort failover. See examples for other options.
    }
}
}
```

#### JS functions

TBD.

#### Nginx variables

TBD.

#### Environment variables

- `$NORENYE_PERIODIC`
  Can be set to disable runs of `norenye.periodic` without disabling it in `nginx.conf`.
- `$NORENYE_MODE`
  Mostly configures log level (and some helpful for config debugging headers).
  Defaults to `prod`. Other options are `test`, `dev`, `once`.

### Configuration file

Referred as `/etc/nginx/snippets/norenye.json` in sample nginx config above.

```json5
{
  "services": {
    "svc1": {
      "target": "http://127.0.0.1:8001",
      "hosts": [
        "svc1a.example.com",
        "svc1b.example.com",
        "svc1c.example.com",
        "svc1d.example.com",
      ]
    },
    "svc2": {
      "target": "http://127.0.0.1:8002",
      "priority": 1,
      "url": "file:///etc/nginx/svc2.json"  // must contains JSON list of hosts
    },
    "svc3": {
      "target": "http://127.0.0.1:8003/",
      "url": "http://127.0.0.1:8003/_urls.json"  // must return JSON list of hosts
    },
    "svc4": {
      "target": "https://127.0.0.1:8004",
      "token": "token1"   // will be used to authenticate push-update of list of hosts (see `POST /_/service/{}.json`)
                          // same as `"token1": {"service4": "update"}` record in global "tokens"
    },
    "svc5": {
      "target": "http://127.0.0.1:8005/secretstring/",
      "hosts": {
        "svc1a.example.com": {"tags": ["a1", "b2"]},   // any object that will be accessible as $host_meta
        "svc1d.example.com": null,
      },
      "secrets": ["secretstring"],  // this substring will be replaced with "***" on non-admin reads.
      "metadata": {}  // any object that will be accessible as $service_meta
    },
  },
  "template": {   // `head`, `item`, `cur-item`, `tail`. Placeholders in $variable_name form will be replaced with value. Look separate section for available variables.
    "head": "<html><head><title>Select env for host $host</title><link rel=\"stylesheet\" href=\"https://unpkg.com/missing.css@1.1.1\"><link rel=\"stylesheet\" href=\"static/selector.css\"/></head><body>\n<ul>",
    "item": "<li><a href=\"$redirect_url\" data-service=\"$service_meta\" data-host=\"$host_meta\">$service</a></li>",
    "cur-item": "<li><b><a href=\"$redirect_url\" data-service=\"$service_meta\" data-host=\"$host_meta\">$service</a></b></li>",
    "tail": "</ul>\n</body></html>\n"
    // There also can be `error`, `item-sep`, `tags`, `tag`, `tag-sep`.
  },
  "metadata": {},  // any object that will be accessible as $meta
  "token": "token2",  // same as `"token2": {"*": "all"}` record in "tokens"
  "read_token": false,  // false (or absent) - GET for JSON's available without auth,
                        // true - "token" should be used,
                        // "token3" - declares separate token, like "token3": {"*": "read"}
  "tokens": {
    "token4": {"service6":"all"},	// undefined service. You can use token to create/update/read/delete it.
    "token5": {"service4":"update"},	// You can use token to update/read it.
    "token6": {"*":"push"},		// You can use token to update any service, but not to read anything (if "read_token" set)
    "token7": {"*":"read"},		// You can use token to read any service
    "token7": {"*":"admin"},		// You can use token to do anything. Difference from "all" is that allows to read tokens. Use with care.
  },
  "writeback": true	// Save modified config back to file, or if a string, use it as a path to mutable copy, read from it, keeping original config intact. NB: Will parse twice.
}
```

#### Structure of config

- `"writeback"`
  Boolean or file path. Save modified config back to file, or if a string,
  use it as a path to mutable copy, read from it, keeping original config intact.
  NB: Will cause parsing twice if string.
- `"services"`
  Dictionary of services. Service object described in next [section](#Service definition).
- `"tokens"`
  Dictionary of auth token. Value of token is dictionary
  with services (or `"*"` for any service) as a key and string meaning level of rights as a value.
  Rights can be one of:
  - `"none"` — no access will be granted.
  - `"read"` — read access will be granted. For `/_/config.json` secure stripped-down form will be returned.
  - `"push"` — only changes are allowed (i.e. doesn't includes `"read"`).
  - `"update"` — `"read"`+`"push"`.
  - `"all"` — `"update"` plus create/delete.
  - `"admin"` — unlimited operations.
- `"token"`
  Simplified form of `"token": {"*": "all"}` record in `"tokens"`.
- `"read_token"`
  - `false` (or absent) - GET for JSON's available without auth
  - `true` - token with at least `"read"` right should be used for GET operations
  - `"token"` - declares separate token, like `"token": {"*": "read"}`
- `"template"`
  Dictionary of template parts. Described in separate [section](#Templates).
- `"metadata"`
  Any object. Can be used as `$meta` placeholder in templates.

#### Service definition

TBD.

#### Templates

It can be just skipped and simple template will be used that doesn't uses static files or external resources.

In "head"/"tail" templates you can use only "global" variables:

- `$host` - same as nginx var
- `$services_json` - JSON-encoded object like /-/index.json returns
- `$services` - comma-separated list of service names
- `$meta` - JSON-encoded object with "metadata" field of global config

In "error" template there also can be:

- `$error` - text of error (operation-specific)

In "item"/"cur-item"/"tags"/"no-tags" templates in addition to "global" variables there are service-specific variables:

- `$service` - name of service
- `$redirect_url` - can be put to `<a href="$redirect_url">`
- `$service_meta` - JSON-encoded object with "metadata" field of service config
- `$host_meta` - JSON-encoded object with value of hosts mapping
- `$current` - Can be true if cookie set to current service or false otherwise
- `$tags` - If this placeholder presents in "item"/"cur-item" template that template could define additional fields "tag" and "tag-sep"

If `$tags` placeholder used and service and/or host metadata has "tags" attribute, it will be parsed:

1. Tt can be string, with tags separated by commas.
2. It can be array of strings.
3. It can be object where keys become tags and values become `$tag_meta`.

If "tags" template defined it can be used to create wrapper around `$tags`.

If "no-tags" template defined it will be inserted in place of `$tags` if there are no tags for item.

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
  - Passive (read from `file:///...` URL)
  - Controlled (can be manipulated via API)
- Customizable UI:
  - Selector page can be templated
  - You can emit direct links to redirect page that will set cookie
- Securable:
  - Sensetive parts of API protected by tokens
  - Tokens mechanism has precise rights management
  - Sensetive parts of API can be exposed via another interface (i.e. via unix socket) or disabled completely
  - Default setup is secure enough
- Customizable Ops:
  - Two modes of forwarding:
    1. Variables passed to `proxy_pass`/`try_files`.
    2. Pass `location /` to `norenye.serviceforward` or just `norenye.api`.
  - Selectable prefix (aka `/_/`) for API.
  - Selectable API endpoints config:
    1. Just `norenye.api` for whole `location /_/`.
    2. Safe `norenye.public_api` or ever `norenye.public_html` (if your template doesn't uses `/_/index.json`).
    3. Separate `norenye.admin_api` can be moved to other location (with `js_set $norenye_uri ...`) or server.
    4. For precise config you can use individual functions behind each api endpoint.
       See `tests/nginx/nginx.splitapi.conf`.

## Known issues

- Nginx reload problem and workaround: https://github.com/nginx/njs/issues/914#issuecomment-2914869904
  Implemented reloadconf, but it's hard to write correct test of this problem.
- `js_engine qjs;` directive not fully supported (it generates sigfaults on workers for `js_periodic` without meaningful output).

## For developer

Tests uses [`pytest`](https://pytest.org/). Beware.

Tests can be configured via `--norenye` argument:
- `docker` or `dockerports` uses [`docker`](https://pypi.org/project/pytest-docker-tools/) plugin.
- DISABLED: `process` uses [`nginx`](https://pypi.org/project/pytest-nginx/) plugin and requires installed nginx with NJS module.
Default depends on pytest execution context.

### TODO

**Before 0.4**:
- Reintroduce "groups of hosts" from dre-switch. I.e. feature to set cookie for several hosts at once. Aka SSO.
- Test for:
  - HTTP:
    - [ ] `GET /_/_reloadconf`
  - functions:
    - [ ] getfail
    - [ ] gettarget
    - [ ] periodic
    - [ ] reloadconf
    - [ ] api
    - [ ] public_api
    - [ ] public_html
    - [ ] admin_api
    - [ ] redirectpage
    - [ ] serviceforward
    - [ ] indexhtml
    - [ ] indexjson
    - [ ] public_configjson
    - [ ] configjson
    - [ ] adminapijson
    - [ ] apiservices
    - [ ] apiservice
    - [ ] apiservicehosts
    - [ ] apihost
    - [ ] sessionjson
    - [ ] dbgpage
  - Misc:
    - [ ] `js_periodic reloadconf` on `nginx -s reload`
    - [ ] More auth tests (fails in addition to successes)

**Before 1.0**:

- Think on form of distribution. npm, apt, webi?
- Document installation.
- Improve tests.
- Support for QJS engine.
- Autotests against different versions of Nginx/Angie/OpenResty + NJS/QJS.
- More control for "default service".
- Document interface in README:
  - API functions (group by directive - js_set, js_content, js_periodic)
  - Nginx variables (with limitations - used in periodic can be `set`)
  - Attributes of `norenye.json` objects (root config, service)
- Alternative config examples:
  - Minimal (no api, no index.html, only redirect)
  - Separate (admin api via unix socket)
  - etc.
- Choose autodoc (jsdoc?) and enrich source with comments in related format

**Future**:

- Think if some parameters should be moved from metadata to separete attributes:
  - `"default"` of service
  - `"group"` of service
  - `"tags"` of host/service
- Prometheus metrics.
- OpenAPI specs (aka Swagger) with respect to `$norenye_uri`.
- Think about webpack (as soon as we've split code to modules).
- `js_body_filter` to add to site floating menu to switch services.
- Reintroduce hashed cookie. This _seems_ more secure, but user always can get list of services from /_/index.html, so it's "security by obscurity". I.e. useless.
- Tests using direct njs/qjs exec (without nginx at all). See `js/cmd.js`.
- Customize what variable should be treated as "hostname".
  Right now we use `r.variables.host` (aka `$host`),
  but there are `$http_host`, `$ssl_server_name` and so on.
- Support glob and/or regexp matching of hosts.
- Create temp token - via API and/or local file.
- Load testing.
- Test support for different services (behind proxy_pass). Prefer popular or HTTP-complicated:
  - WebDAV (Nginx/rclone)
  - `rclone serve rcd` with WebUI
  - S3 (minio/rclone)
  - Portainer
  - Saltcorn
- Document how to configure clients (i.e. for S3) to pass required cookie.
- Alternative mode of operation - via static nginx config ala map directives generated from `norenye.json`:
  ```
  map $cookie_norenye@$host $norenye_target {
    include norenye-generated-map.conf;
    default '';
  }
  map $norenye_target $norenye_fail {
    '' 1;
    default 0;
  }
  ```

### Not in scope

Things that wouldn't be implemented unless heavy reasons will be provided:

- Plugins (security is our first priority).
- Remote control from Norenye to backend services (prefer not to be bound to specific protocols).
- Several templates for different hosts/entrypoints/whatever (there are `/_/index.json` and browser-side JS for such things that may be stored in `/_/static/`).
- Gather hosts from subprocess. Bad idea - NJS has no such feature + we have API for this. At last you can expose admin API via local unix-socket server only.

### Ideas for PRs

- Rewrite README. Write more docs at all.
- Write more tests.
- Implement any item in [#TODO].
- Ideas how to implement "one-time link to specific service" (without touching cookie set).
- Ideas to improve "protocol" of `service.url`.
