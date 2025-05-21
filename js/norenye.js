// [qya] nórenyë quettaron ar i hauta quettaron

//import crypto from 'crypto';
//import qs from 'querystring';
import fs from 'fs';
import utils from 'norenye_utils.js';
import configfuncs from 'norenye_config.js';
//const crypto = require("crypto");
//const fs = require("fs");
//const qs = require("querystring");

const nocache = Symbol('nocache');
const log = utils.log;

utils.on('init', function norenye_warn_oninit(){
if((ngx||{}).worker_id === 0) {
  if(utils.runmode.dev) {
    log.warn("WARNING: You using norenye.js module in development mode (due to os env NORENYE_MODE="+utils.runmode.value+"). This may disclose sensetive info.");
  } else if(utils.runmode.test) {
    log.warn("WARNING: You using norenye.js module in test mode (due to os env NORENYE_MODE="+utils.runmode.value+"). This may disclose sensetive info.");
  }
  if (new Date().getFullYear() >= 2099) { // Search for "Set-Cookie" to understand reason.
    log.warn("WARNING: Pending deprecation of norenye.js module in front of epoch end.");
  }
}
});

var getconfigfile_iter = 1;

function getconfigfile(r) {
  //if(getconfigfile_iter>1) throw new Error("Look traceback");
  log.test(`getconfigfile${getconfigfile_iter++}(${r.variables.request_id}/${((r.parent||{}).variables||{}).request_id||''}): norenye_config=${r.variables.norenye_config||'null'}, conf_prefix=${ngx.conf_prefix||'null'}`);
  return String(r.variables.norenye_config || ngx.conf_prefix+"/norenye.json").replaceAll('//','/');
}

function setcache(r, config) {
  var cache_name = r.variables.norenye_shared_dict || 'norenye';
  if(!(cache_name in ngx.shared)) {
    log.test(`setcache: no ${cache_name} in ngx.shared`);
    return;
  }
  log.test(`setcache: writing ${config.name} to ngx.shared.${cache_name}`);
  ngx.shared[cache_name].set(config.name, JSON.stringify(config));
}

function getcache(r, config_fn) {
  var cache_name = r.variables.norenye_shared_dict || 'norenye';
  if(!(cache_name in ngx.shared)) {
    log.test(`getcache: no ${cache_name} in ngx.shared`);
    return nocache;
  }
  if(!ngx.shared[cache_name].has(config_fn)) {
    log.test(`getcache: no ${config_fn} in ngx.shared.${cache_name}`);
    return null;
  }
  var config = JSON.parse(ngx.shared[cache_name].get(config_fn));
  //log.debug(`getcache: got ${config_fn} from ngx.shared.${cache_name}: ${JSON.stringify(config)}`);
  log.debug(`getcache: got ${config_fn} from ngx.shared.${cache_name}.`);
  return config;
}

var request_config = {};

function getconfig(r) {
  if(r.variables.request_id in request_config)
    return request_config[r.variables.request_id];
  var cr = r;
  while(cr.parent) {
    cr = cr.parent;
    if(cr.variables.request_id in request_config)
      return request_config[cr.variables.request_id];
  }
  var config_fn = getconfigfile(r);
  var config = getcache(r, config_fn);
  var cache_absent = config === nocache;
  if(config === null || cache_absent) {
    var config0 = configfuncs.readconfig(config_fn);
    if(typeof(config0.writeback) === 'string') {
      var config1 = configfuncs.readconfig(config0.writeback);
      if(config1.status > 1)
        config0 = config1;
    }
    config = configfuncs.enrichconfig(Object.assign({}, config0, {name:config_fn}));
    if(config.status < 2)
      return request_config[r.variables.request_id] = config;
    if(!config.writeback && cache_absent) {
      utils.on('init', function config_warn_nocache(){
        log.warn("WARNING: Unoptimal config - no norenye_shared_dict configured and writeback disabled in config.");
      });
    }
    if(config.writeback && JSON.stringify(config) != JSON.stringify(config0))
      configfuncs.writeconfig(config);
    setcache(r, config);
  }
  return request_config[r.variables.request_id] = config;
}

function onconfigchange(r, config) {
  setcache(r, config);
  if(config.writeback)
    configfuncs.writeconfig(config);
  request_config[r.variables.request_id] = config;
}

