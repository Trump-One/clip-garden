// Real OS clipboard test; clone read entries because Electron forbids writing them directly.
const {app,clipboard,ClipboardItem,nativeImage}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const appRoot=process.env.GARDEN_APP_ROOT||join(__dirname,'..');
const {createClipboardAdapter}=require(join(appRoot,'desktop/clipboard.cjs'));
const {createClipboardRevisionReader}=require(join(appRoot,'desktop/clipboard-revision.cjs'));
const {createClipboardRecorder}=require(join(appRoot,'desktop/clipboard-recorder.cjs'));
const {Garden}=require(join(appRoot,'desktop/core.cjs'));
const assert=require('node:assert/strict');
app.whenReady().then(async()=>{
 const adapter=createClipboardAdapter({clipboard,ClipboardItem,nativeImage});
 let original,report={ok:false},failure;
 try {
  original=await Promise.all((await clipboard.read()).map(async entry=>{
    const data={};for(const type of entry.types)data[type]=await entry.getType(type);
    return new ClipboardItem(data);
  }));
  await adapter.write({kind:'text',content:'Clip Garden async clipboard smoke'});
  const text=await adapter.read();if(text?.content!=='Clip Garden async clipboard smoke')throw Error('Text clipboard mismatch');
  const png=readFileSync(join(__dirname,'../desktop/icon.png'));
  await adapter.write({kind:'image',content:'data:image/png;base64,'+png.toString('base64')});
  const image=await adapter.read();if(image?.kind!=='image')throw Error('PNG clipboard mismatch');
  const size=nativeImage.createFromDataURL(image.content).getSize();if(size.width!==1024||size.height!==1024)throw Error('PNG clipboard dimensions mismatch');
  const getRevision=createClipboardRevisionReader();
  if(['win32','darwin'].includes(process.platform))assert.notEqual(getRevision(),null,'native clipboard revision must be available');
  const garden=new Garden();
  const recorder=createClipboardRecorder({adapter,getRevision,onCapture:clip=>garden.capture(clip.kind,clip.content)});
  await recorder.initialize(); await recorder.poll(); assert.equal(garden.snapshot().items.length,0,'startup clipboard is not imported');
  async function observe(content,count) {
    for(let i=0;i<100;i++) {
      await recorder.poll();
      if(garden.snapshot().items.find(item=>item.content===content)?.copyCount===count)return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('Copy count did not reach '+count);
  }
  const repeated={kind:'text',content:'Clip Garden repeated-copy regression'};
  for(let n=1;n<=5;n++) {await adapter.write(repeated);await observe(repeated.content,n);}
  const selected=garden.snapshot().items[0];
  for(let n=0;n<3;n++) {await recorder.copy(selected,()=>garden.recordCopy(selected.id));await recorder.poll();}
  for(let n=0;n<5;n++)await recorder.poll();
  assert.equal(selected.copyCount,8,'five external copies plus three app copies, without double counting');
  for(let n=1;n<=3;n++) {await adapter.write(image);await observe(image.content,n);}
  report={ok:true,textRoundtrip:true,pngRoundtrip:true,width:size.width,height:size.height,
    nativeRevision:getRevision()!==null,repeatedTextCopies:5,appCopies:3,textCount:selected.copyCount,
    repeatedImageCopies:3,imageCount:garden.snapshot().items.find(item=>item.kind==='image').copyCount,electron:process.versions.electron};
 } catch(e){failure=e;}
 finally {
  try {if(original) { if(original.length) await clipboard.write(original); else clipboard.clear(); }}catch(e){failure=e;}
  if(failure){report.ok=false;console.error('CLIPBOARD_SMOKE_FAIL',failure.message);process.exitCode=1;}
  else console.log('CLIPBOARD_SMOKE_PASS',JSON.stringify({...report,clipboardRestored:true}));
  if(process.env.GARDEN_TEST_REPORT)writeFileSync(process.env.GARDEN_TEST_REPORT,JSON.stringify({...report,clipboardRestored:!failure},null,2));
  app.quit();
 }
}).catch(e=>{console.error(e);app.exit(1);});
