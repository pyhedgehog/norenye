// polyfils {
if (!Object.fromEntries)
  Object.fromEntries = function polyFromEntries(l) {
    return l.reduce((o, it) => Object.assign(o, { [it[0]]: it[1] }), {});
  };
if (!Object.fromKeys)
  Object.fromKeys = (l) =>
    Object.fromEntries(Array.prototype.map.call(l, (i) => [i, null]));
if (!Array.prototype.flat)
  Array.prototype.flat = function polyflat(depth) {
      depth = isNaN(depth) ? 1 : Number(depth);
      return depth ? this.reduce(function(res, cur) {
        if (Array.isArray(cur)) {
          res.push.apply(res, polyflat.call(cur, depth-1));
        } else {
          res.push(cur);
        }
        return res;
      }, []) : this.slice();
    };
if (!Array.prototype.some)
  Array.prototype.some = function polysome(cb) {
      var res=false;
      this.forEach(function(it, i, arr) {
        if(res) return;
        res = cb(it, i, arr);
      });
      return res;
    };
// }

import fs from 'fs';

// QJS support for group modifiers added to source at 2025-05-16 (f95b8ba1b), but as of 2025-05-27 change not yet released.
const url_re = /^(?:(?:(?<scheme>[^:/]*):)?\/\/(?<netloc>(?:(?<authinfo>(?<username>[^/@:]*)(?::(?<password>[^/@]*))?)@)?(?<hostinfo>(?:unix:)(?<unixpath>[^:]+):|(?!(?:unix:))\[?(?<hostname>[^/]*?)\]?(?::(?<port>[0-9]*))?)))?(?<path>(?<base>\/(?:.*\/)?)[^/]*)?$/i;
const nohostschemes = Object.fromKeys(['mailto']);

function copyObject(o, keys) {
  if(keys !== undefined)
    return Object.fromEntries(keys.map((k)=>[k,o[k]]));
  return Object.fromEntries(Object.entries(o));
}

function boolparam(v) {
  return Boolean(v&&v!='0'&&v!='no'&&v!='false');
}

function str2varname(s) {
  return String(s).toLowerCase().replaceAll('-','_');
}

function urlparse(s) {
  var o = url_re.exec(String(s));
  if(o === null)
    return {rel: s};
  o = o.groups;
  o.scheme = o.scheme && o.scheme.toLowerCase();
  return o;
}

function urlunparse(o) {
  return `${o.scheme?o.scheme+':':''}${(o.netloc||(o.scheme&&!(o.scheme in nohostschemes)))?'//'+(o.netloc||''):''}${o.path||('/'+(o.rel||''))}`;
}

function urljoin(base, tail) {
  var tailo = urlparse(tail);
  if(tailo.base&&tailo.netloc&&tailo.scheme) return tail;
  var baseo = urlparse(base);
  if(!tailo.scheme) tailo.scheme = baseo.scheme;
  if(tailo.base&&tailo.netloc) return urlunparse(tailo);
  if(!tailo.netloc) tailo.netloc = baseo.netloc;
  if(!tailo.base&&baseo.base) {
    tailo.base = baseo.base;
    tailo.path = tailo.rel?baseo.base+tailo.rel:baseo.path;
  }
  return urlunparse(tailo);
}

function addr2url(addr) {
  if(/:\/\/|^[\/@]/.test(addr)) return addr;
  return 'http://'+addr;
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

function hidesecrets_factory(secrets) {
  return function(str) {
      secrets.forEach((sec)=>{
        str = str.replaceAll(sec, '@@@skip@@@');
      });
      return str;
    };
}

const debuglog = globalThis.print?print:globalThis.ngx?(s)=>ngx.log(ngx.ERR, s):null;
const runmodes = Object.fromEntries('prod test dev once'.split(' ').map((it,i)=>[String(it),i]))
var runmode_set = {};

function RunMode(value) {
  if(this === undefined) {
    var key = String(value);
    if(key in runmode_set)
      return runmode_set[key];
    return runmode_set[key] = new RunMode(value);
  }
  if(value === undefined)
    value = process.env.NORENYE_MODE;
  var mode = runmodes[String(value||'').toLowerCase()] || runmodes.prod;
  //debuglog(`RunMode: ${value} -> ${mode}`);
  this.mode = mode;
  this.value = value;
  Object.keys(runmodes).forEach((name)=>{
    this[name] = mode>=runmodes[name];
  });
  //debuglog(`RunMode: ${njs.dump(this)}`);
}
RunMode.prototype.valueOf = ()=>this.mode;

const runmode = Object.seal(RunMode());

const log = Object.seal(globalThis.ngx?{
  debug:(s)=>runmode.dev?ngx.log(ngx.ERR, s):null,
  test:(s)=>runmode.test?ngx.log(ngx.ERR, s):null,
  error:(s)=>ngx.log(ngx.ERR, s),
  warn:(s)=>ngx.log(ngx.WARN, s),
}:globalThis.console?{
  debug:console.log,
  test:console.log,
  error:console.error,
  warn:console.warn
}:{
  debug:()=>null,
  test:()=>null,
  error:()=>null,
  warn:()=>null
});

//log.debug(`runmode=${runmode}=${njs.dump(runmode)}`);

const fsopt = { encoding: "utf8" };
const init_cb_cache = (function(){try {return JSON.parse(fs.readFileSync('/tmp/norenye_utils.tmp', fsopt));}catch(e){return {};}})();

function on(evt, cb) {
  if(evt === 'init') {
    //if(init_cb_cache.some(it=>Object.is(it, cb))) return;
    if(!cb.name)
      throw new Error(`Callback function must be unique named.`);
    if(ngx.worker_id!=0) return;
    if(cb.name in init_cb_cache) return;
    init_cb_cache[cb] = true;
    fs.writeFileSync('/tmp/norenye_utils.tmp', JSON.stringify(init_cb_cache), fsopt);
    return cb();
  } else
    throw new Error(`Only 'init' event supported, not ${JSON.stringify(evt)}`);
}

export default {
  copyObject,
  boolparam,
  str2varname,
  addr2url,
  ro_url,
  hidesecrets_factory,
  urlparse,
  urlunparse,
  urljoin,
  runmodes,
  RunMode,
  runmode,
  log,
  on,
};