async function periodic(r) {
  if(r[Symbol.toStringTag] !== 'PeriodicSession') {
    log.error(`ERROR: periodic() must be run from js_periodic statement.`);
    throw new Error('Invalid session type.');
  }
  if(!utils.boolparam(process.env.NORENYE_PERIODIC || '1')) {
    utils.on('init', function periodic_warn_env(){
      log.warn(`WARNING: periodic() disabled due to os env NORENYE_PERIODIC=${njs.dump(process.env.NORENYE_PERIODIC)}.`);
    });
    return;
  }
  if(utils.boolparam(r.variables.norenye_periodic_disable || '0')) {
    utils.on('init', function periodic_warn_var(){
      log.warn(`WARNING: periodic() disabled due to config var $norenye_periodic_disable=${njs.dump(r.variables.norenye_periodic_disable)}.`);
    });
    return;
  }
  var config = getconfig(r), dirty=false, nservices = Object.entries(config.services).length;
  log.debug(`periodic: config.services=${JSON.stringify(config.services)}`);
  var urls = Object.entries(config.services).map(function(it,i) {
    if(it[1].url)
      return {name:it[0],url:it[1].url};
    return null;
  }).filter((o)=>o);
  log.test(`periodic: urls=${JSON.stringify(urls)}`);
  for(var i=0;i<urls.length;i++) {
    var name=urls[i].name, url=urls[i].url, urlo=utils.urlparse(url);
    //ngx.log(ngx.ERR, `periodic: ${i}/${urls.length}/${nservices}: ${JSON.stringify(svc)}`);
    log.debug(`periodic: ${i}/${urls.length}/${nservices}: ${njs.dump(urlo)}`);
    try {
      var hosts;
      if(urlo.scheme === 'file')
        hosts = await fs.promises.readFile(urlo.path);
      else {
        var headers = new Headers({'Host':urlo.hostinfo});
        //log.debug(`periodic: headers=${njs.dump(headers)}`);
        hosts = await (await ngx.fetch(url, {headers})).json();
        log.error(`norenye.periodic: ${url}->${njs.dump(hosts)}`);
      }
      if(typeof(hosts)!='object' || hosts===null)
        throw new Error(`Invalid hosts type ${(hosts===null)?'null':typeof(hosts)}`);
      hosts = configfuncs.enrichhosts(hosts);
      if(JSON.stringify(hosts) != JSON.stringify(config.services[name].hosts)) {
        var oldhosts = config.services[name].hosts;
        config.services[name].hosts = hosts;
        log.test(`periodic: ${i}/${nservices}: update ${njs.dump(oldhosts)} -> ${JSON.stringify(hosts)}`);
        dirty = true;
      }
    } catch(e) {
      log.error(`ERROR: Unable to fetch hosts for service ${name} from ${url}: ${njs.dump(e)}`);
    }
  }
  log.debug(`periodic: dirty=${dirty}`);
  if(dirty)
    onconfigchange(r, config);
}

function getsessionservicename(r) {
  var norenye_cookie = r.variables.norenye_cookie || 'norenye';
  return r.variables['cookie_'+norenye_cookie];
}

function getsessionservice(r, config, service_name, return_error) {
  if(!config)
    throw new Error("Internal error (no config)");
  if((config.metadata || {}).error)
    return return_error?{error:config.metadata.error,name:service_name}:null;
  if(!service_name)
    service_name = getsessionservicename(r);
  var service = null;
  if(service_name) {
    service = config.services[service_name] || null;
    if(!service) {
      log.test(`Norenye cookie set to ${service_name}, but there are no such service configured.`);
      if(return_error)
        return {error:'no_service', name:service_name};
    } else
      service.name = service_name;
  } else if(return_error)
    return {error:'no_cookie', name:service_name};
  if(service && service.hosts && !(r.variables.host in service.hosts)) {
    log.test(`Norenye cookie set to ${service_name}, but this service has no host ${r.variables.host} configured.`);
    if(return_error)
      return {error:'no_host', name:service_name};
    service = null;
  }
  return service;
}

function getfail(r) {
  var config = getconfig(r);
  var service = getsessionservice(r, config, null, true);
  //if(service.error && utils.runmode.test)
  //  r.headersOut['X-Norenye-Error'] = String(service.error);
  return Number(Boolean(service.error));
}

function gettarget(r) {
  var config = getconfig(r);
  var service = getsessionservice(r, config);
  var target = String((service||{}).target||'');
  if(/^[@\/]/.test(target))
    return '';
  return target;
}

