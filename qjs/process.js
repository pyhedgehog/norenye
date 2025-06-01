const env = std.getenviron()
//const env = (function() {
//  var fd = std.popen('env','r',);
//  var res = fd.readAsString();
//  fd.close();
//  return Object.fromEntries(res.split('\n').filter(s=>(s.length>0&&s.indexOf('=')>0)).map(s=>{var i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}))
//})();
const argv = ['qjs', ...scriptArgs];
const process = {env, argv, pid:1, ppid:0};
(function(){
  try {
    //process.pid = Number(os.readlink('/proc/self')[0]);
    var fd = std.open('/proc/self/status', 'r');
    var res = fd.readAsString();
    fd.close()
    res = res.split('\n').map(s=>s.split(':\t')).map(([n,v])=>[n.toLowerCase(),v]).filter(([n,v])=>n in process);
    //print(JSON.stringify(res,null,2));
    res.forEach(([n,v])=>{process[n] = Number(v);});
  } catch(e) {
  }
})();
const pid = process.pid;
const ppid = process.ppid;

//print(JSON.stringify(process,null,2));

if(!globalThis.process)
  globalThis.process = process;

if(!globalThis.njs)
  globalThis.njs = {dump:(o,i)=>JSON.stringify(o, null, i)};

export default {
  env,
  argv,
  pid,
  ppid
};
