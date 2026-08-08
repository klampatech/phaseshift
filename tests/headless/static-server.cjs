const http=require('http'),fs=require('fs'),path=require('path');
const ROOT="/home/kyle/Development/phaseshift/dist";
const PORT=9877, HOST="127.0.0.1";
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.map':'application/json'};
function safeJoin(r,u){const p=path.normalize(path.join(r,decodeURIComponent(u.split('?')[0])));return p.startsWith(r)?p:null;}
http.createServer((req,res)=>{let f=safeJoin(ROOT,req.url);if(!f){res.writeHead(403);return res.end();}
fs.stat(f,(e,s)=>{if(e||!s.isFile())f=path.join(ROOT,'index.html');fs.readFile(f,(e,d)=>{if(e){res.writeHead(500);return res.end();}
res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});res.end(d);});});}).listen(PORT,HOST,()=>console.log('[server] http://'+HOST+':'+PORT));
