import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Garden } = require('../desktop/core.cjs');
const { createClipboardRecorder } = require('../desktop/clipboard-recorder.cjs');

async function fixture(native = true) {
  const garden = new Garden();
  let clip = { kind: 'text', content: 'already present at launch' }, revision = 10, failRead = false, failWrite = false;
  const adapter = {
    async read() { if (failRead) throw Error('clipboard busy'); return clip; },
    async write(value) { if (failWrite) throw Error('write denied'); clip = { kind: value.kind, content: value.content }; revision++; }
  };
  const recorder = createClipboardRecorder({ adapter, getRevision: () => native ? revision : null, onCapture: value => garden.capture(value.kind, value.content) });
  await recorder.initialize();
  return { garden, adapter, recorder,
    external(value) { clip = value; revision += 3; },
    failRead(value) { failRead = value; }, failWrite(value) { failWrite = value; } };
}

test('startup and idle polling never add usage; repeating identical text counts once per observed write', async () => {
  const f = await fixture();
  await f.recorder.poll(); assert.equal(f.garden.snapshot().items.length, 0);
  for (let n = 1; n <= 5; n++) {
    f.external({ kind: 'text', content: 'same text' });
    await f.recorder.poll(); await f.recorder.poll(); await f.recorder.poll();
    assert.equal(f.garden.snapshot().items.length, 1);
    assert.equal(f.garden.snapshot().items[0].copyCount, n); // Sequence deltas are NOT copy totals.
  }
});

test('a new write of the startup content is counted', async () => {
  const f = await fixture();
  f.external({ kind: 'text', content: 'already present at launch' });
  await f.recorder.poll(); assert.equal(f.garden.snapshot().items[0].copyCount, 1);
});

test('identical images count again, alternating text reuses the existing item', async () => {
  const f = await fixture();
  for (const content of ['A', 'B', 'A']) { f.external({ kind: 'text', content }); await f.recorder.poll(); }
  const image = { kind: 'image', content: 'data:image/png;base64,aGVsbG8=' };
  for (let i = 0; i < 2; i++) { f.external(image); await f.recorder.poll(); }
  assert.deepEqual(f.garden.snapshot().items.map(i => i.copyCount), [2, 1, 2]);
});

test('app copy increments the selected item once, persists it and queues account sync without recapture', async () => {
  const f = await fixture();
  f.garden.useSession({ token: 'test', user: { id: 'test-user' } });
  const item = f.garden.capture('text', 'selected');
  let saved; f.garden.persist = value => { saved = structuredClone(value); };
  for (let i = 0; i < 3; i++) {
    await f.recorder.copy(item, () => f.garden.recordCopy(item.id));
    await f.recorder.poll(); await f.recorder.poll();
  }
  assert.equal(item.copyCount, 4);
  assert.equal(f.garden.space.pending[item.id].payload.copyCount, 4);
  assert.equal(saved.spaces['test-user'].items[0].copyCount, 4);
});

test('failed writes add no usage; failed reads are retried without losing the copy', async () => {
  const f = await fixture();
  const item = f.garden.capture('text', 'failure case');
  f.failWrite(true); await assert.rejects(f.recorder.copy(item), /write denied/);
  assert.equal(item.copyCount, 1);
  f.external(item); f.failRead(true); await assert.rejects(f.recorder.poll(), /clipboard busy/);
  f.failRead(false); await f.recorder.poll(); await f.recorder.poll();
  assert.equal(item.copyCount, 2);
});

test('empty or sensitivity-filtered results do not count and do not hide the next same-content copy', async () => {
  const f = await fixture();
  for (const clip of [{ kind: 'text', content: 'visible' }, null, { kind: 'text', content: 'visible' }]) {
    f.external(clip); await f.recorder.poll();
  }
  assert.equal(f.garden.snapshot().items[0].copyCount, 2);
});

test('a clipboard change during an asynchronous read is retried instead of attributing stale contents', async () => {
  const f = await fixture();
  f.external({ kind: 'text', content: 'old read' });
  const read = f.adapter.read;
  f.adapter.read = async () => { const old = await read(); f.external({ kind: 'text', content: 'new copy' }); return old; };
  assert.equal(await f.recorder.poll(), false);
  assert.equal(f.garden.snapshot().items.length, 0);
  f.adapter.read = read; await f.recorder.poll(); await f.recorder.poll();
  assert.equal(f.garden.snapshot().items[0].content, 'new copy');
  assert.equal(f.garden.snapshot().items[0].copyCount, 1);
});

test('overlapping polls and an app copy are serialized without a duplicate count', async () => {
  const f = await fixture();
  const item = f.garden.capture('text', 'serial copy');
  f.external(item);
  await Promise.all([f.recorder.poll(), f.recorder.poll(), f.recorder.copy(item), f.recorder.poll()]);
  await f.recorder.poll(); assert.equal(item.copyCount, 3); // Initial + external + app.
});

test('content-only fallback keeps working and app copies still count once', async () => {
  const f = await fixture(false);
  f.external({ kind: 'text', content: 'fallback' });
  await f.recorder.poll(); await f.recorder.poll();
  const item = f.garden.snapshot().items[0];
  await f.recorder.copy(item); await f.recorder.poll();
  assert.equal(item.copyCount, 2);
});
