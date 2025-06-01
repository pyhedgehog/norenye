function parse(args) {
  var res = {};
  String(args||'').split('&').forEach((s)=>{
    var i = s.indexOf('='), n=s, v=null;
    if(i>0) {
      n = s.slice(0, i);
      v = s.slice(i+1);
    }
    if(n in res)
      res[n].push(v);
    else
      res[n] = [v];
  });
  Object.keys().map(k=>{
    if(res[k].length===0)
      res[k] = res[k][0];
  });
  return res;
}

export default {
  parse,
};
