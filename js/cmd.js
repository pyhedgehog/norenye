#!/usr/bin/env njs
import conftest from 'conftest.js';
import utils from 'norenye_utils.js';
import norenye from 'norenye.js';
import fs from 'fs';
////import selfModule from 'cmd.js';

var vars = {
  norenye_config: '/tmp/norenye.json',
};
//print(njs.dump(globalThis,2));
fs.writeFileSync(vars.norenye_config, fs.readFileSync('/home/mdubner/src/rutube/_arch/norenye/tests/nginx/norenye.json', { encoding: "utf8" }));

conftest.fetch_funcs.push([/^(?:https?:\/\/unix:)\/tmp\/svc4\.sock:($|\/)/, function svc4_sock(url, opts) {
  var urlo=utils.urlparse(url);
  utils.log.debug(njs.dump({url,urlo,opts}));
  return `svc4=${opts.method||'GET'} ${urlo.path} ${opts.protocol||'HTTP/1.0'}${opts.body?'\n'+String(opts.body):''}`;
}],[/^(?:https?:\/\/svc[1-5]\.example\.com)($|\/)/, function svc_example_com(url, opts) {
  var urlo=utils.urlparse(url);
  utils.log.debug(njs.dump({url,urlo,opts}));
  return `${urlo.hostname.split('.')[0]}=${opts.method||'GET'} ${urlo.path} ${opts.protocol||'HTTP/1.0'}${opts.body?'\n'+String(opts.body):''}`;
}]);

async function main() {
  process.argv.slice(3).forEach((arg, i)=>{
    var m=/^([^=]+)=(.*)$/.exec(arg);
    if(m)
      vars[m[1]] = m[2];
    else
      console.error(`E: Skipping arg ${i+2/*prog+url*/} = ${JSON.stringify(arg)}`);
  });
  Object.entries(vars).forEach(function(it){
    var k=it[0],v=it[1];
    if(k.startsWith('fetchmap_')) {
      if(v.startsWith('@'))
        v = fs.readFileSync(v.slice(1), {encoding:'utf8'});
      conftest.fetch_map[k.slice(9)] = v;
    }
  });
  print('fetch_map='+njs.dump(conftest.fetch_map));
  print('fetch_funcs='+njs.dump(conftest.fetch_funcs));
  //print(conftest.fetch_funcs[0][0].test(process.argv[2]));
  print(`test_run_periodic=${vars.test_run_periodic}=${utils.boolparam(vars.test_run_periodic)}`);
  if(utils.boolparam(vars.test_run_periodic)) {
    delete vars.test_run_periodic;
    await norenye.periodic(new conftest.FakePeriodicSession(vars));
  }
  //print(njs.dump(vars));
  var url = process.argv[2];
  if(url) {
    var r = new conftest.FakeRequest(vars, {url});
    print(njs.dump(r.variables));
    //print(JSON.stringify(r.variables,null,2))
    //var r = new FakeRequest(vars);
    // ngx.log(ngx.ERR, 'test log err');
    // ngx.log(ngx.WARN, 'test log warn');
    // ngx.log(ngx.INFO, 'test log info');
    //print(ngx.shared);
    //print('req:', r);
    //print('ro_url tests:', [norenye.ro_url('http://u:p@h:1/aaa/bb/c.ext?token=abcde'),norenye.ro_url(null),norenye.ro_url('')]);
    print(norenye.errorconfig('BUG'));
    //await norenye.configjson(r);
    //await norenye.public_configjson(r);
    //await norenye.dbgpage(r);
    //await norenye.indexjson(r);
    //await norenye.sessionjson(r);
    //await norenye.indexhtml(r);
    await norenye.api(r);
  }
}

main().catch((e)=>print(njs.dump(e)));

//export default {vars,main};