function getinttarget(r) {
  var config = getconfig(r);
  var service = getsessionservice(r, config);
  var target = String((service||{}).target||'');
  if(target.startsWith('@'))
    return target;
  else if(target.startsWith('/'))
    return (target+r.variables.uri).replaceAll('//','/');
  return '';
}

async function sendjson(r, obj, postprocess) {
  var indent = utils.boolparam(r.variables.arg_pretty)?2:undefined;
  var res = JSON.stringify(obj, null, indent);
  if(postprocess)
    res = await postprocess(res);
  r.headersOut['Content-Type'] = "application/javascript";
  r.return(obj.error?400:200, res);
}

async function needauthpage(r, config, service_name) {
  if(!config)
    config = getconfig(r);
  service_name = service_name || '*';

  r.headersOut['WWW-Authenticate'] = `Bearer realm="${r.variables.scheme}://${r.variables.http_host}${getbase(r)}",service="${service_name}"`;
  return await failpage(r, config, 'Authentication required.', 401);
}

async function methodallowed(r, config, methods) {
  var method = r.method.toUpperCase();
  method = method==='HEAD'?'GET':method;
  methods = (methods||['GET']);
  if(methods.filter((m)=>m===method).length>0)
    return true;
  await failpage(r, config, `Unsupported method ${r.method} out of ${methods}`, 405);
  return false;
}

async function public_configjson(r, config, rights) {
  if(!config)
    config = getconfig(r);
  if(!rights)
    rights = getrights(r, config, '*');

  if(!methodallowed(r, config)) return;
  if(!('read' in configfuncs.rights_order[rights]))
    return await needauthpage(r, config);
  var secrets = [Object.keys(config.tokens), Object.values(config.services).map((s)=>s.secrets)].flat().filter((o)=>o);
  var res = utils.copyObject(config);
  delete res.tokens;
  delete res.status;
  delete res.name;
  if(res.writeback)
    res.writeback = true;
  res.services = Object.fromEntries(Object.entries(res.services).map((it)=>{
      var svcobj = it[1];
      delete svcobj.secrets;
      svcobj.target = utils.ro_url(svcobj.target);
      if(svcobj.url)
        svcobj.url = utils.ro_url(svcobj.url);
      return it;
    }));
  return await sendjson(r, res, utils.hidesecrets_factory(secrets));
}

function gettoken(r) {
  //log.debug(`http_authorization=${r.variables.http_authorization}, arg_token=${r.variables.arg_token}`);
  if(r.variables.arg_token)
    return r.variables.arg_token;
  if(r.variables.cookie_token)
    return r.variables.cookie_token;
  if(r.variables.http_authorization&&/^ *bearer /i.test(r.variables.http_authorization))
    return r.variables.http_authorization.replace(/^ *bearer /i, '');
  return null;
}

function getrights(r, config, service_name, force_token) {
  if(!config)
    throw new Error("Internal error (no config)");
  if(!service_name) service_name = '*';
  var notoken = force_token?'none':config.read_token?'none':'read';
  var token = gettoken(r);
  //log.debug(`getrights: token=${token}`);
  if((token===null)||!(token in config.tokens))
    return notoken;
  var token_info = config.tokens[token];
  //log.debug(`getrights: token_info=${JSON.stringify(token_info)}`);
  var sright = token_info[service_name]||notoken;
  if(service_name === '*') return sright;
  var aright = token_info['*']||notoken;
  if(sright === aright) return sright;
  if([sright,aright].sort().join() === 'push,read') return 'update';
  if(sright in configfuncs.rights_order[aright]) return aright;
  return sright;
}

async function configjson(r, config, rights) {
  if(!config)
    config = getconfig(r);
  if(!rights)
    rights = getrights(r, config, '*');

  if(utils.runmode.dev)
    r.headersOut['X-Norenye-Rights'] = rights;
  if(!('admin' in configfuncs.rights_order[rights]))
    return await public_configjson(r, config, rights);
  if(!methodallowed(r, config)) return;
  return await sendjson(r, config);
}

