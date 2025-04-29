#!/usr/bin/env njs
import norenye from './norenye.js';
import qs from 'querystring';
import fs from 'fs';

var fetch_map = {};
var vars = {
  norenye_config: '/tmp/norenye.json',
  cookie_norenye: 'svc1',
};
fs.writeFileSync(vars.norenye_config, fs.readFileSync('/home/mdubner/src/rutube/_arch/norenye/tests/nginx/norenye.json', { encoding: "utf8" }));

function FakeRequest(vars, opts) {
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
  var default_vars = {host:'127.0.0.1',scheme:'http',uri:this.uri,request_uri:this.uri,document_uri:this.uri};
  var args = vars.args || String(this.uri).replace(/^[^?]*(?:\?(.*))?$/, '$1');
  default_vars.args = args;
  args = qs.parse(args);
  Object.entries(args).forEach((it) => {
    default_vars['arg_'+it[0]] = it[1];
  });
  vars = Object.assign(default_vars, vars, opts.vars);
  vars.http_host = vars.http_host || vars.host;
  vars.host = vars.host.split(':')[0];
  delete opts.vars;
  this.args = args;
  this.parent = null;
  Object.assign(this, opts);
  this.variables = vars;
  this.raw_variables = vars;
  this.headersOut = {Server:'fake','Content-Type':'text/plain'};
  this.return = (status, text) => print(`HTTP/1.0 ${status} ...\n${Object.entries(this.headersOut).map((it)=>it.join(': ')).join('\n')}\n\n${text}\n...END`);
}

function FakeResponce(text) {
  this.text = ()=>{return Promise.resolve(text);};
  this.json = ()=>{try{return Promise.resolve(JSON.parse(text));}catch(e){return Promise.reject(e);}};
  return this;
}

async function fake_fetch(url) {
  return new FakeResponce(fetch_map[url] || url);
}

function FakeNGX() {
  this.ERR = 'error';
  this.INFO = 'info';
  this.WARN = 'warn';
  this.log = (level, msg) => (level in console?console[level]:console.log)(msg);
  this.shared = {};
  this.fetch = fake_fetch;
  return this;
}

if(!globalThis.ngx)
  globalThis.ngx = new FakeNGX();

var url = process.argv[2]||'http://svc3.example.com/aaa/bb/c.ext?pretty=1&token=abcde';
var r = new FakeRequest(vars, {url:url});
//var r = new FakeRequest(vars);
// ngx.log(ngx.ERR, 'test log err');
// ngx.log(ngx.WARN, 'test log warn');
// ngx.log(ngx.INFO, 'test log info');
//print(ngx.shared);
//print('req:', r);
//print('ro_url tests:', [norenye.ro_url('http://u:p@h:1/aaa/bb/c.ext?token=abcde'),norenye.ro_url(null),norenye.ro_url('')]);
//print(norenye.errorconfig('BUG'));
//norenye.configjson(r);
//norenye.public_configjson(r);
//norenye.dbgpage(r);
//norenye.indexjson(r);
//norenye.sessionjson(r);
//norenye.indexhtml(r);
norenye.public_api(r);
