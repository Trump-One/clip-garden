import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = new URL('../ui/', import.meta.url);
createServer(async(req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(name)){res.writeHead(404);res.end();return;}try{const data=await readFile(fileURLToPath(new URL(name,root)));res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'application/javascript');res.end(data);}catch{res.writeHead(404);res.end();}}).listen(4319,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:4319'));
