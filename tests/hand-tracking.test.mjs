import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const fileUrl = new URL('../hand-tracking.js', import.meta.url);
const source = await readFile(fileUrl, 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function createHarness({ failFrameSend = false, failInitSend = false, deferCapture = false } = {}) {
  let requestedConstraints;
  const permissions = [];
  const captures = [];
  const workers = [];
  const timers = new Map();
  const frames = new Map();
  let nextId = 1;
  const video = {
    srcObject: null,
    readyState: 4,
    currentTime: 1,
    plays: 0,
    async play() { this.plays++; },
    pause() {},
  };
  class Worker {
    terminated = false;
    messages = [];
    constructor() { workers.push(this); }
    postMessage(message) {
      if ((failFrameSend && message.type === 'frame') || (failInitSend && message.type === 'init')) {
        throw new Error('Worker transfer failed');
      }
      this.messages.push(message);
    }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage?.({ data }); }
  }
  const context = vm.createContext({
    URL,
    Worker,
    OffscreenCanvas: class {},
    createImageBitmap: () => {
      const bitmap = { closes: 0, close() { this.closes++; } };
      let resolve;
      const promise = new Promise((done) => { resolve = () => done(bitmap); });
      captures.push({ bitmap, resolve });
      if (!deferCapture) resolve();
      return promise;
    },
    navigator: {
      mediaDevices: {
        getUserMedia(constraints) {
          requestedConstraints = constraints;
          const track = { stops: 0, stop() { this.stops++; } };
          const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
          let grant;
          const promise = new Promise((resolve) => { grant = () => resolve(stream); });
          permissions.push({ track, stream, grant });
          return promise;
        },
      },
    },
    setTimeout(callback) { const id = nextId++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const module = new vm.SourceTextModule(source, {
    context,
    identifier: fileUrl.href,
    initializeImportMeta(meta) { meta.url = fileUrl.href; },
  });
  await module.link((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); });
  await module.evaluate();
  const states = [];
  const tracking = new module.namespace.HandTracking({ video, onState: ({ status }) => states.push(status) });
  return {
    tracking, video, workers, states, timers, frames, permissions, captures,
    get track() { return permissions[0].track; },
    get stream() { return permissions[0].stream; },
    grantCamera: (index = 0) => permissions[index].grant(),
    frame(now) {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(now);
    },
    get requestedConstraints() { return requestedConstraints; },
  };
}

test('closing before permission resolves stops a camera stream that arrives late', { timeout: 1000 }, async (t) => {
  const app = await createHarness();
  t.after(() => app.tracking.dispose());
  const startup = app.tracking.start();
  assert.equal(app.requestedConstraints.audio, false);
  app.tracking.stop();
  assert.equal(await startup, false);
  app.grantCamera();
  await settle();
  assert.equal(app.track.stops, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.video.plays, 0);
  assert.equal(app.workers[0].terminated, true);
  assert.equal(app.states.at(-1), 'off');
  assert.ok(!app.states.includes('ready'));
  assert.equal(app.timers.size + app.frames.size, 0);
});

test('recognizer initialization failure releases a camera that already opened', { timeout: 1000 }, async (t) => {
  const app = await createHarness();
  t.after(() => app.tracking.dispose());
  const startup = app.tracking.start();
  app.grantCamera();
  await settle();
  assert.equal(app.video.srcObject, app.stream);
  assert.equal(app.video.plays, 1);
  app.workers[0].emit({ type: 'error' });
  assert.equal(await startup, false);
  assert.equal(app.track.stops, 1);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.workers[0].terminated, true);
  assert.equal(app.states.at(-1), 'error');
  assert.ok(!app.states.includes('ready'));
  assert.equal(app.timers.size + app.frames.size, 0);
});

test('a failed frame transfer closes its bitmap and releases camera resources', { timeout: 1000 }, async (t) => {
  const app = await createHarness({ failFrameSend: true });
  t.after(() => app.tracking.dispose());
  const startup = app.tracking.start();
  app.grantCamera();
  app.workers[0].emit({ type: 'ready' });
  assert.equal(await startup, true);
  app.frame(100);
  await settle();
  assert.equal(app.captures[0].bitmap.closes, 1);
  assert.equal(app.track.stops, 1);
  assert.equal(app.workers[0].terminated, true);
  assert.equal(app.states.at(-1), 'error');
  assert.equal(app.timers.size + app.frames.size, 0);
});

test('stopping and reopening ignores an old capture without disturbing the new camera', { timeout: 1000 }, async (t) => {
  const app = await createHarness({ deferCapture: true });
  t.after(() => app.tracking.dispose());
  const firstStart = app.tracking.start();
  app.grantCamera();
  app.workers[0].emit({ type: 'ready' });
  assert.equal(await firstStart, true);
  app.frame(100);
  app.tracking.stop();
  const secondStart = app.tracking.start();
  app.grantCamera(1);
  app.workers[1].emit({ type: 'ready' });
  assert.equal(await secondStart, true);
  app.captures[0].resolve();
  await settle();
  assert.equal(app.captures[0].bitmap.closes, 1);
  assert.equal(app.track.stops, 1);
  assert.equal(app.permissions[1].track.stops, 0);
  assert.equal(app.video.srcObject, app.permissions[1].stream);
  assert.equal(app.workers[1].terminated, false);
  assert.equal(app.workers[1].messages.filter(({ type }) => type === 'frame').length, 0);
  assert.equal(app.states.at(-1), 'ready');
});

test('synchronous worker initialization send failure is handled without a rejected promise leak', { timeout: 1000 }, async (t) => {
  const app = await createHarness({ failInitSend: true });
  t.after(() => app.tracking.dispose());
  assert.equal(await app.tracking.start(), false);
  await settle();
  assert.equal(app.workers[0].terminated, true);
  assert.equal(app.states.at(-1), 'error');
  assert.equal(app.timers.size + app.frames.size, 0);
});
