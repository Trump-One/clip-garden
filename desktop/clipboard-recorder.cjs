const { createHash } = require('node:crypto');
const keyOf = clip => clip ? clip.kind + ':' + createHash('sha256').update(clip.content).digest('hex') : '';

function createClipboardRecorder({ adapter, getRevision = () => null, onCapture }) {
  let queue = Promise.resolve(), polling = false, lastRevision = null, lastKey = '', initialized = false;
  const enqueue = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  return {
    initialize: () => enqueue(async () => {
      // Do not import what was on the clipboard before this app started.
      const clip = await adapter.read();
      lastRevision = getRevision(); lastKey = keyOf(clip); initialized = true;
    }),
    async poll() {
      if (polling) return false;
      polling = true;
      try {
        return await enqueue(async () => {
          const before = getRevision();
          if (initialized && before !== null && before === lastRevision) return false;
          const clip = await adapter.read();
          const after = getRevision();
          // A copy (or delayed rendering) during the asynchronous read needs a fresh read.
          if (before !== null && after !== null && before !== after) return false;
          const key = keyOf(clip);
          const changed = initialized && (before !== null && lastRevision !== null ? before !== lastRevision : key !== lastKey);
          if (clip && changed) onCapture(clip);
          lastRevision = after; lastKey = key; initialized = true;
          return Boolean(clip && changed);
        });
      } finally { polling = false; }
    },
    copy: (item, onCopied = onCapture) => enqueue(async () => {
      await adapter.write(item);
      // Count successful app copies once; the next background poll must not count them again.
      lastRevision = getRevision(); lastKey = keyOf(item); initialized = true;
      onCopied(item);
    })
  };
}
module.exports = { createClipboardRecorder };
