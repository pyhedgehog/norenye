// [qya] nórenyë quettaron ar i hauta quettaron

// polyfils {
if (!Object.fromEntries)
  Object.fromEntries = (l) =>
    l.reduce((o, it) => Object.assign(o, { [it[0]]: it[1] }), {});
if (!Object.fromKeys)
  Object.fromKeys = (l) =>
    Object.fromEntries(Array.prototype.map.call(l, (i) => [i, null]));
if (!Array.prototype.flat)
  Array.prototype.flat = function flat(depth) {
      depth = isNaN(depth) ? 1 : Number(depth);
      return depth ? this.reduce(function(res, cur) {
        if (Array.isArray(cur)) {
          res.push.apply(res, flat.call(cur, depth-1));
        } else {
          res.push(cur);
        }
        return res;
      }, []) : this.slice();
    };
// }

import crypto from 'crypto';
import qs from 'querystring';
import fs from 'fs';
//const crypto = require("crypto");
//const fs = require("fs");
//const qs = require("querystring");

const default_template = {
  "error": "<html><head><title>Select env for host $host</title></head><body>\n<p>$error</p></body></html>",
  "head": "<html><head><title>Select env for host $host</title></head><body>\n<ul>",
  "item": "<li><a href=\"$redirect_url\">$service</a></li>\n",
  "cur-item": "<li><b><a href=\"$redirect_url\">$service</a></b></li>\n",
  "tail": "</ul>\n</body></html>\n",
  "tag": '$tag',
  "tag-sep": ", "
};
const config_placeholder = {status:0,services:null,tokens:null,read_token:false,template:null,metadata:null,writeback:null,name:null};
const service_placeholder = {target:null,hosts:null,url:null,secrets:null,metadata:null};
const nocache = Symbol('nocache');

if (new Date().getFullYear() >= 2099) { // Search for "Set-Cookie" to understand reason.
  ngx.log(ngx.ERR, "WARNING: Pending deprecation of norenye.js module in front of epoch end.");
}

function copy(o, keys) {
  if(keys !== undefined)
    return Object.fromEntries(keys.map((k)=>[k,o[k]]));
  return Object.fromEntries(Object.entries(o));
}

function boolparam(v) {
  return Boolean(v&&v!='0'&&v!='no'&&v!='false');
}

function errorconfig(errstring) {
  return enrichconfig({
      status: 1,
      services: {},
      metadata: errstring,
      template: {
        head: "<html><title>Error</title><body><p>$meta</p></body></html>", tail: "", item: ""
      },
    });
}

function ro_url(u) {
  if(!u) return u;
  if(globalThis.URL && URL.canParse(u)) {
    var uo = new URL(u);
    uo.username = '';
    uo.password = '';
    return String(uo);
  }
  return String(u).replace(/(?<=\/)[^@/]*@/, '');
}

function enrichtoken(config, token, rights) {
  config.tokens[token] = Object.assign({}, config.tokens[token], rights);
}

function enrichhosts(hosts) {
  if((typeof(hosts) !== 'object') || (hosts === null))
    return undefined;
  if(Array.isArray(hosts))
    hosts = Object.fromKeys(hosts);
  return hosts;
}

function enrichservice(svc, svcname, config) {
  var svcname,svcobj;
  if((typeof(svc) !== 'object') || (svc === null) || Array.isArray(svc))
    return undefined;
  if(!svc.target)
    return undefined;
  svcobj = Object.assign(service_placeholder,{secrets:[],metadata:null},svc);
  if(svcobj.name) {
    if(svcname && svcobj.name && (svcname != svcobj.name))
      ngx.log(ngx.ERR, `WARNING: names doesn't match for service ${svcname} != ${svcobj.name}.`);
    svcname = svcname || svcobj.name;
    delete svcobj.name;
  }
  if(svcobj.token) {
    enrichtoken(config, svcobj.token, {[svcname]:"all"});
    delete svcobj.token;
  }
  svcobj.hosts = enrichhosts(svcobj.hosts);
  if(!Array.isArray(svcobj.secrets))
    svcobj.secrets = [];
  svcobj.secrets = svcobj.secrets.map(String);
  svcobj = Object.fromEntries(Object.entries(svcobj).filter((it) => it[0] in service_placeholder));
  if(svcobj.secrets.length === 0)
    delete svcobj.secrets;
  return [svcname, svcobj];
}

