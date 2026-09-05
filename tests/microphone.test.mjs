import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [mainSource, audioSource, musicSource] = await Promise.all([
  readFile(new URL('../main.js', import.meta.url), 'utf8'),
  readFile(new URL('../audio.js', import.meta.url), 'utf8'),
  readFile(new URL('../music.js', import.meta.url), 'utf8'),
]);

function eventTarget() {
  const handlers = new Map();
  return {
    dataset: {},
    classList: { add() {}, toggle() {} },
    addEventListener(type, handler) { handlers.set(type, handler); },
    dispatch(type, event = {}) { handlers.get(type)?.(event); },
    setAttribute() {},
    setPointerCapture() {},
  };
}

async function createExperience({ microphone = true, musicFailure = false } = {}) {
  let now = 0;
  let nextFrame;
  let extinguishedAt = null;
  let stopped = false;
  const signal = { rms: 0.006, band: 0.001 };
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, eventTarget());
    return elements.get(selector);
  };
  const param = () => ({
    value: 0,
    cancelScheduledValues() {},
    setTargetAtTime() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const audioNode = () => ({
    connect(target) { return target; },
    disconnect() {},
    start() {},
    stop() {},
    gain: param(),
    frequency: param(),
  });
  class AudioContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 48000;
    destination = {};
    createGain = audioNode;
    createOscillator = audioNode;
    createBufferSource = audioNode;
    createMediaStreamSource = audioNode;
    async decodeAudioData() { return { duration: 180 }; }
    createAnalyser() {
      return {
        ...audioNode(),
        fftSize: 1024,
        frequencyBinCount: 512,
        getFloatTimeDomainData(data) {
          for (let i = 0; i < data.length; i++) data[i] = (i % 2 ? 1 : -1) * signal.rms;
        },
        getFloatFrequencyData(data) { data.fill(20 * Math.log10(signal.band)); },
      };
    }
    close() {}
  }
  const scene = {
    open() {},
    setBlowStrength() {},
    update() {},
    dispose() {},
    extinguish() { extinguishedAt = now; },
  };
  const context = vm.createContext({
    console,
    AbortController,
    fetch: async () => ({
      ok: !musicFailure,
      status: musicFailure ? 503 : 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    }),
    performance: { now: () => now },
    requestAnimationFrame: (callback) => { nextFrame = callback; },
    document: { ...eventTarget(), hidden: false, querySelector: element },
    window: { ...eventTarget(), AudioContext },
    navigator: {
      mediaDevices: {
        async getUserMedia() { return { getTracks: () => [{ stop() { stopped = true; } }] }; },
      },
    },
  });
  const audioModule = new vm.SourceTextModule(audioSource, { context, identifier: 'audio.js' });
  const musicModule = new vm.SourceTextModule(musicSource, { context, identifier: 'music.js' });
  const sceneModule = new vm.SyntheticModule(['createNebulaScene'], function () {
    this.setExport('createNebulaScene', () => scene);
  }, { context, identifier: 'nebula-scene.js' });
  const mainModule = new vm.SourceTextModule(mainSource, { context, identifier: 'main.js' });
  await mainModule.link((specifier) => {
    if (specifier === './audio.js') return audioModule;
    if (specifier === './music.js') return musicModule;
    if (specifier === './nebula-scene.js') return sceneModule;
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await mainModule.evaluate();
  element('#enter').dispatch('click');
  if (microphone) {
    element('#mic-toggle').dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Advance the actual requestAnimationFrame loop, including audio.sample and finish.
  const advance = (seconds, rms = 0.006, band = 0.001) => {
    Object.assign(signal, { rms, band });
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1000 / 60;
      nextFrame(now);
    }
  };
  if (microphone) advance(1);
  return {
    advance,
    element,
    get now() { return now; },
    get extinguishedAt() { return extinguishedAt; },
    get stopped() { return stopped; },
  };
}

for (const [rms, limit] of [[0.04, 1.5], [0.03, 2]]) {
  test(`sustained breath at RMS ${rms} extinguishes within ${limit}s`, async (t) => {
    const app = await createExperience();
    const startedAt = app.now;
    app.advance(limit, rms, 0.002);
    assert.notEqual(app.extinguishedAt, null, 'gentle breath must extinguish the candle');
    const elapsed = (app.extinguishedAt - startedAt) / 1000;
    assert.ok(elapsed <= limit, `extinguished after ${elapsed}s`);
    assert.equal(app.stopped, true, 'microphone is released after extinguishing');
    t.diagnostic(`Extinguished after ${elapsed.toFixed(3)}s of simulated breath.`);
  });
}

test('ten seconds of quiet microphone input does not extinguish', async () => {
  const app = await createExperience();
  app.advance(10);
  assert.equal(app.extinguishedAt, null);
});

test('a 100ms saturated pulse followed by silence does not extinguish', async () => {
  const app = await createExperience();
  app.advance(0.1, 1, 1);
  app.advance(3);
  assert.equal(app.extinguishedAt, null);
});

test('manual hold needs longer than half a second and finishes within one second', async () => {
  const app = await createExperience({ microphone: false });
  app.element('#scene').dispatch('pointerdown', { isPrimary: true, pointerId: 1 });
  app.advance(0.5);
  assert.equal(app.extinguishedAt, null);
  app.advance(0.5);
  assert.notEqual(app.extinguishedAt, null);
  assert.ok(app.extinguishedAt >= 950 && app.extinguishedAt <= 1000);
});

test('music loading failure leaves microphone calibration and blowing usable', async () => {
  const app = await createExperience({ musicFailure: true });
  app.advance(1.5, 0.04, 0.002);
  assert.notEqual(app.extinguishedAt, null, 'a failed soundtrack must not block blowing');
  assert.equal(app.stopped, true);
});
