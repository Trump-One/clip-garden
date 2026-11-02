// These are change identifiers, not copy counters: never add their numeric delta.
function createClipboardRevisionReader(platform = process.platform) {
  if (!['win32', 'darwin'].includes(platform)) return () => null;
  const koffi = require('koffi');
  if (platform === 'win32') {
    const read = koffi.load('user32.dll').func('uint32_t __stdcall GetClipboardSequenceNumber()');
    return () => read() || null; // Zero means clipboard access is unavailable.
  }

  // AppKit must be loaded before asking the Objective-C runtime for NSPasteboard.
  koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const getClass = objc.func('void *objc_getClass(const char *name)');
  const selector = objc.func('void *sel_registerName(const char *name)');
  const sendObject = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const sendCount = objc.func('objc_msgSend', 'intptr_t', ['void *', 'void *']);
  const sendVoid = objc.func('objc_msgSend', 'void', ['void *', 'void *']);
  const poolClass = getClass('NSAutoreleasePool'), pasteboardClass = getClass('NSPasteboard');
  const create = selector('new'), drain = selector('drain');
  const general = selector('generalPasteboard'), changeCount = selector('changeCount');
  return () => {
    const pool = sendObject(poolClass, create);
    try { return sendCount(sendObject(pasteboardClass, general), changeCount); }
    finally { sendVoid(pool, drain); }
  };
}
module.exports = { createClipboardRevisionReader };