function enrichtemplate(tmpl) {
  if(typeof(tmpl)==='string')
    tmpl = {head: tmpl};
  if((typeof(tmpl)!=='object') || (tmpl===null))
    tmpl = Object.assign({}, default_template);
  tmpl = Object.fromEntries(Array.prototype.map.call(Object.entries(tmpl),
      (it)=>[it[0],String(it[1]===null?"":it[1])]).filter((it) => it[0] in default_template));
  if(!tmpl.error)
    tmpl.error = default_template.error;
  if(!tmpl.head && !tmpl.tail) {
    tmpl.head = default_template.head;
    tmpl.tail = default_template.tail;
  }
  if(!tmpl.head)
    tmpl.head = "";
  if(!tmpl.tail)
    tmpl.tail = "";
  if(!tmpl.item && !tmpl['cur-item']) {
    tmpl.item = default_template.item;
    tmpl['cur-item'] = default_template['cur-item'];
  }
  if(!tmpl.item)
    tmpl.item = '';
  if(!tmpl['cur-item'])
    tmpl['cur-item'] = tmpl.item;
  if(!tmpl['item-sep'])
    tmpl['item-sep'] = default_template['item-sep'];
  var want_tags = Boolean((tmpl.item+tmpl['cur-item']).match(/\$tags(\W|$)/));
  if(want_tags) {
    if(!tmpl.tag)
      tmpl.tag = default_template.tag
    if(!tmpl['tag-sep'])
      tmpl['tag-sep'] = default_template['tag-sep'];
  } else {
    if('tag' in tmpl)
      delete tmpl.tag;
    if('tag-sep' in tmpl)
      delete tmpl['tag-sep'];
  }
  return tmpl;
}

function enrichconfig(config) {
  if(typeof(config) != "object")
    return errorconfig("Norenye config must be object.")
  config = Object.assign({}, config_placeholder, config);
  if(typeof(config.tokens)==='string')
    config.tokens = config.tokens.split(',');
  if(!('tokens' in config) || (typeof(config.tokens)!=='object') || (config.tokens===null)) {
    config.tokens = {};
  }
  if(Array.isArray(config.tokens)) {
    config.tokens = Object.fromKeys(config.tokens);
  }
  config.tokens = Object.fromEntries(Array.prototype.map.call(Object.entries(config.tokens),
      (it, i) => {console.log(`enrichconfig.tokens[${i}]=${it}`);return [it[0], it[1] || {"*":"all"}];}));
  if(config.token) {
    enrichtoken(config, config.token, {"*":"all"});
    delete config.token;
  }
  if(config.read_token) {
    if(typeof(config.read_token)=='string')
      enrichtoken(config, config.read_token, {"*":"read"});
    config.read_token = Boolean(config.read_token);
  } else
    delete config.read_token;
  config.status = Number(config.status || 0);
  if(config.writeback) {
    if(typeof(config.writeback)!=='string')
      config.writeback = config.name;
  } else
    delete config.writeback;
  if(!('services' in config))
    config.services = {};
  if(typeof(config.services)=='string')
    config.services = config.services.split(',');
  if(Array.isArray(config.services)) {
    config.services = Object.fromEntries(Array.prototype.map.call(config.services,
        (svc) => enrichservice(svc, null, config)).filter(it=>it))
  } else {
    config.services = Object.fromEntries(Array.prototype.map.call(Object.entries(config.services),
        (it) => enrichservice(it[1], it[0], config)).filter(it=>it));
  }
  if(!('metadata' in config))
    config.metadata = null;
  config.template = enrichtemplate(config.template);
  config = Object.fromEntries(Object.entries(config).filter((it) => it[0] in config_placeholder));
  return config;
}

function readconfig(config_fn) {
  var config_str;
  if(!fs.lstatSync(config_fn,{throwIfNoEntry:false}))
    return errorconfig(`Can't find config ${JSON.stringify(config_fn)}.`);
  try {
    config_str = fs.readFileSync(config_fn, { encoding: "utf8" });
  } catch(e) {
    return errorconfig(`Can't read config ${JSON.stringify(config_fn)}: ${e.message}`);
  }
  try {
    var config = JSON.parse(config_str);
    return Object.assign(config, {status:2});
  } catch(e) {
    return errorconfig(`Can't parse config ${JSON.stringify(config_fn)}: ${e.message}`);
  }
}

