import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Execute the real scene/API offline. Only rendering and geometry storage are stubbed.
// Rotation is evaluated independently with general Rodrigues matrices, so an incorrect
// ordering of the production quaternion operations changes the observed point motion.
class Rotation {
  constructor() { this.matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  setFromAxisAngle({ x, y, z }, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    this.matrix = [
      t*x*x+c, t*x*y-s*z, t*x*z+s*y,
      t*x*y+s*z, t*y*y+c, t*y*z-s*x,
      t*x*z-s*y, t*y*z+s*x, t*z*z+c,
    ];
    return this;
  }
  multiply(other) {
    const a = this.matrix, b = other.matrix;
    this.matrix = Array.from({ length: 9 }, (_, index) => {
      const row = Math.floor(index / 3), column = index % 3;
      return a[row*3]*b[column] + a[row*3+1]*b[column+3] + a[row*3+2]*b[column+6];
    });
    return this;
  }
  apply({ x, y, z }) {
    const m = this.matrix;
    return { x: m[0]*x+m[1]*y+m[2]*z, y: m[3]*x+m[4]*y+m[5]*z, z: m[6]*x+m[7]*y+m[8]*z };
  }
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
}
class Vector2 {
  constructor() { this.set(0, 0); }
  set(x, y) { Object.assign(this, { x, y }); return this; }
  lerp(to, amount) { this.x += (to.x - this.x)*amount; this.y += (to.y - this.y)*amount; return this; }
}
class Node {
  constructor() {
    this.children = [];
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.quaternion = new Rotation();
  }
  add(child) { this.children.push(child); }
  traverse(callback) { callback(this); this.children.forEach(child => child.traverse(callback)); }
}
class Group extends Node {}
class Scene extends Node {}
class PerspectiveCamera extends Node {
  constructor(fov) { super(); this.fov = fov; }
  updateProjectionMatrix() {}
  lookAt() {}
}
class Points extends Node {
  constructor(geometry, material) { super(); Object.assign(this, { geometry, material, isPoints: true }); }
}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  dispose() {}
}
class Float32BufferAttribute {
  constructor(array, itemSize) { this.count = array.length / itemSize; }
}
class ShaderMaterial {
  constructor(options) { Object.assign(this, options); }
  dispose() {}
}
class CubicBezierCurve3 {
  constructor(start, _controlA, _controlB, end) { this.start = start; this.end = end; }
  // Particle locations are not part of the rotation assertion; no GPU is needed.
  getPoint(t) { return new Vector3(this.start.x*(1-t)+this.end.x*t, this.start.y*(1-t)+this.end.y*t, 0); }
  getTangent() { return new Vector3(1, 0, 0); }
}

async function createScene() {
  let renderedScene;
  class WebGLRenderer {
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render(scene) { renderedScene = scene; }
    dispose() {}
  }
  const three = {
    Vector2, Vector3, Quaternion: Rotation, Scene, Group, PerspectiveCamera, Points,
    BufferGeometry, Float32BufferAttribute, ShaderMaterial, CubicBezierCurve3, WebGLRenderer,
    AdditiveBlending: 2, SRGBColorSpace: 'srgb',
    MathUtils: {
      clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
      degToRad: angle => angle*Math.PI/180,
      smoothstep: (value, low, high) => { const t = Math.max(0, Math.min(1, (value-low)/(high-low))); return t*t*(3-2*t); },
    },
  };
  const context = vm.createContext({
    window: { addEventListener() {}, removeEventListener() {} },
    matchMedia: () => ({ matches: false }), innerWidth: 960, innerHeight: 720, devicePixelRatio: 1,
  });
  const dependency = new vm.SyntheticModule(Object.keys(three), function () {
    for (const [key, value] of Object.entries(three)) this.setExport(key, value);
  }, { context });
  const source = await readFile(new URL('../nebula-scene.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => dependency);
  await module.evaluate();
  const canvas = { clientWidth: 960, clientHeight: 720, dataset: {} };
  const scene = module.namespace.createNebulaScene(canvas);
  const advance = seconds => { for (let i = 0; i < Math.round(seconds*60); i++) scene.update(1/60); };
  scene.open();
  scene.setGestureControl(true);
  advance(1);
  return { scene, canvas, advance, rotation: () => renderedScene.children.find(child => child instanceof Group).quaternion };
}

test('real scene keeps horizontal drag direction after a flip, clamps pitch, and restores automatic rotation', async () => {
  const { scene, canvas, advance, rotation } = await createScene();
  try {
    scene.rotateBy(.3, 0);
    advance(1.2);
    const upright = rotation().apply({ x: 0, y: 0, z: 1 });
    assert.ok(upright.x > .25 && upright.z > 0, 'positive yaw must move the visible front point right');

    scene.resetView();
    advance(1.2);
    scene.flip();
    advance(1.5);
    assert.ok(Math.abs(Number(canvas.dataset.flip) - Math.PI) < .001);
    const before = rotation().apply({ x: 0, y: 0, z: -1 });
    assert.ok(before.z > .99, 'after the flip, the opposite object point faces the viewer');
    scene.rotateBy(.3, 0);
    advance(1.2);
    const flipped = rotation().apply({ x: 0, y: 0, z: -1 });
    assert.ok(flipped.x > .25, 'dragging right must still move the visible point right after a flip');
    assert.ok(Math.abs(flipped.x - upright.x) < .001, 'the same drag should have the same horizontal response');

    const limit = 65*Math.PI/180;
    scene.rotateBy(0, 50);
    advance(1.2);
    assert.ok(Math.abs(Number(canvas.dataset.pitch) - limit) < .0001);
    scene.rotateBy(0, -100);
    advance(1.2);
    assert.ok(Math.abs(Number(canvas.dataset.pitch) + limit) < .0001);

    const yaw = Number(canvas.dataset.rotation);
    scene.setGestureControl(false);
    advance(2);
    assert.equal(canvas.dataset.gestureControl, 'false');
    assert.ok(Math.abs(Number(canvas.dataset.pitch)) < .0001);
    assert.ok(Math.abs(Number(canvas.dataset.flip)) < .0001);
    assert.ok(Number(canvas.dataset.rotation) > yaw + .3, 'closing gesture control resumes automatic rotation');
    assert.equal(canvas.dataset.state, 'lit', 'view manipulation must not extinguish the candle');
  } finally {
    scene.dispose();
  }
});
