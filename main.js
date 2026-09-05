import { createNebulaScene } from './nebula-scene.js';
import { BirthdayAudio } from './audio.js';
import { HandTracking } from './hand-tracking.js';
import { GestureControls } from './gesture-controls.js';

const app=document.querySelector('#app');
const canvas=document.querySelector('#scene');
const enter=document.querySelector('#enter');
const welcome=document.querySelector('#welcome');
const controls=document.querySelector('#scene-controls');
const soundToggle=document.querySelector('#sound-toggle');
const micToggle=document.querySelector('#mic-toggle');
const micStatus=document.querySelector('#mic-status');
const instruction=document.querySelector('#instruction');
const cameraToggle=document.querySelector('#camera-toggle');
const cameraClose=document.querySelector('#camera-close');
const gesturePanel=document.querySelector('#gesture-panel');
const gestureStatus=document.querySelector('#gesture-status');
const gestureProgress=document.querySelector('#gesture-progress');
const handOverlay=document.querySelector('#hand-overlay');
const handCursor=document.querySelector('#hand-cursor');
const handContext=handOverlay.getContext('2d');

let started=false,extinguished=false,muted=false,micState='off',musicState='idle',cameraState='off';
let held=false,charge=0,breathDuration=0,holdDuration=0,previous=performance.now();
let scene;
const gestures=new GestureControls({
  onRotate:(yaw,pitch)=>scene?.rotateBy(yaw,pitch),
  onFlip:()=>scene?.flip(),
  onReset:()=>scene?.resetView(),
});
const handTracking=new HandTracking({
  video:document.querySelector('#hand-video'),
  onState:({status,message})=>{
    cameraState=status;
    const active=status==='loading'||status==='ready';
    gesturePanel.hidden=status==='off';
    gesturePanel.dataset.state=status;
    app.dataset.cameraState=status;
    app.classList.toggle('has-camera',status!=='off');
    cameraToggle.classList.toggle('is-active',active);
    cameraToggle.setAttribute('aria-pressed',String(active));
    cameraToggle.setAttribute('aria-busy',String(status==='loading'));
    const label=active?'关闭摄像头手势':status==='error'?'重新开启摄像头手势':'开启摄像头手势';
    cameraToggle.setAttribute('aria-label',label);
    cameraToggle.title=label;
    gestureStatus.textContent=message;
    scene?.setGestureControl(active);
    if(!active) {
      gestures.reset();
      handCursor.hidden=true;
      handContext?.clearRect(0,0,handOverlay.width,handOverlay.height);
      gestureProgress.style.transform='scaleX(0)';
    }
  },
  onFrame:frame=>{
    const result=gestures.update(frame,frame.timestamp);
    const messages={searching:'把一只手放到镜头前',ready:'张开手掌，摆手转动蛋糕',
      waving:'正在跟随手掌转动',grabbing:'正在随手转动',flip:result.progress>=1?'已翻转，松开后可以再试':'保持 V 手势，准备翻转',
      reset:result.progress>=1?'已复位':'保持握拳，准备复位'};
    const message=messages[result.mode]||messages.ready;
    if(gestureStatus.textContent!==message) gestureStatus.textContent=message;
    gesturePanel.dataset.mode=result.mode;
    gestureProgress.style.transform=`scaleX(${result.progress||0})`;
    handCursor.hidden=!result.cursor;
    const rotating=result.mode==='grabbing'||result.mode==='waving';
    handCursor.classList.toggle('is-grabbing',rotating);
    if(result.cursor) handCursor.style.transform=`translate(${result.cursor.x*canvas.clientWidth}px,${result.cursor.y*canvas.clientHeight}px)`;
    drawHand(frame.landmarks,rotating);
  },
});
const handConnections=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
function drawHand(landmarks,grabbing) {
  if(!handContext) return;
  const width=handOverlay.width,height=handOverlay.height;
  handContext.clearRect(0,0,width,height);
  if(landmarks?.length!==21) return;
  handContext.strokeStyle=grabbing?'#f4d2a0':'#d4c2ae99';
  handContext.fillStyle=grabbing?'#f4d2a0':'#e6dccf';
  handContext.lineWidth=1.4;
  handContext.beginPath();
  for(const [a,b] of handConnections) {
    handContext.moveTo(landmarks[a].x*width,landmarks[a].y*height);
    handContext.lineTo(landmarks[b].x*width,landmarks[b].y*height);
  }
  handContext.stroke();
  for(const point of landmarks) {
    handContext.beginPath();
    handContext.arc(point.x*width,point.y*height,2.4,0,Math.PI*2);
    handContext.fill();
  }
}