function writeconfig(config) {
  if(!config.writeback)
    throw new Error('Undefined config.writeback');
  var config1 = Object.assign({}, config);
  delete config1.status;
  delete config1.name;
  ngx.log(ngx.ERR, `Writing to ${config.writeback}.`)
  fs.writeFileSync(config.writeback, JSON.stringify(config1), { encoding: "utf8" });
}

function getconfigfile(r) {
  return r.variables.norenye_config || ngx.conf_prefix+"/norenye.json";
}

function setcache(r, config) {
  var cache_name = r.variables.norenye_shared_dict || 'norenye';
  if(!(cache_name in ngx.shared))
    return;
  ngx.shared[cache_name].set(config.name, JSON.stringify(config));
}

function getcache(r, config_fn) {
  var cache_name = r.variables.norenye_shared_dict || 'norenye';
  if(!(cache_name in ngx.shared))
    return nocache;
  if(!ngx.shared[cache_name].has(config_fn))
    return null;
  return JSON.parse(ngx.shared[cache_name].get(config_fn));
}

function getconfig(r) {
  var config_fn = getconfigfile(r);
  var config = getcache(r, config_fn);
  var cache_absent = config === nocache;
  if(config === null || cache_absent) {
    var config0 = readconfig(config_fn);
    if(typeof(config0.writeback) === 'string') {
      var config1 = readconfig(config0.writeback);
      if(config1.status > 1)
        config0 = config1;
    }
    config = enrichconfig(Object.assign({}, config0, {name:config_fn}));
    if(config.status < 2)
      return config;
    if(!config.writeback && cache_absent) {
      ngx.log(ngx.ERR, "WARNING: Unoptimal config - no norenye_shared_dict configured and writeback disabled in config.");
    }
    if(config.writeback && config != config0)
      writeconfig(config);
    setcache(r, config);
  }
  return config;
}

function onconfigchange(r, config) {
  setcache(r, config);
  if(config.writeback)
    writeconfig(config);
}

async function periodic(r) {
  var config = getconfig(r), urls=[], dirty=false;
  Object.entries(config.services).map(function(it) {
    var name=it[0],svc=it[1];
    if(svc.url)
      urls.push({name,url:svc.url});
  });
  for(var i in urls) {
    try {
      var name=urls[i].name, url=urls[i].url;
      var hosts = await (await ngx.fetch(url)).json();
      if(typeof(hosts)!='object' || hosts===null)
        throw new Error(`Invalid hosts type ${(hosts===null)?'null':typeof(hosts)}`);
      hosts = enrichhosts(hosts);
      if(hosts != config.services[name].hosts) {
        config.services[name].hosts = hosts;
        dirty = true;
      }
    } catch(e) {
      ngx.log(ngx.ERR, `ERROR: Unable to fetch hosts for service ${name} from ${url}: ${e}`);
    }
  }
  if(dirty) {
    onconfigchange(r, config);
  }
}

function getsessionservicename(r) {
  var norenye_cookie = r.variables.norenye_cookie || 'norenye';
  return r.variables['cookie_'+norenye_cookie];
}

function getsessionservice(r, config, service_name, return_error) {
  if(!config)
    throw new Error("Internal error (no config)");
  if(!service_name)
    service_name = getsessionservicename(r);
  var service = null;
  if(service_name) {
    service = config.services[service_name] || null;
    if(!!service)
      service.name = service_name;
    else if(return_error)
      return {error:'no_service', name:service_name};
    else
      ngx.log(ngx.ERR, `Norenye cookie set to ${service_name}, but there are no such service configured.`);
  } else if(return_error)
    return {error:'no_cookie', name:service_name};
  if(service && !(r.variables.host in service.hosts)) {
    if(return_error)
      return {error:'no_host', name:service_name};
    ngx.log(ngx.ERR, `Norenye cookie set to ${service_name}, but this service has no host ${r.variables.host} configured.`);
    service = null;
  }
  return service;
}

function getfail(r) {
  var config = getconfig(r);
  var service = getsessionservice(r, config, null, true);
  if(service.error && boolparam(r.variables.norenye_xerror))
    r.headersOut['X-Norenye-Error'] = String(service.error);
  return Number(Boolean(service.error));
}

function gettarget(r) {
  var config = getconfig(r);
  var service = getsessionservice(r, config);
  return (service||{}).target||'';
}

