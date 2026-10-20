// Real OS clipboard test; clone read entries because Electron forbids writing them directly.
const {app,clipboard,ClipboardItem,nativeImage}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {createClipboardAdapter}=require('../desktop/clipboard.cjs');
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
  report={ok:true,textRoundtrip:true,pngRoundtrip:true,width:size.width,height:size.height,electron:process.versions.electron};
 } catch(e){failure=e;}
 finally {
  try {if(original) { if(original.length) await clipboard.write(original); else clipboard.clear(); }}catch(e){failure=e;}
  if(failure){report.ok=false;console.error('CLIPBOARD_SMOKE_FAIL',failure.message);process.exitCode=1;}
  else console.log('CLIPBOARD_SMOKE_PASS',JSON.stringify({...report,clipboardRestored:true}));
  if(process.env.GARDEN_TEST_REPORT)writeFileSync(process.env.GARDEN_TEST_REPORT,JSON.stringify({...report,clipboardRestored:!failure},null,2));
  app.quit();
 }
}).catch(e=>{console.error(e);app.exit(1);});