function gethostinfo(config, host) {
  if(!config)
    throw new Error("Internal error (no config)");
  if((config.metadata || {}).error)
    return {services:{},error:config.metadata.error};
  var services = {};
  Object.entries(config.services).forEach((it)=>{
    var name=it[0],svcobj=it[1];
    if(svcobj.hosts && host in svcobj.hosts) {
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
  if(!methodallowed(r, config)) return;

  var service_name = getsessionservicename(r);
  var res = gethostinfo(config, r.variables.host);
  var redirectbase=getredirectbase(r, config), redirecttail=r.args.uri?'&uri='+r.args.uri:'';
  if(service_name in (res.services||{}))
    res.services[service_name].current = true;
  Object.keys(res.services).forEach((service_name)=>{
    res.services[service_name].redirect_url = redirectbase+service_name+redirecttail;
  });
  await sendjson(r, res);
}

async function sessionjson(r, config) {
  if(!utils.runmode.test)
    return r.return(404, '');
  if(!config)
    config = getconfig(r);
  if(!methodallowed(r, config)) return;

  var service_name = getsessionservicename(r);
  var service = getsessionservice(r, config, service_name);
  var res = {fail:Number(!service), target:(service||{}).target||'', service:service_name};
  var token = gettoken(r);
  if((token===null)||!(token in config.tokens))
    res.rights = {'*':config.read_token?'none':'read'};
  else
    res.rights = config.tokens[token];

  await sendjson(r, res);
}

function cmp(a, b) {
  if(a == b) return 0;
  if(a < b) return -1;
  return 1;
}

function escapeHTML(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll("'", '&apos;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function apply_template(tmpl, vars, apply_meta) {
  var t = Object.entries(vars||{}).sort((a,b)=>-cmp(a[0].length,b[0].length));
  //if('host_meta' in vars)
  //  log.debug(njs.dump(t,2));
  t.forEach((it)=>{
    var k=it[0], v=it[1];
    if(apply_meta && typeof(v)==='object'&& v!==null)
      tmpl = apply_template(tmpl, Object.fromEntries(Object.entries(v).map(ent=>[k+'.'+ent[0], ent[1]])), false);
    if(typeof(v)!=='string')
      v = escapeHTML(JSON.stringify(v));
    tmpl = tmpl.replaceAll('${'+k+'}', v);
    tmpl = tmpl.replaceAll('$'+k, v);
  });
  return tmpl;
}

function getbase(r) {
  if('norenye_uri' in r.variables)
    return String(r.variables.norenye_uri||'/_/');
  return '/_/';
}

function getredirectbase(r, config) {
  if(!config)
    throw new Error("Internal error (no config)");
  return getbase(r)+'redirect?set=';
}

async function indexhtml(r, config) {
  if(!config)
    config = getconfig(r);
  if(!methodallowed(r, config)) return;
  var service_name = getsessionservicename(r);
  var res = gethostinfo(config, r.variables.host);
  var services = res.services||{};
  if(service_name in services)
    res.services[service_name].current = true;
  var topvars = {meta:config.metadata,host:r.variables.host,services:String(Object.keys(services)),services_json:services};
  r.headersOut["Content-Type"] = "text/html; chatset=utf-8";
  var output='', redirectbase=getredirectbase(r, config), redirecttail=r.args.uri?'&uri='+r.args.uri:'';
  if(res.error) {
    topvars.error = res.error;
    return r.return(400, apply_template(config.template.error, topvars, false));
  }
  output += apply_template(config.template.head, topvars, true);
  output += Object.entries(res.services).map((it)=>{
    var itemvars = Object.assign({}, topvars, {service:it[0],service_meta:it[1].service,host_meta:it[1].host,current:(it[0]==service_name),redirect_url:redirectbase+it[0]+redirecttail});
    if(config.template.tag) {
      var tags = configfuncs.enrichtags([it[0], (itemvars.service_meta||{}).tags, (itemvars.host_meta||{}).tags, itemvars.current?['current']:[]], true);
      itemvars.tags = Object.entries(tags).map(it=>{
        log.debug(`indexhtml: ${njs.dump(it)}`);
        var tagvars = Object.assign({}, itemvars, {tag:it[0],tag_meta:it[1]});
        return apply_template(config.template.tag, tagvars, true);
      }).join(config.template['tag-sep']);
      log.debug(`indexhtml: ${njs.dump(tags)} -> ${njs.dump(itemvars.tags)}`);
      if(config.template.tags)
        itemvars.tags = apply_template(config.template.tags, itemvars, true);
    }
    return apply_template(itemvars.current?config.template['cur-item']:config.template.item, itemvars, true);
  }).join(config.template['item-sep']);
  output += apply_template(config.template.tail, topvars, true);
  return r.return(200, output);
}

async function failpage(r, config, error, status) {
  //if(utils.runmode.once)
  //  throw new Error(error);
  if(!config) {
    r.headersOut["Content-Type"] = "text/plain; chatset=utf-8";
    return r.return(status||401, error);
    //config = getconfig(r);
  }
  var res = gethostinfo(config, r.variables.host);
  var services = res.services||{};
  var topvars = {meta:config.metadata,host:r.variables.host,services:String(Object.keys(services)),services_json:services,error:error};
  r.headersOut["Content-Type"] = "text/html; chatset=utf-8";
  return r.return(status||401, apply_template(config.template.error, topvars));
}

async function redirectpage(r, config) {
  if(!config)
    config = getconfig(r);
  if(!methodallowed(r, config)) return;
  var uri = r.args.uri || r.variables.norenye_redirect || '/';
  var service_name = r.variables.arg_set;
  var service = service_name?getsessionservice(r, config, service_name, true):{error:'no_set_arg'};
  var norenye_cookie = r.variables.norenye_cookie || 'norenye';
  var url = `${r.variables.scheme}://${r.variables.http_host}`;
  log.debug('redirectpage: service='+JSON.stringify({service_name,service}));
  if(!service.error) {
    r.headersOut["Set-Cookie"] = `${norenye_cookie}=${service_name}; Expires=Fri, 01 Jan 2100 00:00:00 +0000; Path=/; HttpOnly`;
    url = r.variables.arg_url || (url+uri);
  } else {
    if(utils.runmode.test)
      r.headersOut["X-Norenye-Error"] = String(service.error);
    uri = getbase(r);
    url = url+uri;
  }
  //r.headersOut["Location"] = url;
  r.return(307, url);
}

async function serviceforward(r, config) {
  if(!config)
    config = getconfig(r);
  var service_name = getsessionservicename(r);
  var service = service_name?getsessionservice(r, config, service_name, true):{error:'no_cookie'};
  log.debug('serviceforward: service='+JSON.stringify({service_name,service}));

  if(service.error) {
    var url = `${r.variables.scheme}://${r.variables.http_host}${getbase(r)}`;
    log.debug(`serviceforward: error=${service.error}, url=${url}`);
    if(utils.runmode.test)
      r.headersOut["X-Norenye-Error"] = String(service.error);
    //r.headersOut["Location"] = url;
    r.return(307, url);
  } else if(String(service.target).startsWith('@')) {
    return r.internalRedirect(service.target);
  } else if(String(service.target).startsWith('/')) {
    return r.internalRedirect((service.target+r.variables.uri).replaceAll('//','/'));
  } else if(/^[\/@]/.test(service.target)) {
    var sropts = {method:r.variables.request_method, args:r.variables.args};
    //log.debug(`serviceforward: sropts=${njs.dump(sropts)}`);
    var reply = await r.subrequest(service.target+r.variables.uri, sropts);
    Object.entries(reply.headersOut).forEach((it)=>{
      log.debug(`reply.rawHeadersOut: ${typeof(it)}=${njs.dump(it)}`);
    });
    return r.return(reply.status, reply.responseBuffer);
    //return r.return(200, JSON.stringify(sropts));
  } else {
    var url = service.target+r.variables.uri;
    log.debug(`serviceforward: name=${service.name}, url=${url}`);
    //log.debug(`serviceforward: rawHeadersIn=${JSON.stringify(r.rawHeadersIn)}`);
    var headers = new Headers(r.headersIn), body = r.requestText;
    headers.set('Host', r.headersIn.host || utils.urlparse(url).hostinfo);
    log.debug(`serviceforward: headers=${njs.dump(headers)}, body=${body.length}`);
    var reply = await ngx.fetch(url, {method:r.method, headers, body});
    //log.debug(`serviceforward: reply=${JSON.stringify(reply)}`);
    reply.headers.forEach((n)=>{
      var l = reply.headers.getAll(n), ln = n.toLowerCase();
      var skip = (ln === 'connection')||(ln==='content-length');
      //log.debug(`reply.headers: ${JSON.stringify(n)}=${JSON.stringify(l)} (skip=${skip})`);
      if(!skip)
        r.headersOut[n] = l;
    });
    //log.debug(`serviceforward: rawHeadersOut=${JSON.stringify(r.rawHeadersOut)}`);
    var body = await reply.text();
    r.return(reply.status, body);
  }
}

async function healthcheck(r) {
  r.headersOut['Content-Type'] = "application/javascript";
  if((r.method==='GET')||(r.method==='HEAD'))
    return r.return(200, '{"status": "ok"}');
  return r.return(404, '{"status": "error", "error": "method='+r.method+'"}');
}

async function apiservices(r, config) {
  if(!config)
    config = getconfig(r);
  log.debug('apiservices0');
  if(!methodallowed(r, config, ['PUT'])) return;
  log.debug('apiservices1');
  var data;
  try {
    data = JSON.parse(r.requestText);
  } catch(e) {
    log.debug(`apiservices-error1: r.requestText=${r.requestText}, len=${r.headersIn['Content-Length']}`);
    return await failpage(r, config, `Invalid data: ${e}`, 400);
  }
  log.debug(`apiservices2: data=${njs.dump(data)}`);
  //var service_info = configfuncs.enrichservice(data, null, Object.assign({}, config));
  var service_info = configfuncs.enrichservice(data, null, config);
  log.debug(`apiservices3: service_info=${njs.dump(service_info)}`);
  if(!service_info)
    return await failpage(r, config, `Invalid data.`, 400);
  var service_name=service_info[0];
  var rights = getrights(r, config, service_name);
  if(!('all' in configfuncs.rights_order[rights]))
    return await needauthpage(r, config, service_name);
  if(service_name in config.services)
    return await failpage(r, config, `Already exists.`, 409);
  config.services[service_name] = configfuncs.enrichservice(data, null, config)[1];
  onconfigchange(r, config);
  return r.return(201, '');
}

async function apiservicejson(r, config, service_name) {
  if(!config)
    config = getconfig(r);
  if(!methodallowed(r, config)) return;
  var rights = getrights(r, config, service_name);
  if(!('read' in configfuncs.rights_order[rights]))
    return await needauthpage(r, config, service_name);
  if(!(service_name in config.services))
    return await failpage(r, config, `Not exist.`, 404);
  var res=Object.assign({}, config[service_name], {name:service_name});
  if(!('admin' in configfuncs.rights_order[rights])) {
    var secrets = [Object.keys(config.tokens), res.secrets].flat(2).filter((o)=>o);
    delete res.secrets;
    res.target = utils.ro_url(res.target);
    if(res.url)
      res.url = utils.ro_url(res.url);
    return await sendjson(r, res, utils.hidesecrets_factory(secrets));
  }
  // TODO: Think of recreate service.token from config.tokens
  return await sendjson(r, res);
}

async function apiservice(r, config, service_name) {
  if(!config)
    config = getconfig(r);
  if(!methodallowed(r, config, ['GET', 'POST', 'DELETE'])) return;
  if((r.method==='GET')||(r.method==='HEAD'))
    return await apiservicejson(r, config, service_name);
  var rights = getrights(r, config, service_name);
  if(!((r.method=='DELETE'?'all':'update') in configfuncs.rights_order[rights]))
    return await needauthpage(r, config, service_name);
  if(!(service_name in config.services))
    return await failpage(r, config, `Not exist.`, 404);
  if(r.method=='DELETE') {
    delete config.services[service_name];
  } else {
    var data;
    try {
      data = JSON.parse(r.requestBuffer);
    } catch(e) {
      return await failpage(r, config, `Invalid data: ${e}`, 400);
    }
    var service_info = configfuncs.enrichservice(data, service_name, config);
    if(!service_info)
      return await failpage(r, config, `Invalid data.`, 400);
    var service_name1=service_info[0], service=service_info[1];
    config.services[service_name] = service;
  }
  onconfigchange(r, config);
  return r.return(201, '');
}

async function apiservicehosts(r, config, service_name) {
  if(!config)
    config = getconfig(r);
  if(!methodallowed(r, config, ['GET', 'POST', 'DELETE'])) return;
  var rights = getrights(r, config, service_name);
  if(!((r.method=='DELETE'?'all':r.method=='POST'?'update':'read') in configfuncs.rights_order[rights]))
    return await needauthpage(r, config, service_name);
  if(!(service_name in config.services))
    return await failpage(r, config, `Not exist.`, 404);
  if((r.method==='GET')||(r.method==='HEAD'))
    return await sendjson(r, config[service_name].hosts);
  var dirty = true;
  if(r.method=='DELETE') {
    delete config.services[service_name];
  } else {
    var data;
    try {
      data = JSON.parse(r.requestBuffer);
    } catch(e) {
      return await failpage(r, config, `Invalid data: ${e}`, 400);
    }
    var hosts = configfuncs.enrichhosts(data);
    if(!hosts)
      return await failpage(r, config, `Invalid data.`, 400);
    dirty = JSON.stringify(config.services[service_name].hosts) !== JSON.stringify(hosts);
    config.services[service_name].hosts = hosts;
  }
  if(dirty)
    onconfigchange(r, config);
  return r.return(201, '');
}

async function apihost(r, config, service_name, host_name) {
  if(!config)
    config = getconfig(r);
  const update_methods = ['PUT', 'POST', 'DELETE'];
  var wantupdate = r.method in Object.fromKeys(update_methods);
  if(!methodallowed(r, config, ['GET', update_methods].flat())) return;
  var rights = getrights(r, config, service_name);
  if(!((wantupdate?'update':'read') in configfuncs.rights_order[rights]))
    return await needauthpage(r, config, service_name);
  if(!(service_name in config.services))
    return await failpage(r, config, `Not exist.`, 404);
  if(r.method==='PUT') {
    if(host_name in config.services[service_name])
      return await failpage(r, config, `Already exists.`, 409);
  } else {
    if(!(host_name in config.services[service_name]))
      return await failpage(r, config, `Not exist.`, 404);
  }
  if((r.method==='GET')||(r.method==='HEAD'))
    return await sendjson(r, config[service_name].hosts[host_name]);
  var dirty = true;
  if(r.method=='DELETE') {
    delete config[service_name].hosts[host_name];
  } else {
    var data;
    try {
      if(b.length===0)
        data = null;
      else
        data = JSON.parse(r.requestBuffer);
    } catch(e) {
      return await failpage(r, config, `Invalid data: ${e}`, 400);
    }
    dirty = JSON.stringify(config[service_name].hosts[host_name]) !== JSON.stringify(data);
    config[service_name].hosts[host_name] = data;
  }
  if(dirty)
    onconfigchange(r, config);
  return r.return(201, '');
}

async function dbgpage(r) {
  if(!utils.runmode.dev)
    return r.return(404, '');
  //log.debug(`ngx.error_log_path = ${ngx.error_log_path}`);
  //log.debug(`r.headersIn['cookie'] = ${njs.dump(r.headersIn['cookie'])}`)
  var res = {error_log_path: ngx.error_log_path,
      req: Object.assign({},r,{variables:utils.copyObject(r.variables,
        ['host','hostname','args','http_host','http_user_agent','http_accept','uri','request_uri','document_uri',
         'request','query_string','realpath_root','request_method','scheme','server_name','server_port','ssl_server_name',
         Object.keys(r.args).map((a)=>`arg_${utils.str2varname(a)}`),
         Object.keys(r.headersIn).map((a)=>`http_${utils.str2varname(a)}`),
         [r.headersIn['cookie']].flat(2).filter((it)=>it).map((a)=>`cookie_${utils.str2varname(a.split('=')[0])}`),
        ].flat(2)
      )}),
      //reqSymbols: Object.getOwnPropertySymbols(r).map((s)=>String(s)),
      //reqBuf: njs.dump(r.requestBuffer),
      worker_id: ngx.worker_id,
      pid: process.pid,
      ppid: process.ppid,
      env: utils.copyObject(process.env),
      argv: process.argv,
      njs_engine: njs.engine,
      njs_version: njs.version,
      ngx_version: ngx.version,
      ngx: utils.copyObject(ngx),
      memoryStats: njs.memoryStats,
      //reqInfo: Object.getOwnPropertyDescriptors(r),
      //reqInfo_headersIn2: Object.getOwnPropertyDescriptor(r.headersIn,'accept'),
      //reqInfo_headersIn: Object.getOwnPropertyDescriptors(r.headersIn),
      //configfuncs.rights_order
    };
  if(utils.boolparam(r.variables.arg_dump)) {
    //res.req = r;
    var indent = utils.boolparam(r.variables.arg_pretty)?2:undefined;
    r.headersOut['Content-Type'] = "text/plain";
    return r.return(200, njs.dump(res, indent));
  }
  return await sendjson(r, res);
}

async function apijson(r, config, apikind) {
  if(!methodallowed(r, config)) return;
  const baseurl = `${r.variables.scheme}://${r.variables.http_host}${getbase(r)}`;
  const debug_url = utils.runmode.dev?`${baseurl}_debug.json`:undefined;
  const all_api = {
    health_url:`${baseurl}health`,
    debug_url
  };
  const indexhtml_url = `${baseurl}index.html`;
  const index_url = `${baseurl}index.json`;
  const public_api = {indexhtml_url, index_url};
  const admin_api = {
    config_url:`${baseurl}config.json`,
    session_url:`${baseurl}_session.json`,
    service_create_url:`${baseurl}service/`,
    service_hosts_url:`${baseurl}service/{service}`,
    service_host_url:`${baseurl}service/{service}/{host}`
  };
  var res = all_api;
  switch(apikind||'api') {
    case 'api':
      res = Object.assign({}, all_api, public_api, admin_api);
      break;
    case 'admin_api':
      res = Object.assign({}, all_api, admin_api);
      break;
    case 'public_api':
      res = Object.assign({}, all_api, public_api);
      break;
    case 'public_html':
      res = Object.assign({}, all_api, {indexhtml_url});
      break;
    default:
      res = {error: 'Unknown URL.'};
  }
  return await sendjson(r, res);
}

async function adminapijson(r, config) {
  return apijson(r, config, 'admin_api');
}

async function norenye_api(r, config, apikind) {
  log.debug(`r@${r[Symbol.toStringTag]}: ${r.method} ${r.uri}`);
  if(!config)
    config = getconfig(r);
  var baseuri = getbase(r);
  var baselen = baseuri.length;
  var uri = r.uri, uriparts, service_name, rights;
  apikind = apikind || 'api';
  if(!uri.startsWith(baseuri)) {
    if(apikind === 'admin_api')
      return await failpage(r, config, `Unknown URL ${r.uri.split('?')[0]}.`, 404);
    return await serviceforward(r, config);
  }
  uri = uri.slice(baselen).split('?')[0];
  if(apikind === 'admin_api') {
    uriparts = uri.split('/').filter((s)=>(s));
    service_name = (uriparts[0] === 'service' && uriparts.length>1)?uriparts[1]:'*';
    if(!gettoken(r))
      return await needauthpage(r, config, service_name);
    rights = getrights(r, config, service_name, true);
  }
  if(uri === 'health')
    return healthcheck(r)
  if(apikind !== 'admin_api') {
    if((apikind !== 'public_html') && (uri === 'index.json'))
      return await indexjson(r, config);
    if(uri === 'redirect')
      return await redirectpage(r, config);
    if((uri === '') || (uri === 'index.html'))
      return await indexhtml(r, config);
  }
  if((apikind === 'admin_api') && (uri === ''))
    return await adminapijson(r, config);
  if(uri === '_api.json')
    return await apijson(r, config, apikind);
  if(uri === '_noapi.json')
    return await apijson(r, config, 'noapi');
  if((apikind !== 'public_html') && (apikind !== 'public_api')) {
    if(uri === 'config.json')
      return await configjson(r, config, rights);
    if((uri === '_debug.json') && utils.runmode.dev)
      return await dbgpage(r);
    if((uri === '_session.json') && utils.runmode.test)
      return await sessionjson(r, config);
    uriparts = uriparts || uri.split('/').filter((s)=>(s));
    if(uriparts[0] === 'service' && uriparts.length===1)
      return await apiservices(r, config);
    if(uriparts[0] === 'service' && uriparts.length===2)
      //return await apiservice(r, config, uriparts[1]);
      return await apiservicehosts(r, config, uriparts[1]);
    if(uriparts[0] === 'service' && uriparts.length===3)
      return await apihost(r, config, uriparts[1], uriparts[2]);
  }
  return await failpage(r, config, `Unknown URL ${r.uri.split('?')[0]}.`, 404);
}

async function public_html(r, config) {
  return norenye_api(r, config, 'public_html');
}

async function public_api(r, config) {
  return norenye_api(r, config, 'public_api');
}

async function api(r, config) {
  return norenye_api(r, config, 'api');
}

async function admin_api(r, config) {
  return norenye_api(r, config, 'admin_api');
}

function noop(r) {
  if(r && r.return && r.return.call)
    r.return(201, '');
}

function getbody(r) {
  return r.requestText;
}

function bodypage(r) {
  r.return(200,r.variables.bodypage+(r.requestText?'\n'+r.requestText:''));
}

export default {
  // variables (for js_set):
  getfail,
  gettarget,
  getinttarget,
  getbody,
  // pages (for js_content):
  configjson,
  public_configjson,
  indexjson,
  indexhtml,
  adminapijson,
  public_api,
  public_html,
  api,
  admin_api,
  serviceforward,
  apiservices,
  apiservice,
  apihost,
  sessionjson,
  dbgpage,
  healthcheck,
  bodypage,
  // for js_periodic
  periodic,
  noop,
  // utility functions (for tests - js/cmd.js):
  errorconfig: configfuncs.errorconfig,
  ro_url: utils.ro_url,
};
