import qs from 'querystring';

var fetch_map = {};
var fetch_funcs = [];

function FakePeriodicSession(vars) {
  this[Symbol.toStringTag] = 'PeriodicSession';
  this.variables = vars;
  this.raw_variables = this.variables;
}

function FakeRequest(vars, opts) {
  this[Symbol.toStringTag] = 'FakeRequest';
  this.internal = true;
  this.httpVersion = '1.0';
  this.method = 'GET';
  this.remoteAddress = '127.0.0.1';
  this.requestBody = '';
  this.requestBuffer = Buffer.from('');
  this.requestText = '';
  vars = vars || {};
  opts = opts || {};
  if(opts.url && typeof(opts.url)==='string') {
    var urlo = /^(?:(?<scheme>[^:\/]+):)?(?:\/\/(?<host>[^\/]+))?(?<uri>\/.*)?$/.exec(opts.url);
    if(urlo)
      vars = Object.assign(urlo.groups, vars);
    delete opts.url;
  }
  //print(opts);
  this.uri = vars.uri || opts.uri || '/';
  var default_vars = {
      host:'127.0.0.1',
      scheme:'http',
      uri:this.uri,
      request_uri:this.uri,
      document_uri:this.uri,
      request_method:this.method,
      request:`${this.method} ${this.uri} HTTP/${this.httpVersion}`
    };
  var args = vars.args || String(this.uri).replace(/^[^?]*(?:\?(.*))?$/, '$1');
  default_vars.args = args;
  args = qs.parse(args);
  Object.entries(args).forEach((it) => {
    default_vars['arg_'+it[0]] = it[1];
  });
  vars = Object.assign(vars, Object.assign({}, default_vars, vars, opts.vars));
  delete opts.vars;
  vars.http_host = vars.http_host || vars.host;
  vars.host = vars.host.split(':')[0];
  this.headersIn = {};
  Object.entries(vars).forEach((it,i)=>{
    if(it[0].startsWith('http_')) {
      this.headersIn[it[0].slice(5).replace('_','-')] = it[1];
    }
  });
  this.args = args;
  this.parent = null;
  Object.assign(this, opts);
  this.variables = vars;
  this.raw_variables = vars;
  this.headersOut = {Server:'fake','Content-Type':'text/plain'};
  this.return = (status, text) => print(`HTTP/1.0 ${status} ...\n${Object.entries(this.headersOut).map((it)=>it.join(': ')).join('\n')}\n\n${text}\n...END`);
}

function FakeHeaders(headers) {
  if(this===undefined)
    throw new TypeError(`calling Headers constructor without new is invalid`);
  this[Symbol.toStringTag] = 'FakeHeaders';
  if(!headers) headers = [];
  if(!Array.isArray(headers)) headers = Object.entries(headers);
  if(typeof(headers)==='string')
    headers = (headers.split('\n')
                      .map(String.prototype.trim.call)
                      .filter((s)=>s.length>0)
                      .map((s)=>((i)=>[s.slice(0,i),s.slice(i+1)])(s.indexOf(':')).map(String.prototype.trim.call)));
  this._raw_headers = headers;
  this[Symbol.iterator] = this.forEach;
}
FakeHeaders[Symbol.toStringTag] = FakeHeaders.prototype[Symbol.toStringTag] = 'FakeHeaders';
FakeHeaders.prototype.getAll = function getAll(k) { return this._raw_headers.filter((it)=>it[0]===k).map((it)=>it[1]); };
FakeHeaders.prototype.get = function get(k) { return this.getAll(k)[0]; };
FakeHeaders.prototype.forEach = function forEach(f) { return this._raw_headers.forEach(f); };
FakeHeaders.prototype.append = function append(k, v) { return this._raw_headers.push([k,v]); };
FakeHeaders.prototype.set = FakeHeaders.prototype.append;
FakeHeaders.prototype.has = function get(k) { return this.getAll(k).length>0; };
FakeHeaders.prototype.toString = function toString() { return this._raw_headers.map((it)=>it.join(': ')).join('\n'); };
FakeHeaders.prototype.delete = function delete_(k) { this._raw_headers = this._raw_headers.filter((it)=>it[0]!==k); };

function FakeFetchResponce(text, headers) {
  this[Symbol.toStringTag] = 'FakeFetchResponce';
  this.headers = new FakeHeaders(headers);
  this.text = ()=>{return Promise.resolve(text);};
  this.json = ()=>{try{return Promise.resolve(JSON.parse(text));}catch(e){return Promise.reject(e);}};
}

async function fake_fetch(url, opts) {
  url = String(url || 'http://127.0.0.1/');
  opts = opts || {};
  print(`fake_fetch: ${opts.method || 'GET'} ${url}`);
  if(!/^https?:\/\//i.test(String(url)))
    throw new Error('Only http and https protocols supported.');
  if((opts||{}).headers && opts.headers.constructor === FakeHeaders)
    print(opts.headers.toString());
  var text = undefined;
  fetch_funcs.forEach((it, i) => {
    if(text !== undefined) return;
    if(it[0].test(url))
      text = it[1](url, opts);
  });
  if(text === undefined)
    text = fetch_map[url];
  if(text === undefined)
    text = url;
  return new FakeFetchResponce(text);
}

const ngxdata = Symbol('FakeNGXShared');

function FakeNGXShared() {
  if(this===undefined)
    throw new TypeError(`calling Map constructor without new is invalid`);
  this[ngxdata] = {};
  this.capacity = 0;
  this.type = 'string';
}
FakeNGXShared.prototype[Symbol.toStringTag] = 'FakeNGXShared';
FakeNGXShared.prototype.has = function has(k) {return k in this[ngxdata];}
FakeNGXShared.prototype.add = function add(k,v) {if(!(k in this[ngxdata]))this[ngxdata][k] = v;};
FakeNGXShared.prototype.clear = function clear() {this[ngxdata] = {};};
FakeNGXShared.prototype.delete = function delete_(k) {delete this[ngxdata][k];};
FakeNGXShared.prototype.set = function set(k,v) {this[ngxdata][k] = v;};
FakeNGXShared.prototype.get = function get(k) {return this[ngxdata][k];};

function FakeNGX() {
  //print(njs.dump(this));
  //if(this == undefined)
  //  return new FakeNGX();
  this.shared = {norenye:new FakeNGXShared()};
}
FakeNGX.prototype[Symbol.toStringTag] = 'FakeNGX';
FakeNGX.prototype.ERR = 'error';
FakeNGX.prototype.INFO = 'info';
FakeNGX.prototype.WARN = 'warn';
FakeNGX.prototype.log = function log(level, msg) {(level in console?console[level]:console.log)(msg);}
FakeNGX.prototype.fetch = fake_fetch;

function install() {
  if(!globalThis.ngx)
    globalThis.ngx = new FakeNGX();
  if(!globalThis.Headers)
    globalThis.Headers = FakeHeaders;
  process.env.NORENYE_MODE = process.env.NORENYE_MODE || 'once';
}

install();

export default {
  FakePeriodicSession,
  FakeRequest,
  FakeHeaders,
  Headers: FakeHeaders,
  FakeNGX,
  fake_fetch,
  fetch: fake_fetch,
  fetch_map,
  fetch_funcs,
//  install,
};