async function sendjson(r, res, postprocess) {
  var indent = (r.variables.arg_pretty)?2:undefined;
  var res = JSON.stringify(res, null, indent);
  if(postprocess)
    res = await postprocess(res);
  r.headersOut['Content-Type'] = "application/javascript";
  r.return(res.error?401:200, res);
}

async function configjson(r, config) {
  if(!config)
    config = getconfig(r);

  await sendjson(r, config);
}

async function public_configjson(r, config) {
  if(!config)
    config = getconfig(r);

  var secrets = [Object.keys(config.tokens), Object.values(config.services).map((s)=>s.secrets)].flat().filter((o)=>o);
  var res = copy(config);
  delete res.tokens;
  delete res.status;
  delete res.name;
  if(res.writeback)
    res.writeback = true;
  res.services = Object.fromEntries(Object.entries(res.services).map((it)=>{
      var svcobj = it[1];
      delete svcobj.secrets;
      svcobj.target = ro_url(svcobj.target);
      if(svcobj.url)
        svcobj.url = ro_url(svcobj.url);
      return it;
    }));
  await sendjson(r, res, function(str) {
    secrets.forEach((sec)=>{
      str = str.replace(sec, '@@@skip@@@');
    });
    return str;
  });
}

function gethostinfo(config, host) {
  if(!config)
    throw new Error("Internal error (no config)");
  var services = {};
  Object.entries(config.services).forEach((it)=>{
    var name=it[0],svcobj=it[1];
    if(host in svcobj.hosts) {
      services[name] = {service:svcobj.metadata, host:svcobj.hosts[host]}
    }
  });
  var nservices = Object.keys(services).length;
  if(nservices===0)
    return {error:"No services for host "+String(host)};
  var res = {services: services};
  if(nservices===1)
    res.single = Object.keys(services)[0];
  return res;
}

async function indexjson(r, config) {
  if(!config)
    config = getconfig(r);

  var service_name = getsessionservicename(r);
  var res = gethostinfo(config, r.variables.host);
  if(service_name in (res.services||{}))
    res.services[service_name].current = true;
  await sendjson(r, res);
}

async function sessionjson(r, config) {
  if(!config)
    config = getconfig(r);
  var service_name = getsessionservicename(r);
  var service = getsessionservice(r, config, service_name);

  var res = {fail:Number(!service), target:(service||{}).target||'', service:service_name};
  await sendjson(r, res);
}

function apply_template(tmpl, vars) {
  Object.entries(vars||{}).forEach((it)=>{
    var k=it[0],v=it[1];
    if(typeof(v)!=='string')v=JSON.stringify(v);
    tmpl = tmpl.replace('$'+k, v);
  });
  return tmpl;
}

function getredirectbase(r, config) {
  if(!config)
    throw new Error("Internal error (no config)");
  return String(r.variables.norenye_uri||'/_/')+'redirect?set=';
}

async function indexhtml(r, config) {
  if(!config)
    config = getconfig(r);
  var service_name = getsessionservicename(r);
  var res = gethostinfo(config, r.variables.host);
  var services = res.services||{};
  if(service_name in services)
    res.services[service_name].current = true;
  var topvars = {meta:config.metadata,host:r.variables.host,services:String(Object.keys(services)),services_json:services};
  r.headersOut["Content-Type"] = "text/html; chatset=utf-8";
  var output='', redirectbase=getredirectbase(r, config);
  if(res.error) {
    topvars.error = res.error;
    return r.return(401, apply_template(config.template.error, topvars));
  }
  output += apply_template(config.template.head, topvars);
  Object.entries(res.services).forEach((it)=>{
    var itemvars = Object.assign({}, topvars, {service:it[0],service_meta:it[1].service,host_meta:it[1].host,current:(it[0]==service_name),redirect_url:redirectbase+it[0]});
    if(itemvars.current)
      output += apply_template(config.template['cur-item'], itemvars);
    else
      output += apply_template(config.template.item, itemvars);
  });
  output += apply_template(config.template.tail, topvars);
  return r.return(200, output);
}

async function failpage(r, config, error, status) {
  if(!config)
    config = getconfig(r);
  var res = gethostinfo(config, r.variables.host);
  var services = res.services||{};
  var topvars = {meta:config.metadata,host:r.variables.host,services:String(Object.keys(services)),services_json:services,error:error};
  r.headersOut["Content-Type"] = "text/html; chatset=utf-8";
  return r.return(status||401, apply_template(config.template.error, topvars));
}

