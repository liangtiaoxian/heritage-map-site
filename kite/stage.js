import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createKiteModel} from './model.js';
const canvas=document.querySelector('#stage'),q=new URLSearchParams(location.search),review=q.has('review');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:review});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=review?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
const scene=new THREE.Scene();scene.background=new THREE.Color(review?'#ffffff':'#eee9db');
const camera=new THREE.OrthographicCamera(-2.658,2.658,2.25,-1.737,.01,100);camera.position.set(0,0,9);camera.lookAt(0,0,0);
const fill=new THREE.HemisphereLight(0xeef8f4,0xbca77d,2.2);scene.add(fill);const key=new THREE.DirectionalLight(0xfff0da,2.1);key.position.set(-3,5,7);scene.add(key);const rim=new THREE.DirectionalLight(0xe2efff,.5);rim.position.set(3,1,-4);scene.add(rim);
if(!review){const c=document.createElement('canvas');c.width=32;c.height=512;const g=c.getContext('2d'),gradient=g.createLinearGradient(0,0,0,512);gradient.addColorStop(0,'#dbe7e2');gradient.addColorStop(.68,'#f0eddd');gradient.addColorStop(1,'#ddd8bc');g.fillStyle=gradient;g.fillRect(0,0,32,512);scene.background=new THREE.CanvasTexture(c);scene.background.colorSpace=THREE.SRGBColorSpace;}
const model=await createKiteModel(await fetch('./design.json').then(r=>r.json()));scene.add(model.root);
document.querySelector('#loading').remove();if(review)document.body.classList.add('review');
model.root.rotation.y=THREE.MathUtils.degToRad(Number(q.get('orbit')||0));
const controls=new OrbitControls(camera,canvas);controls.target.set(0,0,0);controls.enableDamping=true;controls.enablePan=false;
let clock=0,playing=true,stage=0,manual=false,exploded=false,view='front',last=performance.now(),wind=.45;
const title=['以竹成骨','以纸成翼','以色传意','乘风而起'],copy=['竹脊定形，横竹撑翼。沿着绑扎点，看竹条怎样连成左右对称的骨架。','纸面依次覆上翼骨。轻薄的纸与竹骨相合，形成迎风的翼面。','彩绘从纸面上逐渐显现。羽片、人物与鹤鸟共同组成这一件风筝的图案。','提线牵住风筝，迎风缓缓升起。调节风的力度，观察翼面轻颤与整架摇摆。'];
const letters=['扎','糊','绘','放'];let lastStage=-1;
const tetherMaterial=new THREE.LineBasicMaterial({color:0x957a50,transparent:true,opacity:.65}),tetherGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),tether=new THREE.Line(tetherGeometry,tetherMaterial);scene.add(tether);
function resize(){renderer.setSize(innerWidth,innerHeight);if(!review){const h=innerWidth<760?6.4:4.5;camera.left=-h*innerWidth/innerHeight/2;camera.right=-camera.left;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();}}
addEventListener('resize',resize);resize();window.kite={model,scene,renderer,camera,key,fill,ready:true};
function syncStage(){if(stage===lastStage)return;lastStage=stage;document.querySelector('#step-no').textContent=`0${stage+1} / ${letters[stage]}`;document.querySelector('#step-title').textContent=title[stage];document.querySelector('#step-copy').textContent=copy[stage];document.querySelectorAll('[data-step]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.step)===stage)));}
function setStage(value){stage=value;manual=true;clock=value*7;playing=true;lastStage=-1;syncPlay();syncStage();}
function syncPlay(){const b=document.querySelector('#play');b.textContent=playing?'暂停 ‖':'继续 ▷';b.setAttribute('aria-label',playing?'暂停制作动画':'继续制作动画');}
for(const b of document.querySelectorAll('[data-step]'))b.onclick=()=>setStage(Number(b.dataset.step));
document.querySelector('#play').onclick=()=>{playing=!playing;syncPlay();};document.querySelector('#restart').onclick=()=>{clock=0;stage=0;manual=false;playing=true;exploded=false;model.explode(0);document.querySelector('#explode').setAttribute('aria-pressed','false');syncPlay();};
document.querySelector('#front').onclick=()=>{view='front';controls.reset();};document.querySelector('#back').onclick=()=>{view='back';controls.reset();};document.querySelector('#explode').onclick=()=>{exploded=!exploded;model.explode(exploded?1:0);document.querySelector('#explode').setAttribute('aria-pressed',String(exploded));if(stage<2)setStage(2);};
document.querySelector('#wind').oninput=e=>{wind=Number(e.target.value);document.querySelector('#wind-value').textContent=wind<.3?'轻风':wind<.7?'微风':'劲风';};
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let pointerDown=null;
canvas.addEventListener('pointerdown',e=>pointerDown=[e.clientX,e.clientY]);canvas.addEventListener('pointerup',e=>{if(!pointerDown||Math.hypot(e.clientX-pointerDown[0],e.clientY-pointerDown[1])>7)return;const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(model.root,true)[0];if(hit){let part=hit.object;while(part&&!part.userData.partId)part=part.parent;const name=part?.name||'彩绘纸面';document.querySelector('#part-note').textContent=name+' · '+(name.includes('竹')?'竹条相交处以线绑扎，支撑纸面。':name.includes('提线')?'提线汇到牵引点，将翼面与手中的线相连。':'薄纸承载彩绘，背面由竹骨承托。');}});
const worldJunction=new THREE.Vector3(),lineArray=tetherGeometry.attributes.position;
function frame(now){const dt=Math.min(.05,(now-last)/1000||0);last=now;if(!review){if(playing&&!document.hidden)clock+=dt;const autoStage=Math.min(3,Math.floor(clock/7));if(!manual)stage=autoStage;const progress=stage===3?1:Math.min(1,(clock-stage*7)/6);syncStage();model.update(clock,stage,progress);const mobile=innerWidth<760,baseScale=mobile?Math.min(.56,innerWidth/700):Math.min(.94,innerWidth/1400),flight=stage===3;model.root.scale.setScalar(baseScale);model.root.position.set(mobile?0:-.9,mobile?1.05:.22,0);if(flight){model.root.position.x+=Math.sin(clock*.45)*.18*wind;model.root.position.y+=.16+Math.sin(clock*.7)*.12*wind;model.root.rotation.z=Math.sin(clock*.8)*.055*(.3+wind);model.root.rotation.x=Math.sin(clock*.65)*.035;}
else {model.root.rotation.z=0;model.root.rotation.x=0;}const targetYaw=view==='back'?Math.PI:stage===0?-.23:0;model.root.rotation.y+=(targetYaw-model.root.rotation.y)*Math.min(1,dt*3);document.querySelector('#progress').style.width=(stage===3?100:progress*100)+'%';tether.visible=flight&&!exploded;model.root.updateMatrixWorld(true);model.sockets.get('tether').getWorldPosition(worldJunction);lineArray.setXYZ(0,worldJunction.x,worldJunction.y,worldJunction.z);lineArray.setXYZ(1,mobile?-.4:-1.4,-3,2);lineArray.needsUpdate=true;tetherGeometry.computeBoundingSphere();}
controls.update();renderer.render(scene,camera);requestAnimationFrame(frame)}requestAnimationFrame(frame);
if(matchMedia('(prefers-reduced-motion: reduce)').matches){setStage(2);clock=20;playing=false;syncPlay();}
window.kite.getState=()=>({stage,clock,playing,exploded,parts:model.parts.size});
addEventListener('keydown',e=>{if(e.key==='Escape'&&parent!==window)parent.postMessage({type:'heritage-close',experience:'kite'},location.origin);});

