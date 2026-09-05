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
    style: {},
    getContext() { return null; },
    classList: { add() {}, toggle() {} },
    addEventListener(type, handler) { handlers.set(type, handler); },
    dispatch(type, event = {}) { handlers.get(type)?.(event); },
    setAttribute() {},
    setPointerCapture() {},
  };
}

async function createExperience({
  microphone = true,
  musicFailure = false,
  noiseRms = 0.006,
  noiseBand = 0.001,
  calibration = [{ seconds: 1 }],
} = {}) {
  let now = 0;
  let nextFrame;
  let extinguishedAt = null;
  let stopped = false;
  let sceneDisposals = 0;
  const cameraCalls = { starts: 0, stops: 0, disposals: 0 };
  const signal = { rms: noiseRms, band: noiseBand };
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
    setGestureControl() {},
    rotateBy() {},
    flip() {},
    resetView() {},
    update() {},
    dispose() { sceneDisposals++; },
    extinguish() { extinguishedAt = now; },
  };
  const documentSurface = { ...eventTarget(), hidden: false, querySelector: element };
  const windowSurface = { ...eventTarget(), AudioContext };
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
    document: documentSurface,
    window: windowSurface,
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
  const handModule = new vm.SyntheticModule(['HandTracking'], function () {
    this.setExport('HandTracking', class {
      constructor({ onState }) { this.onState = onState; }
      async start() {
        cameraCalls.starts++;
        this.onState({ status: 'ready', message: '' });
        return true;
      }
      stop() { cameraCalls.stops++; this.onState({ status: 'off', message: '' }); }
      dispose() { cameraCalls.disposals++; }
    });
  }, { context, identifier: 'hand-tracking.js' });
  const gestureModule = new vm.SyntheticModule(['GestureControls'], function () {
    this.setExport('GestureControls', class {
      update() { return { mode: 'searching', progress: 0 }; }
      reset() {}
    });
  }, { context, identifier: 'gesture-controls.js' });
  const mainModule = new vm.SourceTextModule(mainSource, { context, identifier: 'main.js' });
  await mainModule.link((specifier) => {
    if (specifier === './audio.js') return audioModule;
    if (specifier === './music.js') return musicModule;
    if (specifier === './nebula-scene.js') return sceneModule;
    if (specifier === './hand-tracking.js') return handModule;
    if (specifier === './gesture-controls.js') return gestureModule;
    throw new Error(`Unexpected dependency: ${specifier}`);
  });
  await mainModule.evaluate();
  element('#enter').dispatch('click');
  if (microphone) {
    element('#mic-toggle').dispatch('click');
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Advance the actual requestAnimationFrame loop, including audio.sample and finish.
  const advance = (seconds, rms = noiseRms, band = noiseBand) => {
    Object.assign(signal, { rms, band });
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1000 / 60;
      nextFrame(now);
    }
  };
  if (microphone) {
    for (const step of calibration) advance(step.seconds, step.rms ?? noiseRms, step.band ?? noiseBand);
  }
  return {
    advance,
    element,
    window: windowSurface,
    cameraCalls,
    get sceneDisposals() { return sceneDisposals; },
    get now() { return now; },
    get extinguishedAt() { return extinguishedAt; },
    get stopped() { return stopped; },
  };
}