const audio=new BirthdayAudio(({status,message})=>{
  micState=status;
  micStatus.textContent=message;
  micToggle.classList.toggle('is-active',status==='on'||status==='calibrating');
  micToggle.disabled=status==='requesting';
  const label=status==='on'||status==='calibrating'?'暂停麦克风':'开启麦克风';
  micToggle.setAttribute('aria-label',label);
  micToggle.setAttribute('aria-pressed',String(status==='on'||status==='calibrating'));
  micToggle.title=label;
  audio.setDucked(status==='requesting'||status==='on'||status==='calibrating');
  updateSoundControl();
},({status})=>{
  musicState=status;
  app.dataset.musicState=status;
  updateSoundControl();
});

function updateSoundControl() {
  const listening=micState==='requesting'||micState==='calibrating'||micState==='on';
  const label=musicState==='error'?'重新播放音乐':muted?'开启音乐':
    listening?'音乐已暂停，关闭麦克风后恢复':musicState==='loading'?'音乐正在准备，点击关闭':'关闭音乐';
  soundToggle.classList.toggle('is-active',musicState==='playing'&&!muted&&!listening);
  soundToggle.classList.toggle('is-muted',muted||listening);
  soundToggle.setAttribute('aria-pressed',String(!muted));
  soundToggle.setAttribute('aria-busy',String(musicState==='loading'));
  soundToggle.setAttribute('aria-label',label);
  soundToggle.title=label;
}
app.dataset.musicState=musicState;
updateSoundControl();

try {scene=createNebulaScene(canvas);} catch(error) {
  enter.disabled=true;
  enter.querySelector('span').textContent='当前浏览器无法开启 3D 场景';
  console.error(error);
}

enter.addEventListener('click',()=>{
  if(!scene||started) return;
  started=true;
  welcome.inert=true;
  controls.inert=false;
  app.classList.add('is-open');
  scene.open();
  audio.start();
  instruction.textContent='许一个愿望';
});

micToggle.addEventListener('click',()=>{
  if(!started||extinguished) return;
  if(micState==='on'||micState==='calibrating') audio.disableMic();
  else audio.enableMic();
});

cameraToggle.addEventListener('click',()=>{
  if(!started) return;
  if(cameraState==='loading'||cameraState==='ready') handTracking.stop();
  else handTracking.start();
});
cameraClose.addEventListener('click',()=>handTracking.stop());
document.querySelector('#gesture-flip').addEventListener('click',()=>{if(started)scene.flip();});
document.querySelector('#gesture-reset').addEventListener('click',()=>{if(started)scene.resetView();});

soundToggle.addEventListener('click',()=>{
  if(!started) return;
  muted=musicState==='error'?false:!muted;
  audio.setMuted(muted);
  updateSoundControl();
});

function finish() {
  if(extinguished) return;
  extinguished=true;
  held=false;
  scene.extinguish();
  audio.disableMic();
  instruction.textContent='愿望已经出发';
  micStatus.textContent='愿此刻的光，一直在';
  micToggle.disabled=true;
}

canvas.addEventListener('pointerdown',e=>{
  if(!started||extinguished||!e.isPrimary) return;
  held=true;
  canvas.setPointerCapture(e.pointerId);
});
function release() {held=false;}
canvas.addEventListener('pointerup',release);
canvas.addEventListener('pointercancel',release);
canvas.addEventListener('lostpointercapture',release);
window.addEventListener('blur',release);
window.addEventListener('keydown',e=>{
  if(e.target?.closest?.('button, a, input, textarea, select, [contenteditable]')) return;
  if(e.code==='Space'&&started&&!extinguished){e.preventDefault();held=true;}
});
window.addEventListener('keyup',e=>{if(e.code==='Space')release();});

function frame(now) {
  const dt=Math.min(.05,Math.max(0,(now-previous)/1000));
  previous=now;
  if(scene&&!document.hidden) {
    if(started&&!extinguished) {
      const input=audio.sample(dt);
      const strength=held?1:input.strength;
      scene.setBlowStrength(strength);
      if(held) {
        holdDuration+=dt;
        charge=0;
        breathDuration=0;
        if(holdDuration>=.95) finish();
      } else {
        holdDuration=0;
        // Half a second of current breath excludes a clap and its smoothed tail.
        const breathing=input.ready&&input.breathing;
        breathDuration=breathing?breathDuration+dt:0;
        charge=breathing?charge+dt*strength*3:Math.max(0,charge-dt*1.2);
        if(breathDuration>=.5&&charge>=.5) finish();
      }
    }
    scene.update(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange',()=>{
  if(document.hidden) {release();audio.disableMic();handTracking.stop();}
  audio.setMuted(muted||document.hidden);
});
window.addEventListener('pagehide',event=>{
  release();
  handTracking.stop();
  // BFCache keeps this page alive: release device access but keep it usable on Back.
  if(event.persisted) {audio.disableMic();audio.setMuted(true);}
  else {handTracking.dispose();audio.dispose();scene?.dispose();}
});
window.addEventListener('pageshow',event=>{
  if(event.persisted) audio.setMuted(muted||document.hidden);
});
