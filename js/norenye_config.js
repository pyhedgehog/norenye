import fs from 'fs';
import utils from 'norenye_utils.js';

const log = utils.log;
const default_template = {
  "error": "<html><head><title>Error on $host</title></head><body>\n<p>$error</p></body></html>",
  "head": "<html><head><title>Select env for host $host</title></head><body>\n<ul>",
  "item": "<li><a href=\"$redirect_url\">$service</a></li>",
  "cur-item": "<li><b><a href=\"$redirect_url\">$service</a></b></li>",
  "item-sep": "\n",
  "tail": "\n</ul>\n</body></html>\n",
  "tags": null,
  "no-tags": null,
  "tag": '$tag',
  "tag-sep": ", "
};
const config_placeholder = {status:0,services:null,tokens:null,read_token:false,template:null,metadata:null,writeback:null,name:null};
const service_placeholder = {target:null,hosts:null,url:null,secrets:null,metadata:null,priority:null};
const rights_order = ['admin','all','update','push','read','none'].reverse().reduce((acc,right)=>{
  acc[1].push(right);
  acc[0][right] = Object.fromKeys(acc[1]);
  if(right==='push')
    delete acc[0].push.read;
  return acc;
},[{},[]])[0];

function errorconfig(errstring) {
  return enrichconfig({
      status: 1,
      services: {},
      metadata: {error: errstring},
      template: {
        head: "", tail: "", item: "", "cur-item": "", error: default_template.error
      },
    });
}

function enrichrights(rights) {
  return Object.fromEntries(Object.entries(rights).map((it)=>{
    var svcname=it[0], right=it[1];
    if(right in rights_order)
      return [svcname, right];
    return null;
  }).filter((it)=>Boolean(it)));
}

function enrichtoken(config, token, rights) {
  return config.tokens[token] = enrichrights(Object.assign({}, config.tokens[token], rights));
}

function enrichtags(tags, force_object) {
  //log.debug('enrichtags: '+njs.dump(tags));
  tags = [tags].flat(4).map(it=>{
    if(it===null) return null;
    if(typeof(it)==='string') return [[it,null]];
    if(typeof(it)==='object') return Object.entries(it);
    return null;
  }).filter(it=>it).flat(1);
  if(tags.every(it=>it[1]===null) && !force_object)
      return tags.map(it=>it[0]);
  return Object.fromEntries(tags);
}

function validhostname(s) {
  if(typeof(s) != 'string') return false;
  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(s);
}

function enrichhosts(hosts) {
  if(typeof(hosts) === 'string')
    hosts = hosts.split(/[,\n]/);
  if((typeof(hosts) !== 'object') || (hosts === null))
    return undefined;
  if(Array.isArray(hosts))
    hosts = Object.fromKeys(hosts);
  hosts = Object.fromEntries(Object.entries(hosts).map(it=>[it[0].toLowerCase(),it[1]]));
  if(!Object.keys(hosts).every(validhostname))
    return undefined;
  Object.keys(hosts).forEach(k=>{
    if((hosts[k]||{}).tags)
      hosts[k].tags = enrichtags(hosts[k].tags);
  });
  return hosts;
}

function enrichservice(svc, svcname, config) {
  var svcname,svcobj;
  if((typeof(svc) !== 'object') || (svc === null) || Array.isArray(svc))
    return undefined;
  if(!svc.target)
    return undefined;
  svc.target = utils.addr2url(svc.target);
  svcobj = Object.assign({}, service_placeholder, {secrets:[],metadata:null}, svc);
  if(svcobj.name) {
    if(svcname && svcobj.name && (svcname != svcobj.name))
      log.warn(`WARNING: names doesn't match for service ${svcname} != ${svcobj.name}.`);
    svcname = String(svcname || svcobj.name);
    delete svcobj.name;
  }
  if(svcobj.token) {
    enrichtoken(config, svcobj.token, {[svcname]:"all"});
    delete svcobj.token;
  }
  svcobj.hosts = enrichhosts(svcobj.hosts);
  if(!Array.isArray(svcobj.secrets))
    svcobj.secrets = [];
  svcobj.secrets = svcobj.secrets.filter(Boolean).map(String);
  if(!('metadata' in svcobj))
    svcobj.metadata = null;
  if(svcobj.metadata === null)
    svcobj.metadata = Object.fromEntries(Object.entries(svcobj).filter((it) => !(it[0] in service_placeholder)));
  svcobj = Object.fromEntries(Object.entries(svcobj).filter((it) => it[0] in service_placeholder));
  if(svcobj.metadata.tags)
    svcobj.metadata.tags = enrichtags(svcobj.metadata.tags);
  if(Object.keys(svcobj.metadata).length === 0)
    svcobj.metadata = null;
  if(svcobj.secrets.length === 0)
    delete svcobj.secrets;
  if(svcobj.priority)
    svcobj.priority = Number(svcobj.priority);
  if(!svcobj.priority)
    delete svcobj.priority;
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
  if(!('head' in tmpl) && !('tail' in tmpl)) {
    tmpl.head = default_template.head;
    tmpl.tail = default_template.tail;
  }
  if(!tmpl.head)
    tmpl.head = "";
  if(!tmpl.tail)
    tmpl.tail = "";
  if(!('item' in tmpl) && !('cur-item' in tmpl)) {
    tmpl.item = default_template.item;
    tmpl['cur-item'] = default_template['cur-item'];
  }
  if(!tmpl.item)
    tmpl.item = '';
  if(!('cur-item' in tmpl))
    tmpl['cur-item'] = tmpl.item;
  if(!tmpl['cur-item'])
    tmpl['cur-item'] = '';
  if(!tmpl['item-sep'])
    tmpl['item-sep'] = default_template['item-sep'];
  var want_tags = Boolean(String(tmpl.item+tmpl['cur-item']).match(/\$tags(\W|$)/));
  if(want_tags) {
    if(!tmpl.tags)
      delete tmpl.tags;
    if(!tmpl["no-tags"])
      delete tmpl["no-tags"];
    if(!tmpl.tag)
      tmpl.tag = default_template.tag
    if(!tmpl['tag-sep'])
      tmpl['tag-sep'] = default_template['tag-sep'];
  } else {
    if('tags' in tmpl)
      delete tmpl.tags;
    if("no-tags" in tmpl)
      delete tmpl["no-tags"];
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
  config.tokens = Object.fromEntries(Object.entries(config.tokens).map((it, i) => [it[0], it[1] || {"*":"all"}]));
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
    config.services = Object.fromEntries(config.services.map((svc) =>
        enrichservice(svc, null, config)).filter(it=>it))
  } else {
    config.services = Object.fromEntries(Object.entries(config.services).map((it) =>
        enrichservice(it[1], it[0], config)).filter(it=>it));
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
  //log.test(`Writing to ${config.writeback}.`);
  fs.writeFileSync(config.writeback, JSON.stringify(config1), { encoding: "utf8" });
}

export default {
  errorconfig,
  // enrichrights,
  // enrichtoken,
  enrichtags,
  enrichhosts,
  enrichservice,
  // enrichtemplate,
  enrichconfig,
  rights_order,
  readconfig,
  writeconfig,
};
