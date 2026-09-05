import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js';

// All visible geometry consists of points, including frosting, candle and flame.
const vertexShader = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uTime;
  uniform float uPixels;
  uniform float uOpacity;
  uniform float uWind;
  uniform float uKind;
  uniform float uAge;
  void main() {
    vec3 p = position;
    float phase = aSeed * 62.83;
    if (uKind < 0.5) {
      // Bounded displacement preserves the tiers, unlike ambient particle drift.
      p += vec3(sin(phase + uTime*.7), cos(phase*.7 + uTime*.6),
                sin(phase*.9 - uTime*.5)) * .009;
    } else if (uKind < 1.5) {
      float h = p.y;
      p.x += (sin(uTime*6.0 + h*8.0)*.025 + uWind*.24) * h;
      p.z += cos(phase + uTime*4.0)*.012*h;
      p.y *= 1.0 - uWind*.42;
    } else if (uKind < 2.5) {
      p.y += uAge * (.19 + aSeed*.2);
      p.x += sin(uAge*1.8 + phase)*uAge*.055;
      p.z += cos(uAge + phase)*uAge*.04;
    } else if (uKind < 3.5) {
      p = position * uAge;
      p.y -= .48 * uAge * uAge;
    } else {
      p.y += sin(uTime*.22+phase)*.12;
      p.x += cos(uTime*.18+phase)*.1;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize*uPixels*7.0/-mv.z, .75, 20.0);
    vColor = aColor;
    vAlpha = aAlpha*uOpacity*(.88+.12*sin(uTime*1.2+phase));
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord*2.0-1.0;
    float r2 = dot(p,p);
    if (r2 > 1.0) discard;
    float soft = exp(-r2*3.8) * (1.0-smoothstep(.65,1.0,r2));
    gl_FragColor = vec4(vColor, soft*vAlpha);
  }
