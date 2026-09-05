import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [audioSource, musicSource] = await Promise.all([
  readFile(new URL('../audio.js', import.meta.url), 'utf8'),
  readFile(new URL('../music.js', import.meta.url), 'utf8'),
]);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function createHarness() {
  const download = deferred();
  const decode = deferred();
  const contexts = [];
  let fetchCount = 0;
  const node = () => ({ connect(target) { return target; }, disconnect() {} });
  class AudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    gains = [];
    sources = [];
    decodeCalls = 0;
    constructor() { contexts.push(this); }
    createGain() {
      const gain = {
        target: 0,
        get value() { return this.target; },
        set value(value) { this.target = value; },
        cancelScheduledValues() {},
        setTargetAtTime(value) { this.target = value; },
        setValueAtTime(value) { this.target = value; },
        linearRampToValueAtTime(value) { this.target = value; },
      };
      const output = { ...node(), gain };
      this.gains.push(output);
      return output;
    }
    createBufferSource() {
      const source = {
        ...node(),
        starts: 0,
        stops: 0,
        start() { this.starts++; },
        stop() { this.stops++; },
      };
      this.sources.push(source);
      return source;
    }
    decodeAudioData() { this.decodeCalls++; return decode.promise; }
    async close() { this.state = 'closed'; }
  }
  const context = vm.createContext({
    console,
    AbortController,
    window: { AudioContext },
    fetch: () => { fetchCount++; return download.promise; },
  });
  const musicModule = new vm.SourceTextModule(musicSource, { context, identifier: 'music.js' });
  const audioModule = new vm.SourceTextModule(audioSource, { context, identifier: 'audio.js' });
  await audioModule.link((specifier) => {
    if (specifier === './music.js') return musicModule;
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await audioModule.evaluate();
  return {
    AudioContext,
    AmbientMusic: musicModule.namespace.AmbientMusic,
    BirthdayAudio: audioModule.namespace.BirthdayAudio,
    contexts,
    decode,
    get fetchCount() { return fetchCount; },
    resolveDownload() {
      download.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    },
  };
}

for (const method of ['setMuted', 'setDucked']) {
  test(`${method} during music loading survives asynchronous playback startup`, async () => {
    const harness = await createHarness();
    const audio = new harness.BirthdayAudio();
    await audio.start();
    audio[method](true);
    harness.resolveDownload();
    harness.decode.resolve({ duration: 180 });
    await settle();
    const context = harness.contexts[0];
    assert.equal(context.sources.length, 1, 'the delayed soundtrack must finish loading');
    assert.equal(context.sources[0].starts, 1);
    assert.ok(context.gains.length > 0);
    assert.ok(context.gains.every(({ gain }) => gain.target === 0), 'late playback must remain silent');
    audio[method](false);
    assert.ok(context.gains.some(({ gain }) => gain.target > 0), 'the same soundtrack can be heard again');
    audio.dispose();
  });
}

test('dispose during decoding prevents a delayed source from playing', async () => {
  const harness = await createHarness();
  const context = new harness.AudioContext();
  const music = new harness.AmbientMusic(context);
  music.setLevel(0.3);
  const loading = music.start();
  harness.resolveDownload();
  await settle();
  assert.equal(context.decodeCalls, 1, 'dispose happens while decoding is pending');
  music.dispose();
  harness.decode.resolve({ duration: 180 });
  await loading;
  assert.equal(context.sources.reduce((count, source) => count + source.starts, 0), 0);
});

test('concurrent and later starts share one music playback source', async () => {
  const harness = await createHarness();
  const context = new harness.AudioContext();
  const music = new harness.AmbientMusic(context);
  const first = music.start();
  const second = music.start();
  harness.resolveDownload();
  harness.decode.resolve({ duration: 180 });
  await Promise.all([first, second]);
  await music.start();
  assert.equal(harness.fetchCount, 1);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].starts, 1, 'repeated start must not layer duplicate music');
  music.dispose();
});
