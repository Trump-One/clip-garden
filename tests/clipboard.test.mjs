import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const {createClipboardAdapter}=createRequire(import.meta.url)('../desktop/clipboard.cjs');
const png=readFileSync(new URL('../desktop/icon.png',import.meta.url));
const nativeImage={createFromBuffer:b=>({isEmpty:()=>false,getSize:()=>({width:1024,height:1024}),toPNG:()=>b})};
class ClipboardItem {constructor(data){this.data=data;this.types=Object.keys(data);}async getType(t){return this.data[t];}}
test('Electron 44 asynchronous text read and write',async()=>{
 let text='async text';const clipboard={read:async()=>[],readText:async()=>text,writeText:async value=>{await Promise.resolve();text=value;}};
 const adapter=createClipboardAdapter({clipboard,ClipboardItem,nativeImage});assert.deepEqual(await adapter.read(),{kind:'text',content:'async text'});await adapter.write({kind:'text',content:'copied'});assert.equal(text,'copied');
});
test('Electron 44 ClipboardItem PNG roundtrip',async()=>{
 let entries=[new ClipboardItem({'image/png':new Blob([png],{type:'image/png'})})];
 const clipboard={read:async()=>entries,readText:async()=>'',write:async e=>{entries=e;}};
 const adapter=createClipboardAdapter({clipboard,ClipboardItem,nativeImage});const clip=await adapter.read();assert.equal(clip.kind,'image');await adapter.write(clip);assert.equal(entries[0].types[0],'image/png');assert.deepEqual(Buffer.from(await (await entries[0].getType('image/png')).arrayBuffer()),png);
});
test('raw password-manager sensitivity markers prevent capture',async()=>{
 const clipboard={read:async()=>[new ClipboardItem({'electron application/osclipboard;format="org.nspasteboard.ConcealedType"':new Blob([])})],readText:async()=>{throw Error('must not read sensitive text');}};
 assert.equal(await createClipboardAdapter({clipboard,ClipboardItem,nativeImage}).read(),null);
});
test('clipboard failures reject cleanly and oversized images are not decoded',async()=>{
 const adapter=createClipboardAdapter({clipboard:{read:async()=>{throw Error('permission denied');}},ClipboardItem,nativeImage});await assert.rejects(adapter.read(),/permission denied/);
 let decoded=false;const item={types:['image/png'],getType:async()=>({size:21*1024*1024})};const large=createClipboardAdapter({clipboard:{read:async()=>[item]},ClipboardItem,nativeImage:{createFromBuffer:()=>{decoded=true;}}});assert.equal(await large.read(),null);assert.equal(decoded,false);
});
