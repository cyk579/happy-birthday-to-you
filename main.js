import { createNebulaScene } from './nebula-scene.js';
import { BirthdayAudio } from './audio.js';

const app=document.querySelector('#app');
const canvas=document.querySelector('#scene');
const enter=document.querySelector('#enter');
const welcome=document.querySelector('#welcome');
const controls=document.querySelector('#scene-controls');
const soundToggle=document.querySelector('#sound-toggle');
const micToggle=document.querySelector('#mic-toggle');
const micStatus=document.querySelector('#mic-status');
const instruction=document.querySelector('#instruction');

let started=false,extinguished=false,muted=false,micState='off';
let held=false,charge=0,previous=performance.now();
let scene;
const audio=new BirthdayAudio(({status,message})=>{
  micState=status;
  micStatus.textContent=message;
  micToggle.classList.toggle('is-active',status==='on'||status==='calibrating');
  micToggle.disabled=status==='requesting';
  const label=status==='on'||status==='calibrating'?'暂停麦克风':'开启麦克风';
  micToggle.setAttribute('aria-label',label);
  micToggle.setAttribute('aria-pressed',String(status==='on'||status==='calibrating'));
  micToggle.title=label;
  audio.setDucked(status==='on'||status==='calibrating');
});

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

soundToggle.addEventListener('click',()=>{
  if(!started) return;
  muted=!muted;
  audio.setMuted(muted);
  soundToggle.classList.toggle('is-active',!muted);
  soundToggle.classList.toggle('is-muted',muted);
  soundToggle.setAttribute('aria-pressed',String(!muted));
  soundToggle.setAttribute('aria-label',muted?'开启声音':'关闭声音');
  soundToggle.title=muted?'开启声音':'关闭声音';
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
      // Sustained breath integrates over time; a single clap cannot extinguish the candle.
      charge=strength>.18?charge+dt*(held?1:strength*2.2):Math.max(0,charge-dt*.8);
      if(charge>=(held?.95:.68)) finish();
    }
    scene.update(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange',()=>{
  if(document.hidden) {release();audio.disableMic();}
  audio.setMuted(muted||document.hidden);
});
window.addEventListener('pagehide',()=>{audio.dispose();scene?.dispose();});