for (const [rms, minimum, limit] of [[0.009, 0.24, 0.5], [0.012, 0.24, 0.5], [0.02, 0.24, 0.5]]) {
  test(`sustained breath at RMS ${rms} extinguishes in ${minimum}-${limit}s`, async (t) => {
    const app = await createExperience();
    const startedAt = app.now;
    app.advance(limit, rms, 0.002);
    assert.notEqual(app.extinguishedAt, null, 'gentle breath must extinguish the candle');
    const elapsed = (app.extinguishedAt - startedAt) / 1000;
    assert.ok(elapsed >= minimum - 0.001 && elapsed <= limit, `extinguished after ${elapsed}s`);
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

test('a 50ms dropout in a gentle breath does not discard all its progress', async (t) => {
  const app = await createExperience();
  const startedAt = app.now;
  app.advance(0.15, 0.012, 0.002);
  assert.equal(app.extinguishedAt, null);
  app.advance(0.05);
  assert.equal(app.extinguishedAt, null);
  app.advance(0.2, 0.012, 0.002);
  assert.notEqual(app.extinguishedAt, null, 'the second 200ms segment should retain the earlier gentle breath');
  t.diagnostic(`Interrupted breath extinguished after ${((app.extinguishedAt - startedAt) / 1000).toFixed(3)}s.`);
});

test('separate 100ms saturated pulses with 150ms gaps cannot accumulate into a breath', async () => {
  const app = await createExperience();
  for (let pulse = 0; pulse < 8; pulse++) {
    app.advance(0.1, 1, 1);
    app.advance(0.15);
    assert.equal(app.extinguishedAt, null, `pulse ${pulse + 1} must not extinguish the candle`);
  }
  app.advance(3);
  assert.equal(app.extinguishedAt, null);
});

test('a low-gain microphone still detects a gentle breath above its quiet baseline', async (t) => {
  const app = await createExperience({ noiseRms: 0.0008, noiseBand: 0.0001 });
  app.advance(1);
  assert.equal(app.extinguishedAt, null);
  const startedAt = app.now;
  app.advance(0.5, 0.002, 0.0003);
  assert.notEqual(app.extinguishedAt, null, 'a low input gain must not make blowing impossible');
  const elapsed = (app.extinguishedAt - startedAt) / 1000;
  assert.ok(elapsed >= 0.239 && elapsed <= 0.5, `extinguished after ${elapsed}s`);
  t.diagnostic(`Low-gain breath extinguished after ${elapsed.toFixed(3)}s.`);
});

test('brief blowing during calibration does not hide a later gentle breath', async (t) => {
  const app = await createExperience({ calibration: [
    { seconds: 0.2 },
    { seconds: 0.2, rms: 0.04, band: 0.008 },
    { seconds: 0.6 },
  ] });
  app.advance(0.5);
  assert.equal(app.extinguishedAt, null, 'calibration noise must not trigger a delayed extinguish');
  const startedAt = app.now;
  app.advance(0.5, 0.009, 0.002);
  assert.notEqual(app.extinguishedAt, null, 'an early puff must not permanently raise the noise floor');
  const elapsed = (app.extinguishedAt - startedAt) / 1000;
  assert.ok(elapsed >= 0.239 && elapsed <= 0.5, `extinguished after ${elapsed}s`);
  t.diagnostic(`Breath after noisy calibration extinguished after ${elapsed.toFixed(3)}s.`);
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
  app.advance(0.8, 0.04, 0.002);
  assert.notEqual(app.extinguishedAt, null, 'a failed soundtrack must not block blowing');
  assert.equal(app.stopped, true);
});

test('a page restored from BFCache can reopen the camera and retains music preference', async () => {
  const app = await createExperience({ microphone: false });
  await new Promise((resolve) => setImmediate(resolve));
  app.element('#camera-toggle').dispatch('click');
  assert.equal(app.cameraCalls.starts, 1);
  assert.equal(app.element('#app').dataset.musicState, 'playing');
  app.window.dispatch('pagehide', { persisted: true });
  assert.equal(app.cameraCalls.stops, 1);
  assert.equal(app.cameraCalls.disposals, 0);
  assert.equal(app.sceneDisposals, 0);
  assert.equal(app.element('#app').dataset.musicState, 'muted');
  app.window.dispatch('pageshow', { persisted: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.element('#app').dataset.musicState, 'playing');
  app.element('#camera-toggle').dispatch('click');
  assert.equal(app.cameraCalls.starts, 2);

  app.element('#sound-toggle').dispatch('click');
  app.window.dispatch('pagehide', { persisted: true });
  app.window.dispatch('pageshow', { persisted: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.element('#app').dataset.musicState, 'muted', 'returning must respect a manual mute');
  assert.equal(app.sceneDisposals, 0);
});
