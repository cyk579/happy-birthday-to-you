import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../gesture-controls.js', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(source);
await module.link((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); });
await module.evaluate();
const { GestureControls } = module.namespace;

// Keep palm width fixed and move the entire hand, so tests express visible motion.
function hand(pinchRatio = 0.7, x = 0.5, y = 0.5) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  points[5] = { x: x - 0.1, y, z: 0 };
  points[17] = { x: x + 0.1, y, z: 0 };
  points[4] = { x: x - pinchRatio * 0.1, y: y - 0.1, z: 0 };
  points[8] = { x: x + pinchRatio * 0.1, y: y - 0.1, z: 0 };
  return points;
}

function createControls() {
  const calls = { grabs: [], rotations: [], flips: 0, resets: 0 };
  const controls = new GestureControls({
    onGrab: (value) => calls.grabs.push(value),
    onRotate: (yaw, pitch) => calls.rotations.push([yaw, pitch]),
    onFlip: () => calls.flips++,
    onReset: () => calls.resets++,
  });
  const update = (landmarks, now = 0, gesture = 'None', score = 1) =>
    controls.update({ landmarks, gesture, score }, now);
  return { controls, calls, update };
}

test('no hand remains searching and cannot trigger a scene action', () => {
  const { calls, update } = createControls();
  for (const now of [0, 1000, 2000]) {
    const state = update([], now, 'Victory');
    assert.equal(state.mode, 'searching');
    assert.equal(state.progress, 0);
  }
  assert.equal(calls.flips + calls.resets + calls.rotations.length, 0);
  assert.ok(calls.grabs.every((grabbing) => grabbing === false));
});

test('pinch hysteresis keeps a grab stable between its enter and release distances', () => {
  const { calls, update } = createControls();
  assert.equal(update(hand(0.3), 0).mode, 'grabbing');
  assert.equal(update(hand(0.41), 50).mode, 'grabbing');
  assert.equal(update(hand(0.46), 100).mode, 'grabbing');
  assert.equal(update(hand(0.55), 150).mode, 'ready');
  assert.equal(update(hand(0.41), 200).mode, 'ready');
  assert.equal(update(hand(0.3), 250).mode, 'grabbing');
  assert.deepEqual(calls.grabs, [true, false, true]);
});

test('a grab rotates by mirrored hand movement and does not move for a steady hand', () => {
  const { calls, update } = createControls();
  update(hand(0.2), 0);
  update(hand(0.2, 0.53, 0.54), 50);
  const yaw = calls.rotations.reduce((sum, value) => sum + value[0], 0);
  const pitch = calls.rotations.reduce((sum, value) => sum + value[1], 0);
  assert.ok(Math.abs(yaw + 0.15) < 1e-6, `unexpected yaw ${yaw}`);
  assert.ok(Math.abs(pitch - 0.128) < 1e-6, `unexpected pitch ${pitch}`);
  update(hand(0.2, 0.53, 0.54), 100);
  assert.equal(calls.rotations.reduce((sum, value) => sum + value[0], 0), yaw);
  assert.equal(calls.rotations.reduce((sum, value) => sum + value[1], 0), pitch);
});

test('an open palm wave rotates without pinching and a steady palm stays still', () => {
  const { calls, update } = createControls();
  assert.equal(update(hand(1.2), 0, 'Open_Palm', .9).mode, 'waving');
  assert.equal(update(hand(1.2, .56, .53), 50, 'Open_Palm', .9).mode, 'waving');
  assert.equal(calls.rotations.length, 1);
  assert.ok(Math.abs(calls.rotations[0][0] + .3) < 1e-6);
  assert.ok(Math.abs(calls.rotations[0][1] - .096) < 1e-6);
  update(hand(1.2, .56, .53), 100, 'Open_Palm', .9);
  assert.equal(calls.rotations.length, 1);
});

test('an uncertain open palm cannot start a rotation', () => {
  const { calls, update } = createControls();
  for (let now = 0; now <= 400; now += 50) {
    assert.equal(update(hand(1.2, .4 + now / 4000), now, 'Open_Palm', .54).mode, 'ready');
  }
  assert.equal(calls.rotations.length, 0);
  assert.equal(calls.grabs.length, 0);
});