async function redirectpage(r, config) {
  if(!config)
    config = getconfig(r);
  var uri = r.variables.norenye_redirect || '/';
  var service_name = r.variables.arg_set;
  var service = getsessionservice(r, config, service_name, true);
  var error = 'no_set_arg';
  var norenye_cookie = r.variables.norenye_cookie || 'norenye';
  ngx.log(ngx.INFO, 'service='+JSON.stringify({service_name,service}))
  if(service.error) {
    error = service.error;
    service = null;
  }
  if(service_name && service)
    r.headersOut["Set-Cookie"] = `${norenye_cookie}=${service_name}; Expires=Fri, 01 Jan 2100 00:00:00 +0000; Path=/; HttpOnly`;
  else {
    if(boolparam(r.variables.norenye_xerror))
      r.headersOut["X-Norenye-Error"] = String(error);
    uri = r.variables.norenye_uri||'/_/';
    delete r.variables.arg_url;
  }
  r.headersOut["Location"] = r.variables.arg_url || `${r.variables.scheme}://${r.variables.http_host}${uri}`;
  r.return(307, '');
}

async function public_api(r, config) {
  var baseuri = r.variables.norenye_uri||'/_/';
  var baselen = baseuri.length;
  var uri = r.uri;
  if(uri.startsWith(baseuri))
    uri = uri.slice(baselen);
  uri = uri.split('?')[0];
  if(uri === 'redirect')
    return await redirectpage(r, config);
  if(uri === 'index.json')
    return await indexjson(r, config);
  if((uri === '') || (uri === 'index.html'))
    return await indexhtml(r, config);
  return await failpage(r, config, `Unknown URL ${r.uri.split('?')[0]}.`, 404);
}

async function api(r, config) {
  var baseuri = r.variables.norenye_uri||'/_/';
  var baselen = baseuri.length;
  var uri = r.uri;
  if(uri.startsWith(baseuri))
    uri = uri.slice(baselen);
  uri = uri.split('?')[0];
  if(uri === 'redirect')
    return await redirectpage(r, config);
  if(uri === 'index.json')
    return await indexjson(r, config);
  if((uri === '') || (uri === 'index.html'))
    return await indexhtml(r, config);
  if(uri === 'debug.json')
    return await dbgpage(r);
  return await failpage(r, config, `Unknown URL ${r.uri.split('?')[0]}.`, 404);
}

async function admin_api(r, config) {
  var baseuri = r.variables.norenye_uri||'/_/';
  var baselen = baseuri.length;
  var baseurl = `${r.variables.scheme}://${r.variables.http_host}${baseuri}`;
  var uri = r.uri, uriparts;
  if(uri.startsWith(baseuri))
    uri = uri.slice(baselen);
  uri = uri.split('?')[0];
  uriparts = uri.split('/').filter((s)=>(s));
  if(uri === '') {
    var res = {
      config_url:`${baseurl}config.json`,
      local_services_url:`${baseurl}service/`,
      service_info_url:`${baseurl}service/{service}`,
      service_host_url:`${baseurl}service/{service}/{host}`
    };
    return await sendjson(r, res);
  }
  if(uri === 'config.json')
    return await configjson(r, config);
  if(uriparts[0] === 'service' && uriparts.length===1)
    return await services_json(r, config);
  if(uri === 'debug.json')
    return await dbgpage(r);
  return await failpage(r, config, `Unknown URL ${r.uri.split('?')[0]}.`, 404);
}

async function dbgpage(r) {
  ngx.log(ngx.ERR, `ngx.error_log_path = ${ngx.error_log_path}`);
  var res = {error_log_path:ngx.error_log_path,
      req:Object.assign({},r,{variables:copy(r.variables,['host','args','http_host','http_user_agent','http_accept'])}),
      worker_id:ngx.worker_id,
      pid:process.pid,
      ppid:process.ppid,
      env:copy(process.env),
      argv:process.argv,
      njs_engine:njs.engine,
      njs_version:njs.version,
      ngx_version:ngx.version,
      ngx:copy(ngx),
      memoryStats:njs.memoryStats
    };
  await sendjson(r, res);
}

export default {
  getfail,
  gettarget,
  configjson,
  public_configjson,
  indexjson,
  indexhtml,
  public_api,
  api,
  admin_api,
  sessionjson,
  dbgpage,
  errorconfig,
  ro_url,
};
