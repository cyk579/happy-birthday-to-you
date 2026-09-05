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
    } else if (uKind < 4.5) {
      p.y += sin(uTime*.22+phase)*.12;
      p.x += cos(uTime*.18+phase)*.1;
    } else {
      p.x += sin(p.y*5.0 + uTime*.14 + phase)*.007;
      p.y += cos(p.x*4.0 - uTime*.11 + phase)*.009;
      p.xy *= 1.0 + uAge*.46;
      p.xy += sign(p.xy)*uAge*.09;
      p.z += uAge*(.35+aSeed*.3);
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

function createInvitationCloud(mobile) {
  const cloud=new Cloud();
  const count=mobile?8200:14800;
  const curves=[
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(-1.2,-.85,0),new THREE.Vector3(-.8,1.5,0),
      new THREE.Vector3(-.1,.5,0),new THREE.Vector3(1.15,1.1,0)),
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(-1.2,-1.06,0),new THREE.Vector3(.4,-.64,0),
      new THREE.Vector3(1.1,-1.04,0),new THREE.Vector3(1.15,.7,0))
  ];
  // Sample narrow filaments and diffuse dust around two viewport-relative curves.
  // Their open middle stays clear for the invitation on portrait and landscape screens.
  for(let i=0;i<count;i++) {
    if(i<count*.965) {
      const strand=i%2,t=Math.random(),curve=curves[strand];
      const p=curve.getPoint(t),tangent=curve.getTangent(t);
      const diffuse=Math.random()<.24;
      const width=(diffuse?.12:.038)*(.6+.4*Math.sin(t*Math.PI));
      const offset=gaussian()*width+Math.sin(t*29+strand*3)*.016;
      p.x-=tangent.y*offset;
      p.y+=tangent.x*offset;
      const color=strand===0?(Math.random()<.16?roseLight:silverLight):
        (Math.random()<.22?silverLight:roseLight);
      const alpha=diffuse?.08+Math.random()*.12:.25+Math.random()*.4;
      cloud.add(p.x,p.y,gaussian()*.13,color,alpha*1.3,1.0+Math.random()*1.35);
    } else {
      const x=(Math.random()-.5)*2.25,y=(Math.random()-.5)*2.25;
      const center=Math.abs(x)<.48&&y>-.6&&y<.5;
      cloud.add(x,y,Math.random()*.6-.3,i%3? silverLight:roseLight,
        center?.035:.12+Math.random()*.19,1+Math.random()*1.8);
    }
  }
  return cloud.mesh(5);
}

