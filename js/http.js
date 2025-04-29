// [qya] nórenyë quettaron ar i hauta quettaron

// polyfils {
if (!Object.fromEntries)
  Object.fromEntries = (l) =>
    l.reduce((o, it) => Object.assign(o, { [it[0]]: it[1] }), {});
// }

const crypto = require("crypto");
const fs = require("fs");
const qs = require("querystring");

if (new Date().getFullYear() >= 2099) {
  ngx.log(ngx.ERR, "WARNING: Pending deprecation of norenye.js module in front of epoch end.");
}
//ngx.log(ngx.ERR, 'globalThis='+njs.dump(globalThis));

if (!globalThis.envlist)
  // normally passed from js_preload_object statement
  globalThis.envlist = JSON.parse(
    fs.readFileSync("/etc/nginx/dre/envlist.json", { encoding: "utf8" }),
  );
if (!globalThis.hostcfg)
  // normally passed from js_preload_object statement
  globalThis.hostcfg = { app: { "": "target" }, rev: [], use_mask: false };
const cookielist = globalThis.hostcfg.use_mask
  ? Object.keys(globalThis.hostcfg.app).filter((n) => n)
  : null;
globalThis.envmap = envlist2map(envlist);

function envlist2map(envlist) {
  // Using Array.prototype.map.call because list loaded from js_preload_object is sealed.
  var res;
  if (!envlist.length)
    envlist = [{ name: "default", target: "http://127.0.0.1/_/fail" }];
  res = Object.assign(
    Object.fromEntries(
      Array.prototype.map.call(envlist, (env) => [env.name, env]),
    ),
    Object.fromEntries(
      Array.prototype.map.call(envlist, (env) => [envhash(env), env]),
    ),
  );
  if (!("default" in res)) res.default = envlist[0];
  return res;
}

function envhash(env) {
  // const hash_data = `${env.name}:${env.target}`;
  // const hash_data = JSON.stringify(Object.fromEntries(Object.entries(env).sort()));
  const hash_data = env.name;
  return crypto.createHash("md5").update(hash_data, "utf8").digest("base64");
}

function getenv(r) {
  return envmap[r.variables.cookie_env] || null;
}

function getenvtarget(r) {
  var env = getenv(r) || {
    target: `https://${
      hostcfg.frontend || r.variables.http_host
    }/_/redirect?env=_`,
  };
  var app =
    hostcfg.app[r.variables.http_host] ||
    hostcfg.app[""] ||
    hostcfg.app[hostcfg.frontend || ""] ||
    "target";
  var res = env[app] || env.target;
  if (!res.includes("/")) res = `https://${res}`;
  return res;
}

function getenvfail(r) {
  var env = getenv(r);
  var res = Number(!env);
  //ngx.log(ngx.ERR, `getenvfail: env=${JSON.stringify(env)}, res=${res}`);
  return res;
}

function getenvhost(r) {
  var env = getenv(r) || {
    target: `https://${hostcfg.frontend || r.variables.http_host}/_/`,
  };
  var app =
    hostcfg.app[r.variables.http_host] ||
    hostcfg.app[""] ||
    hostcfg.app[hostcfg.frontend || ""] ||
    "target";
  var hosts = Array.prototype.filter.call(
    hostcfg.rev,
    (it) => it[1] === r.variables.http_host,
  );
  if (hosts.length === 0)
    hosts = hostcfg.rev.filter((it) => it[1] === hostcfg.frontend);
  var res = hosts[0][0] || r.variables.http_host;
  return res;
}

function getfronthost(r) {
  return hostcfg.frontend || r.variables.http_host;
}

function check_token(r) {
  if (!hostcfg.token_hash) return true;
  var req_token = r.variables.arg_token || "";
  const auth_info = (r.headersIn["authorization"] || "").split(" ");
  if (auth_info[0].toLowerCase() == "bearer") req_token = auth_info[1];
  const req_token_hash = crypto
    .createHash("md5")
    .update(req_token, "utf8")
    .digest("base64");
  return req_token_hash === hostcfg.token_hash;
}