test('open palm confidence hysteresis releases uncertain tracking and reacquires without a jump', () => {
  const { calls, update } = createControls();
  update(hand(1.2, .3), 0, 'Open_Palm', .61);
  assert.equal(update(hand(1.2, .32), 50, 'Open_Palm', .5).mode, 'waving');
  assert.equal(update(hand(1.2, .34), 100, 'Open_Palm', .44).mode, 'ready');
  const beforeReacquiring = calls.rotations.length;
  update(hand(1.2, .8), 150, 'Open_Palm', .9);
  assert.equal(calls.rotations.length, beforeReacquiring);
  update(hand(1.2, .78), 200, 'Open_Palm', .9);
  assert.ok(Math.abs(calls.rotations.at(-1)[0] - .1) < 1e-6);
});

test('switching from a pinch to a palm reanchors without a cursor-induced rotation', () => {
  const { calls, update } = createControls();
  update(hand(.2), 0);
  assert.equal(update(hand(1.2), 50, 'Open_Palm', .9).mode, 'waving');
  assert.equal(calls.rotations.length, 0);
  assert.equal(update(hand(.2), 100).mode, 'grabbing');
  assert.equal(calls.rotations.length, 0);
});

test('V and fist holds take priority over a previously waving palm', () => {
  for (const [pose, mode] of [['Victory', 'flip'], ['Closed_Fist', 'reset']]) {
    const { calls, update } = createControls();
    update(hand(1.2), 0, 'Open_Palm', .9);
    assert.equal(update(hand(.2, .56), 50, pose, .95).mode, mode);
    assert.equal(calls.rotations.length, 0);
    assert.deepEqual(calls.grabs, [true, false]);
  }
});

test('losing the hand releases the grab and reacquiring elsewhere causes no jump', () => {
  const { calls, update } = createControls();
  update(hand(0.2, 0.2), 0);
  update(hand(0.2, 0.25), 50);
  update([], 100);
  const beforeReacquiring = calls.rotations.length;
  update(hand(0.2, 0.8), 150);
  assert.ok(calls.rotations.slice(beforeReacquiring).every(([yaw, pitch]) => yaw === 0 && pitch === 0));
  assert.deepEqual(calls.grabs, [true, false, true]);
  update(hand(0.2, 0.82), 200);
  const movement = calls.rotations.slice(beforeReacquiring).reduce((sum, [yaw]) => sum + yaw, 0);
  assert.ok(Math.abs(movement + 0.1) < 1e-6, `unexpected resumed movement ${movement}`);
});

for (const [gesture, hold, counter, mode] of [
  ['Victory', 650, 'flips', 'flip'],
  ['Closed_Fist', 800, 'resets', 'reset'],
]) {
  test(`${gesture} triggers once per held pose and requires release to trigger again`, () => {
    const { calls, update } = createControls();
    let now = 0;
    const frames = (duration, pose = gesture) => {
      const end = now + duration;
      let state;
      while (now < end) {
        now = Math.min(end, now + 50);
        state = update(hand(), now, pose);
      }
      return state;
    };
    update(hand(), 0, gesture);
    const pending = frames(hold / 2);
    assert.equal(calls[counter], 0);
    assert.ok(pending.progress > 0 && pending.progress < 1);
    assert.equal(frames(hold / 2 + 1).mode, mode);
    frames(3000);
    assert.equal(calls[counter], 1);
    frames(250, 'None');
    frames(hold + 100);
    assert.equal(calls[counter], 2);
  });
}

test('low confidence poses cannot flip or reset the cake', () => {
  const { calls, update } = createControls();
  for (let now = 0; now <= 2000; now += 50) update(hand(), now, 'Victory', 0.69);
  for (let now = 2050; now <= 4050; now += 50) update(hand(), now, 'Closed_Fist', 0.74);
  assert.equal(calls.flips, 0);
  assert.equal(calls.resets, 0);
});

test('reset releases a live grab and clears its previous hand position', () => {
  const { controls, calls, update } = createControls();
  update(hand(0.2, 0.2), 0);
  controls.reset();
  update(hand(0.2, 0.8), 1000);
  assert.deepEqual(calls.grabs, [true, false, true]);
  assert.ok(calls.rotations.every(([yaw, pitch]) => yaw === 0 && pitch === 0));
});
