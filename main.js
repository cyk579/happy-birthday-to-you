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

let started=false,extinguished=false,muted=false,micState='off',musicState='idle';
let held=false,charge=0,breathDuration=0,holdDuration=0,previous=performance.now();
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
  if(document.hidden) {release();audio.disableMic();}
  audio.setMuted(muted||document.hidden);
});
window.addEventListener('pagehide',()=>{audio.dispose();scene?.dispose();});