async function jsonpage(r) {
  const fname = r.uri.split("?")[0].split("/").reverse()[0];
  const auth = check_token(r);
  if (
    !auth &&
    (r.method === "POST" || (r.method === "GET" && fname !== "envlist.json"))
  ) {
    r.status = 401;
    r.headersOut["WWW-Authenticate"] = 'Bearer app="dre-switch"';
    r.sendHeader();
    r.finish();
    return;
  }

  if (fname === "envlist.json" && r.method === "POST") {
    let op = "post";
    var changed = false;
    try {
      op = "JSON.parse";
      const new_envlist = JSON.parse(r.requestText);
      changed = globalThis.envlist != new_envlist;
      ngx.log(
        ngx.ERR,
        `jsonpage: ${JSON.stringify(envlist)} => ${JSON.stringify(
          new_envlist,
        )}${changed ? " (changed)" : " (unchanged)"}`,
      );
      op = "replace";
      globalThis.envlist = new_envlist;
      op = "envlist2map";
      globalThis.envmap = envlist2map(envlist);
      op = "fs.writeFileSync";
      fs.writeFileSync("/etc/nginx/dre/envlist.json", r.requestText, {
        encoding: "utf8",
      });
      if (changed) {
        op = "fs.writeFileSync (fresh flag)";
        fs.writeFileSync("/etc/nginx/dre/envlist.fresh", "", {
          encoding: "utf8",
        });
      }
    } catch (e) {
      ngx.log(ngx.ERR, `jsonpage: POST error in ${op}: ${e}`);
      throw e;
    }
    r.status = 201;
    r.sendHeader();
    r.finish();
    return;
  }

  if (r.method !== "GET") {
    ngx.log(
      ngx.ERR,
      `jsonpage: method=${
        r.method
      }, requestText=${typeof r.requestText}, requestText.length=${
        (r.requestText || "").length
      }`,
    );
    r.status = 405;
    r.sendHeader();
    r.finish();
    return;
  }

  ngx.log(ngx.ERR, `jsonpage: ${r.method} ${r.uri}, fname=${fname}`);

  var res = {};
  if (fname === "envlist.json") {
    res = envlist;
  } else if (fname === "envmap.json") {
    res = envmap;
  } else if (fname === "hostcfg.json") {
    res = Object.assign({}, hostcfg);
    //delete res.token;
  } else if (fname === "cookielist.json") {
    res = cookielist;
  } else {
    r.status = 404;
    r.sendHeader();
    r.finish();
    return;
  }
  res = JSON.stringify(res).replace(
    hostcfg.token || "@@@skipped@@@",
    "@@@skipped@@@",
  );
  r.status = 200;
  r.headersOut["Content-Type"] = "application/json; chatset=utf-8";
  r.headersOut["Content-Length"] = String(res.length);
  r.sendHeader();
  r.send(res);
  r.finish();
}

async function listpage(r) {
  let res = "",
    cur;
  var app =
    hostcfg.app[r.variables.http_host] ||
    hostcfg.app[""] ||
    hostcfg.app[hostcfg.frontend || ""] ||
    "target";

  res +=
    '<html><head><title>Select env from list</title><link rel="stylesheet" href="https://unpkg.com/missing.css@1.1.1"><link rel="stylesheet" href="selector.css"/></head><body>\n<ul>';
  cur = getenv(r);
  res += Array.prototype.map
    .call(
      envlist,
      (env) =>
        `<li>${
          cur && env.name == cur.name ? "<b>" : ""
        }<a href="redirect?env=${encodeURIComponent(env.name)}">${
          env.name
        }</a> (${env[app] || env.target})${
          cur && env.name == cur.name ? "</b>" : ""
        }${Array(
          (env.tags || []) + (cur && env.name == cur.name ? ["current"] : []),
        )
          .filter((tag) => !!tag)
          .map(
            (tag) =>
              `<v-h>(</v-h><chip${
                tag == "current"
                  ? ' class="ok"'
                  : tag.includes("@")
                    ? ' class="warn"'
                    : ""
              }>${tag}</chip><v-h>)</v-h>`,
          )
          .join(", ")}</li>`,
    )
    .join("\n");
  res += "</ul>\n</body></html>\n";

  r.status = 200;
  r.headersOut["Content-Type"] = "text/html; chatset=utf-8";
  r.headersOut["Content-Length"] = String(res.length);
  r.sendHeader();
  r.send(res);
  r.finish();
}

function idxflag(i) {
  return i > 0 ? 2 << (i - 1) : 1;
}

async function redirectpage(r) {
  let env, nexturl;
  const fronthost = hostcfg.frontend || r.variables.http_host;

  ngx.log(
    ngx.ERR,
    `redirectpage: ${r.method} ${r.uri}, env=${r.args.env} of ${JSON.stringify(
      Array.prototype.map.call(envlist, (env) => env.name),
    )}`,
  );
  env = envmap[r.args.env];
  nexturl = fronthost;
  if (hostcfg.use_mask) {
    let flags = parseInt(r.args.f, 16) || 0;
    if (cookielist.length) {
      const current = cookielist.indexOf(r.variables.http_host);
      if (current >= 0) flags = (flags || 0) | idxflag(current);
      const needed = cookielist.filter((n, i) => !(idxflag(i) & (flags || 0)));
      if (needed.length)
        nexturl = `${needed[0]}/_/redirect?env=${envhash(
          env,
        )}&f=${flags.toString(16)}`;
    }
  }

  r.status = 307;
  r.headersOut["Set-Cookie"] = `env=${envhash(
    env,
  )}; Expires=Fri, 01 Jan 2100 00:00:00 +0000; Path=/; domain=${fronthost}; HttpOnly`;
  if (env) r.headersOut["Location"] = `${r.variables.scheme}://${nexturl}`;
  else r.headersOut["Location"] = `${r.variables.scheme}://${nexturl}/_/`;
  r.sendHeader();
  r.finish();
}

async function failpage(r) {
  var res = Object.keys(envmap).join("\n") + "\n";
  r.status = 200;
  r.headersOut["Content-Type"] = "text/plain; charset=utf-8";
  r.headersOut["Content-Length"] = String(res.length);
  r.sendHeader();
  r.send(res);
  r.finish();
}

export default {
  jsonpage,
  listpage,
  redirectpage,
  failpage,
  getenvtarget,
  getenvfail,
  getenvhost,
  getfronthost,
};