export function createNebulaScene(canvas) {
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(32,1,.1,100);
  scene.add(camera);
  const orientation=new THREE.Group();
  scene.add(orientation);
  const root=new THREE.Group();
  root.position.y=-1.22;
  root.visible=false;
  orientation.add(root);
  const density=matchMedia('(max-width: 620px)').matches ? .56 : 1;
  const cake=new Cloud();
  addTier(cake,{radius:1.62,bottom:0,height:.87,color:rose,highlight:roseLight,phase:.6},density);
  addTier(cake,{radius:1.24,bottom:.89,height:.69,color:silver,highlight:silverLight,phase:1.7},density);
  const cakePoints=cake.mesh();
  root.add(cakePoints);

  const candle=new Cloud();
  for(let i=0;i<4200*density;i++) {
    const a=Math.random()*TAU,y=Math.random()*.43,r=.072+gaussian()*.012;
    candle.add(Math.cos(a)*r,1.60+y,Math.sin(a)*r,gold,.38,1.1+Math.random()*1.1);
  }
  const candlePoints=candle.mesh();
  root.add(candlePoints);

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
  const ambient=dust.mesh(4);
  ambient.visible=false;
  scene.add(ambient);

  const invitation=createInvitationCloud(density<1);
  invitation.position.z=-6;
  camera.add(invitation);
  const revealPoints=[cakePoints,candlePoints,flame,ambient];
  revealPoints.forEach(p=>{p.material.uniforms.uOpacity.value=0;});

  const clouds=[];
  scene.traverse(o=>{if(o.isPoints) clouds.push(o);});
  let time=0,angle=0,extinguishedAt=null,disposed=false,opened=false,reveal=0;
  let gestureControl=false,targetAngle=0,pitch=0,targetPitch=0,flipAngle=0,targetFlip=0;
  const xAxis=new THREE.Vector3(1,0,0),yAxis=new THREE.Vector3(0,1,0);
  const yawRotation=new THREE.Quaternion(),flipRotation=new THREE.Quaternion();
  const pointer=new THREE.Vector2();
  const smoothPointer=new THREE.Vector2();
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
    invitation.scale.set(6*tan*camera.aspect,6*tan,1);
    camera.updateProjectionMatrix();
    clouds.forEach(p=>{p.material.uniforms.uPixels.value=dpr*height/720;});
  }
  function open() {
    if(opened||disposed) return;
    opened=true;
    root.visible=true;
    ambient.visible=true;
    canvas.dataset.state='lit';
  }
  function setGestureControl(enabled) {
    if(disposed) return;
    const next=Boolean(enabled);
    if(next===gestureControl) return;
    gestureControl=next;
    targetAngle=angle;
    if(!next) {targetPitch=0;targetFlip=0;}
    canvas.dataset.gestureControl=String(next);
  }
  function rotateBy(yawDelta,pitchDelta) {
    if(disposed||!opened||!gestureControl||!Number.isFinite(yawDelta)||!Number.isFinite(pitchDelta)) return;
    targetAngle+=yawDelta;
    targetPitch=THREE.MathUtils.clamp(targetPitch+pitchDelta,-Math.PI*65/180,Math.PI*65/180);
  }
  function flip() {
    if(disposed||!opened||!gestureControl) return;
    targetFlip=targetFlip===0?Math.PI:0;
  }
  function resetView() {
    if(disposed) return;
    targetAngle=Math.round(angle/TAU)*TAU;
    targetPitch=0;
    targetFlip=0;
  }
  function setBlowStrength(strength) {flame.material.uniforms.uWind.value=THREE.MathUtils.clamp(strength,0,1);}
  function extinguish() {
    if(extinguishedAt!==null) return;
    extinguishedAt=time;
    // Smoke leaves the candle in world space, even when the cake is upside down.
    const smokeOrigin=smoke.getWorldPosition(new THREE.Vector3());
    scene.add(smoke);
    smoke.position.copy(smokeOrigin);
    smoke.quaternion.identity();
    smoke.visible=true;
    confetti.visible=true;
  }
  function update(dt) {
    if(disposed) return;
    time+=dt;
    if(opened&&!gestureControl) {
      const turn=dt*(reducedMotion ? .035 : .17);
      angle+=turn;
      targetAngle+=turn;
    }
    const damping=1-Math.exp(-dt*(reducedMotion?28:11));
    angle+=(targetAngle-angle)*damping;
    pitch+=(targetPitch-pitch)*damping;
    flipAngle+=(targetFlip-flipAngle)*(1-Math.exp(-dt*(reducedMotion?28:6.5)));
    // Keep the flip inside yaw so horizontal dragging keeps its direction upside down.
    // The pivot stays at world origin; the original root offset preserves the opening view.
    orientation.quaternion.setFromAxisAngle(xAxis,pitch)
      .multiply(yawRotation.setFromAxisAngle(yAxis,angle))
      .multiply(flipRotation.setFromAxisAngle(xAxis,flipAngle));
    smoothPointer.lerp(pointer,1-Math.exp(-dt*3));
    camera.position.set(reducedMotion?0:smoothPointer.x*.13,distance*.13,distance);
    camera.lookAt(0,0,0);
    clouds.forEach(p=>{p.material.uniforms.uTime.value=time;});
    if(invitation.visible) {
      invitation.material.uniforms.uTime.value=reducedMotion?0:time;
      invitation.position.x=reducedMotion?0:smoothPointer.x*.035;
      invitation.position.y=reducedMotion?0:-smoothPointer.y*.025;
    }
    if(opened) reveal=Math.min(1,reveal+dt/(reducedMotion?.2:2.3));
    const cakeOpacity=THREE.MathUtils.smoothstep(reveal,.12,.98);
    revealPoints.forEach(p=>{p.material.uniforms.uOpacity.value=cakeOpacity;});
    if(invitation.visible&&opened) {
      invitation.material.uniforms.uAge.value=reducedMotion?0:reveal*reveal;
      invitation.material.uniforms.uOpacity.value=1-THREE.MathUtils.smoothstep(reveal,.03,.84);
      if(reveal===1) invitation.visible=false;
    }
    if(extinguishedAt!==null) {
      const age=time-extinguishedAt;
      flame.material.uniforms.uOpacity.value=cakeOpacity*Math.max(0,1-age/.45);
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
    canvas.dataset.pitch=pitch.toFixed(4);
    canvas.dataset.flip=flipAngle.toFixed(4);
    canvas.dataset.gestureControl=String(gestureControl);
    canvas.dataset.state=!opened?'intro':extinguishedAt===null?'lit':'extinguished';
    canvas.dataset.reveal=reveal.toFixed(3);
    renderer.render(scene,camera);
  }
  function pointerMove(e) {pointer.set(e.clientX/innerWidth-.5,e.clientY/innerHeight-.5);}
  window.addEventListener('resize',resize);
  window.addEventListener('pointermove',pointerMove);
  resize();
  canvas.dataset.state='intro';
  canvas.dataset.pitch='0.0000';
  canvas.dataset.flip='0.0000';
  canvas.dataset.gestureControl='false';
  canvas.dataset.introPoints=String(invitation.geometry.attributes.position.count);
  canvas.dataset.points=String(clouds.reduce((sum,p)=>sum+p.geometry.attributes.position.count,0));
  return {open,update,setBlowStrength,extinguish,setGestureControl,rotateBy,flip,resetView,dispose(){
    disposed=true;
    window.removeEventListener('resize',resize);
    window.removeEventListener('pointermove',pointerMove);
    clouds.forEach(p=>{p.geometry.dispose();p.material.dispose();});
    renderer.dispose();
  }};
}