`;

const TAU = Math.PI * 2;
const rose = [.89, .57, .53];
const roseLight = [1.0, .82, .74];
const silver = [.56, .62, .92];
const silverLight = [.86, .88, 1.0];
const gold = [1.0, .74, .34];

function gaussian() {
  return Math.sqrt(-2*Math.log(Math.max(.00001, Math.random()))) * Math.cos(TAU*Math.random());
}

class Cloud {
  constructor() { this.positions=[]; this.colors=[]; this.sizes=[]; this.alphas=[]; this.seeds=[]; }
  add(x,y,z,color,alpha=.5,size=1.5) {
    const variation=.78+Math.random()*.36;
    this.positions.push(x,y,z);
    this.colors.push(...color.map(c=>c*variation));
    this.alphas.push(alpha);
    this.sizes.push(size);
    this.seeds.push(Math.random());
  }
  mesh(kind=0) {
    const geometry=new THREE.BufferGeometry();
    for (const [name,array,itemSize] of [
      ['position',this.positions,3],['aColor',this.colors,3],['aSize',this.sizes,1],
      ['aAlpha',this.alphas,1],['aSeed',this.seeds,1]
    ]) geometry.setAttribute(name,new THREE.Float32BufferAttribute(array,itemSize));
    const material=new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent:true, depthWrite:false,
      blending:THREE.AdditiveBlending,
      uniforms:{uTime:{value:0},uPixels:{value:1},uOpacity:{value:1},uWind:{value:0},uKind:{value:kind},uAge:{value:0}}
    });
    const points=new THREE.Points(geometry,material);
    points.frustumCulled=false;
    return points;
  }
}

function addTier(cloud, {radius,bottom,height,color,highlight,phase}, density) {
  const top=bottom+height;
  // Surface sampling defines light rims and a translucent interior.
  for(let i=0;i<21000*density;i++) {
    const a=Math.random()*TAU,t=Math.random();
    const r=radius+gaussian()*.024+Math.sin(a*7+phase)*.006;
    const billow=.66+.34*Math.sin(a*3+t*6+phase)**2;
    cloud.add(Math.cos(a)*r,bottom+t*height,Math.sin(a)*r,color,.32*billow,1.05+Math.random()*1.4);
  }
  for(let i=0;i<14000*density;i++) {
    const a=Math.random()*TAU,r=radius*Math.sqrt(Math.random());
    cloud.add(Math.cos(a)*r,top+gaussian()*.021,Math.sin(a)*r,highlight,.36,1.15+Math.random()*1.2);
  }
  for(let i=0;i<13000*density;i++) {
    const a=Math.random()*TAU,r=radius+gaussian()*.022;
    cloud.add(Math.cos(a)*r,top+gaussian()*.026,Math.sin(a)*r,highlight,.65,1.15+Math.random()*1.1);
  }
  // Scalloped ribbons make continuous rotation visible on the circular layers.
  for(let i=0;i<13000*density;i++) {
    const a=Math.random()*TAU;
    const sag=Math.pow(.5+.5*Math.cos(a*7+phase),.82);
    const y=top-.085-sag*height*.35+gaussian()*.027;
    const r=radius+.012+gaussian()*.024;
    cloud.add(Math.cos(a)*r,y,Math.sin(a)*r,highlight,.4,1.05+Math.random()*1.1);
  }
  for(let i=0;i<5500*density;i++) {
    const a=Math.random()*TAU,r=radius*Math.sqrt(Math.random());
    cloud.add(Math.cos(a)*r,bottom+Math.random()*height,Math.sin(a)*r,color,.14,1+Math.random());
  }
  for(let i=0;i<1700*density;i++) {
    const a=Math.random()*TAU,r=radius+gaussian()*.065;
    cloud.add(Math.cos(a)*r,bottom+Math.random()*height,Math.sin(a)*r,color,.065,4+Math.random()*5);
  }
}

export function createNebulaScene(canvas) {
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(32,1,.1,100);
  const root=new THREE.Group();
  root.position.y=-1.22;
  scene.add(root);
  const density=matchMedia('(max-width: 620px)').matches ? .56 : 1;
  const cake=new Cloud();
  addTier(cake,{radius:1.62,bottom:0,height:.87,color:rose,highlight:roseLight,phase:.6},density);
  addTier(cake,{radius:1.24,bottom:.89,height:.69,color:silver,highlight:silverLight,phase:1.7},density);
  root.add(cake.mesh());

  const candle=new Cloud();
  for(let i=0;i<4200*density;i++) {
    const a=Math.random()*TAU,y=Math.random()*.43,r=.072+gaussian()*.012;
    candle.add(Math.cos(a)*r,1.60+y,Math.sin(a)*r,gold,.38,1.1+Math.random()*1.1);
  }
  root.add(candle.mesh());

  const fire=new Cloud();
  for(let i=0;i<7000*density;i++) {
    const h=Math.random(),radius=Math.pow(Math.sin(Math.PI*h),.85)*(.135-.055*h);
    const a=Math.random()*TAU,r=Math.sqrt(Math.random())*radius;
    fire.add(Math.cos(a)*r,h*.63,Math.sin(a)*r,[1,.74+h*.15,.32+h*.23],.6,1.1+Math.random()*1.5);
  }
  for(let i=0;i<180*density;i++) fire.add(gaussian()*.035,.23+gaussian()*.075,gaussian()*.025,gold,.035,8+Math.random()*7);
  const flame=fire.mesh(1);
  flame.position.y=2.045;
  root.add(flame);

  const vapor=new Cloud();
  for(let i=0;i<1200*density;i++) vapor.add(gaussian()*.055,Math.random()*.14,gaussian()*.055,[.66,.72,.85],.075,3+Math.random()*6);
  const smoke=vapor.mesh(2);
  smoke.position.y=2.07;
  smoke.visible=false;
  root.add(smoke);

  const burst=new Cloud();
  for(let i=0;i<900*density;i++) {
    const a=Math.random()*TAU,speed=.25+Math.random()*1.8;
    burst.add(Math.cos(a)*speed,.8+Math.random()*1.8,Math.sin(a)*speed,[roseLight,silverLight,gold][i%3],.85,1.7+Math.random()*2.5);
  }
  const confetti=burst.mesh(3);
  confetti.position.y=.6;
  confetti.visible=false;
  scene.add(confetti);

  const dust=new Cloud();
  for(let i=0;i<380;i++) dust.add((Math.random()-.5)*8,(Math.random()-.5)*5,(Math.random()-.5)*5,[.65,.64,.75],.15,1+Math.random());
  scene.add(dust.mesh(4));

  const clouds=[];
  scene.traverse(o=>{if(o.isPoints) clouds.push(o);});
  let time=0,angle=0,extinguishedAt=null,disposed=false;
  const pointer=new THREE.Vector2();
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let distance=7.4;
  function resize() {
    const width=canvas.clientWidth||innerWidth,height=canvas.clientHeight||innerHeight;
    const dpr=Math.min(devicePixelRatio,1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    distance=Math.max(6.9,3.85/(2*tan*camera.aspect));
    camera.updateProjectionMatrix();
    clouds.forEach(p=>{p.material.uniforms.uPixels.value=dpr*height/720;});
  }
  function setBlowStrength(strength) {flame.material.uniforms.uWind.value=THREE.MathUtils.clamp(strength,0,1);}
  function extinguish() {
    if(extinguishedAt!==null) return;
    extinguishedAt=time;
    smoke.visible=true;
    confetti.visible=true;
  }
  function update(dt) {
    if(disposed) return;
    time+=dt;
    angle+=dt*(reducedMotion ? .035 : .17);
    root.rotation.y=angle;
    camera.position.set(reducedMotion?0:pointer.x*.13,distance*.13,distance);
    camera.lookAt(0,0,0);
    clouds.forEach(p=>{p.material.uniforms.uTime.value=time;});
    if(extinguishedAt!==null) {
      const age=time-extinguishedAt;
      flame.material.uniforms.uOpacity.value=Math.max(0,1-age/.45);
      flame.scale.y=Math.max(.02,1-age/.55);
      flame.visible=age<.55;
      smoke.material.uniforms.uAge.value=age;
      smoke.material.uniforms.uOpacity.value=Math.max(0,1-age/6);
      smoke.visible=age<6;
      confetti.material.uniforms.uAge.value=age;
      confetti.material.uniforms.uOpacity.value=Math.max(0,1-age/4);
      confetti.visible=age<4;
    }
    // Read-only diagnostics allow checking motion without relying on a single screenshot.
    canvas.dataset.rotation=angle.toFixed(4);
    canvas.dataset.state=extinguishedAt===null?'lit':'extinguished';
    renderer.render(scene,camera);
  }
  function pointerMove(e) {pointer.set(e.clientX/innerWidth-.5,e.clientY/innerHeight-.5);}
  window.addEventListener('resize',resize);
  window.addEventListener('pointermove',pointerMove);
  resize();
  canvas.dataset.points=String(clouds.reduce((sum,p)=>sum+p.geometry.attributes.position.count,0));
  return {update,setBlowStrength,extinguish,dispose(){
    disposed=true;
    window.removeEventListener('resize',resize);
    window.removeEventListener('pointermove',pointerMove);
    clouds.forEach(p=>{p.geometry.dispose();p.material.dispose();});
    renderer.dispose();
  }};
}
