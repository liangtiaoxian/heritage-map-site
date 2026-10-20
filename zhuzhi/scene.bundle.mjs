/* ============================================================================
 * 场景导览（可复用）—— 热点 + 跟随卡片 + 介绍面板
 * ----------------------------------------------------------------------------
 * 与具体场景无关：任何 three.js 场景传进 canvas / camera / 热点表就能用。
 * 自带 DOM 与样式（样式在 tour.css），不需要宿主写任何标签。
 *
 *   const tour = createSceneTour(THREE, {
 *     canvas, camera,
 *     ui:   { kicker, title, lead, legend:[{color,label,note}], tip, keys:[...] },
 *     spots:[{ id, name, en, marker:[x,y,z], view:{az,pol,dist,tx,ty,tz}, text }],
 *     onFlyTo(view) { ... },     // 宿主把镜头目标设过去（做插值）
 *     onReset()     { ... },     // 宿主把镜头复位
 *   });
 *   tour.open('id') / tour.close() / tour.update() 由内部 rAF 自己驱动，无需宿主调用
 * ==========================================================================*/

function createSceneTour(THREE, opts) {
  const {
    canvas, camera,
    ui = {},
    spots = [],
    onFlyTo = () => {},
    onReset = () => {},
    ringScale = 1.15,
    gap = 30,
    narrowWidth = 780,
    hover = true,
    tapSlop = 6,
    /* 可选：返回 false 时热点先不显示。
       微缩场景的零件是入场时在顶点着色器里「长」出来的，热点是直接 add 上去的、
       不受那套变形影响，所以模型还没成形时金环会浮在半空——用它挡一下。 */
    ready = null,
  } = opts;
  if (!canvas || !camera || !spots.length) {
    return { open() {}, close() {}, spots: () => [], screenOf: () => null };
  }

  const QS = new URLSearchParams(location.search);

  /* ---------- 1. 页面结构（自动注入） ---------- */
  const root = document.createElement('div');
  root.id = 'tour';
  root.innerHTML = `
    <div class="tour-masthead">
      <b class="tour-masthead-index"></b>
      <h1></h1>
    </div>
    <section class="tour-side">
      <div class="tour-intro" id="tour-intro">
        <span class="tour-kicker"></span>
        <h1></h1>
        <p class="tour-lead"></p>
        <ul class="tour-legend"></ul>
        <p class="tour-tip"></p>
      </div>
      <article class="tour-card" id="tour-card" hidden>
        <button class="tour-close" type="button" aria-label="关闭">×</button>
        <span class="tour-card-kicker"></span>
        <h2></h2>
        <p></p>
        <span class="tour-back">点空白处或 × 返回总览</span>
      </article>
    </section>
    <footer class="tour-keys"></footer>`;
  document.body.appendChild(root);

  const introEl = root.querySelector('#tour-intro');
  const cardEl = root.querySelector('#tour-card');

  /* 左上角标题：墨色斜切底 + 楷体大字（不传 ui.masthead 就不出现） */
  const mastheadEl = root.querySelector('.tour-masthead');
  if (ui.masthead) {
    root.querySelector('.tour-masthead-index').textContent = ui.mastheadIndex || '';
    root.querySelector('.tour-masthead h1').textContent = ui.masthead;
    if (!ui.mastheadIndex) root.querySelector('.tour-masthead-index').remove();
  } else {
    mastheadEl.remove();
  }

  root.querySelector('.tour-kicker').textContent = ui.kicker || '';
  root.querySelector('.tour-intro h1').textContent = ui.title || '';
  root.querySelector('.tour-lead').textContent = ui.lead || '';
  const tipEl = root.querySelector('.tour-tip');
  if (ui.tip) tipEl.textContent = ui.tip; else tipEl.remove();
  const legendEl = root.querySelector('.tour-legend');
  for (const item of (ui.legend || [])) {
    const li = document.createElement('li');
    li.innerHTML = `<i></i><b></b><span></span>`;
    li.querySelector('i').style.background = item.color;
    li.querySelector('b').textContent = item.label;
    li.querySelector('span').textContent = item.note || '';
    legendEl.appendChild(li);
  }
  if (!(ui.legend || []).length) legendEl.remove();
  const keysEl = root.querySelector('.tour-keys');
  for (const k of (ui.keys || [])) {
    const span = document.createElement('span');
    for (const part of k) {
      if (typeof part === 'string') { span.appendChild(document.createTextNode(part)); continue; }
      const kbd = document.createElement('kbd');
      kbd.textContent = part.kbd;
      span.appendChild(kbd);
    }
    keysEl.appendChild(span);
  }

  if (QS.has('nohud')) root.style.display = 'none';

  /* ---------- 2. 热点标记：金环 sprite + 不可见命中球 ---------- */
  function ringTexture(size = 128) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const c = size / 2;
    g.strokeStyle = 'rgba(255,236,190,1)';
    g.lineWidth = 7;
    g.beginPath(); g.arc(c, c, c - 16, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(90,66,30,0.95)';
    g.lineWidth = 3.4;
    g.beginPath(); g.arc(c, c, c - 16, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,232,176,1)';
    g.beginPath(); g.arc(c, c, 7, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const tex = ringTexture(128);
  const hits = [];
  /* 热点要加进宿主的场景：给 opts.scene（Object3D）或 opts.addTo（函数）即可 */
  const addTo = opts.addTo || (opts.scene ? (o) => opts.scene.add(o) : null);
  if (!addTo) console.warn('[tour] 缺少 opts.scene / opts.addTo，热点不会出现在场景里');
  spots.forEach((s, i) => {
    const grp = new THREE.Group();
    grp.position.set(s.marker[0], s.marker[1], s.marker[2]);
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false,
    }));
    ring.scale.set(ringScale, ringScale, 1);
    ring.renderOrder = 6;
    grp.add(ring);
    const hitBall = new THREE.Mesh(
      new THREE.SphereGeometry(s.hitR || 0.52, 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitBall.userData.spot = s;
    grp.add(hitBall);
    if (addTo) addTo(grp);
    s.group = grp; s.ring = ring; s.hit = hitBall;
    s.phase = i * 1.7;
    hits.push(hitBall);
  });

  /* ---------- 3. 状态 ---------- */
  let active = null;
  let hovered = null;
  let side = '';
  const size = { w: 300, h: 200 };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0, moved = 0, downId = null;

  function measure() {
    if (cardEl.hidden) return;
    size.w = cardEl.offsetWidth || 300;
    size.h = cardEl.offsetHeight || 200;
  }

  function screenOfWorld(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
    const r = canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }

  function spotAt(clientX, clientY) {
    if (ready && !ready()) return null;
    const r = canvas.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const found = ray.intersectObjects(hits, false);
    return found.length ? found[0].object.userData.spot : null;
  }

  function positionCard() {
    if (cardEl.hidden || !active) return;
    if (window.innerWidth < narrowWidth) { cardEl.style.transform = ''; return; }
    const [sx, sy] = screenOfWorld(active.marker);
    const vw = window.innerWidth, vh = window.innerHeight;
    const pad = 14;
    let x = sx + gap;
    let want = 'right-of-dot';
    if (x + size.w + pad > vw) { x = sx - gap - size.w; want = 'left-of-dot'; }
    x = Math.max(pad, Math.min(x, vw - size.w - pad));
    let y = Math.max(pad, Math.min(sy - 26, vh - size.h - pad));
    cardEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (want !== side) {
      cardEl.classList.toggle('right-of-dot', want === 'right-of-dot');
      cardEl.classList.toggle('left-of-dot', want === 'left-of-dot');
      side = want;
    }
  }

  function showCard(s) {
    active = s;
    cardEl.querySelector('.tour-card-kicker').textContent = s.en || '';
    cardEl.querySelector('h2').textContent = s.name || '';
    cardEl.querySelector('p').textContent = s.text || '';
    cardEl.hidden = false;
    introEl.hidden = true;
    measure();
    positionCard();
  }
  function showIntro() {
    active = null;
    cardEl.hidden = true;
    introEl.hidden = false;
  }
  function open(id) {
    const s = typeof id === 'string' ? spots.find((x) => x.id === id) : id;
    if (!s) return false;
    onFlyTo(s.view || {}, s);
    showCard(s);
    return true;
  }
  function close() {
    showIntro();
    onReset();
  }
  cardEl.querySelector('.tour-close').addEventListener('click', close);

  /* ---------- 4. 指针：悬停高亮 + 轻点命中（不干扰宿主拖动） ---------- */
  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; moved = 0; downId = e.pointerId;
  });
  window.addEventListener('pointermove', (e) => {
    if (downId !== null && e.pointerId === downId) {
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
      return;
    }
    if (!hover) return;
    const s = spotAt(e.clientX, e.clientY);
    hovered = s;
    canvas.classList.toggle('tour-hover', !!s);
  });
  const finish = (e) => {
    const isTap = downId === e.pointerId && moved < tapSlop && e.button !== 2;
    downId = null;
    if (!isTap) return;
    const s = spotAt(e.clientX, e.clientY);
    if (s) open(s);
    else if (active) close();
  };
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', () => { downId = null; });
  window.addEventListener('resize', () => { measure(); positionCard(); });

  /* ---------- 5. 自己的 rAF：金环呼吸 + 卡片跟住光点 ---------- */
  function loop() {
    const t = performance.now() / 1000;
    const shown = ready ? ready() : true;
    for (const s of spots) {
      s.group.visible = shown;
      if (!shown) continue;
      const pulse = 1 + Math.sin(t * 2.6 + s.phase) * 0.1;
      const big = (s === hovered || s === active) ? 1.5 : 1;
      const sc = ringScale * pulse * big;
      s.ring.scale.set(sc, sc, 1);
      s.ring.material.opacity = (s === active || s === hovered)
        ? 1 : 0.78 + 0.14 * Math.sin(t * 2.6 + s.phase);
    }
    positionCard();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------- 6. ?spot=id 直接打开 ---------- */
  const initial = QS.get('spot');
  if (initial) setTimeout(() => open(initial), 0);

  /* ---------- 7. 调试接口 ---------- */
  const api = {
    spots: () => spots.map((s) => ({ id: s.id, name: s.name })),
    open,
    close,
    active: () => (active ? active.id : null),
    cardOpen: () => !cardEl.hidden,
    screenOf: (id) => {
      const s = spots.find((x) => x.id === id || x === id);
      return s ? screenOfWorld(s.marker) : null;
    },
    reposition: () => { measure(); positionCard(); },
  };
  if (QS.has('debug')) {
    setTimeout(() => {
      const r = cardEl.getBoundingClientRect();
      const p = cardEl.querySelector('p');
      const pr = p.getBoundingClientRect();
      const cs = getComputedStyle(cardEl);
      document.title = JSON.stringify({
        vw: window.innerWidth,
        card: [Math.round(r.left), Math.round(r.right), Math.round(r.width)],
        para: [Math.round(pr.left), Math.round(pr.right), Math.round(pr.width)],
        cssWidth: cs.width, active: active ? active.id : null,
      });
    }, 3000);
  }
  return api;
}

/* 竹纸制作技艺（Ⅷ-71）· 竹山纸坊 —— 三渲二微缩模型
 * 富春江南岸山区的一座纸坊：北层竹山（原料来处）→ 中层坡上台地（工序线）
 * → 南层山溪（水碓动力）。晾纸墙朝南晒纸，是全场最高的人工物。
 * 全部程序化建模，没有外部模型与贴图，文字用 canvas 现画。
 * 由 build.mjs 拼接成一个模块：
 *   00 引导 / 10 工具（与民俗老街、坎儿井、水乡社戏共用）/ 15 地形 / 20 溪与水路
 *   / 30 水碓 / 40 纸坊 / 50 动效与交互
 */

const QS = new URLSearchParams(location.search);
const SKIP_INTRO = QS.has('skip');
const SHOT = QS.has('shot');

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0xe7ecdf, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
/* 山里的空气：淡青绿，远处淡淡退掉 */
scene.fog = new THREE.FogExp2(0xdfe8de, 0.0058);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 400);

const U = {
  time: { value: 0 },
  assemble: { value: 0 },
  outline: { value: 0.024 },
  dpr: { value: Math.min(window.devicePixelRatio || 1, 2) },
};

/* ---------- 尺寸口径：底座 40 × 24 米，三层从北到南逐级降低 ----------
 *   z = -12 ── 底座北缘（竹山起坡）
 *   z ≈ -5  ── 山脚收住，往南是坡上台地
 *   z ≈ +1.4 ── 溪北岸
 *   z ≈ +7  ── 溪南岸（底座南缘）
 * 山高上限 = 底座短边 24 ÷ 3 = 8 米，卡死在 ZA.hillH。
 */
const ZA = {
  halfX: 20, halfZ: 12,
  baseBottom: -0.8,
  deckY: 0.0,

  /* 北层 · 竹山 */
  ridgeZ: -12.0,      // 山脊所在（底座北缘）
  hillToe: -5.0,      // 山脚收住的位置，往南就是台地
  ridgeX: -2.0,       // 山脊沿 X 略偏西，让东南角敞亮
  hillH: 7.6,         // 最高处（≤ 8 米的硬上限）
  hillBands: 11,      // 横向条带数：台阶状剪影，可并进静态合批

  /* 中层 · 坡上台地 */
  terraceZ0: -5.0,    // 台地北缘（接山脚）
  terraceZ1: 4.2,     // 台地南缘 —— 一直铺到接近底座南缘，别留裸板
  terraceY: 0.34,     // 台地比溪岸略高一点，靠挡土石坎收边

  /* 南层 · 山溪：贴底座南缘，只占最南一条 */
  bankZ: 4.2,         // 溪北岸
  farBankZ: 11.2,     // 溪南岸（底座南缘在 z = +12）
  waterY: -0.30,

  /* 工序线：由西向东排开，x 为各自中心 */
  poolX: -15.2,       // 沤料／发酵池
  stoveX: -10.4,      // 蒸煮灶房
  millX: -5.4,        // 水碓房（引渠卧轮）
  vatX: -0.2,         // 抄纸间（全场主戏）
  wallX: 6.2,         // 晾纸墙（朝南，最高人工物）
  barnX: 13.4,        // 纸仓
  shrineX: 16.6,      // 蔡伦神龛
  shrineZ: -2.6,

  laneZ: -2.4,        // 台地上的主通道（东西向）
  roadZ: -6.2,        // 山上下来的土路在山脚的位置
};

/* 竹山高程：所有山上物件都用它取落点高度，避免浮空或穿模 */
function hillY(x, z) {
  if (z >= ZA.hillToe) return 0;
  const t = (ZA.hillToe - z) / (ZA.hillToe - ZA.ridgeZ);          // 0→1 往北推
  const dx = Math.abs(x - ZA.ridgeX) / ZA.halfX;
  const spine = 1 - Math.pow(Math.min(dx, 1), 1.7);               // 沿 X 的脊线
  const rise = Math.pow(Math.min(Math.max(t, 0), 1), 1.35);
  return ZA.hillH * rise * Math.max(spine, 0.16);
}
/* 台地地面高度：山脚以南是平的台地，溪岸再落一点 */
function groundY(x, z) {
  if (z < ZA.hillToe) return hillY(x, z);
  if (z <= ZA.terraceZ1) return ZA.terraceY;
  return ZA.waterY + 0.14;
}

/* 竖屏时把相机拉远，保证 40 米长的底座不被裁掉
 * （底座进深从 22 加到 24，这里的 16/44 两个常数随之调整） */
let fitK = 1;
function resizeNow() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  fitK = camera.aspect >= 1 ? 1 : THREE.MathUtils.clamp(17 / Math.sin(hHalf) / 46, 1, 3.6);
  if (scene.fog) scene.fog.density = 0.0058 / Math.max(1, fitK);
}
window.addEventListener('resize', resizeNow);
resizeNow();

const timeState = { elapsed: 0, delta: 0 };
let lastFrameTime = performance.now();
function tickTime() {
  const t = performance.now();
  timeState.delta = Math.min((t - lastFrameTime) / 1000, 0.05);
  timeState.elapsed += timeState.delta;
  lastFrameTime = t;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261019);
const rnd = (a = 0, b = 1) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
/* ---------- 10 · 配色、材质、招牌图集、合批工具 ---------- */

const PAL = {
  base: 0x453528, baseTop: 0x2a211a, baseEdge: 0x564433, brass: 0xc4a05a,
  road: 0x9ba0a2, roadDark: 0x84898c, roadJoint: 0x6f7578, curb: 0xb5b1a4,
  walk: 0xa9a59a, walkAlt: 0xb4afa2, walkDark: 0x8d897d, gutter: 0x6d7274,
  soil: 0x8c806c, moss: 0x6f8256,
  woodDark: 0x4a3227, wood: 0x7a5236, woodLight: 0xa87a4e, woodPale: 0xc59a68,
  plaster: 0xf0e8d6, plasterDeep: 0xd9cdb6, wallOchre: 0xd9c39a, brick: 0x9c6a54,
  tile: 0x596372, tileHi: 0x6d788a, tileEdge: 0x7e8a9c, ridge: 0x48505f,
  paper: 0xf4e8cf, paperWarm: 0xffe0a8, red: 0xc23a2c, redDeep: 0x97291f,
  ochre: 0xd9a24a, jade: 0x5b8a72, indigo: 0x3f5f80, cream: 0xf3e6c8,
  leaf: 0x4f7a45, leafHi: 0x6f9d55, trunk: 0x5a4331,
  lantern: 0xd8432e, metal: 0x6a7078, metalDark: 0x3e434a,
  bamboo: 0xc7a46c, bambooDark: 0x9c7f4e, cloth: 0x6f8fa8, clothRed: 0xa8352c,
  chili: 0xc0392b, corn: 0xd9a94a, ceramic: 0xe2dccd, ink: 0x2c2a26,
};

/* 四阶灰度渐变：三渲二的分界（白天整体提亮） */
function gradientTexture() {
  const steps = new Uint8Array([150, 202, 236, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* 组装动画：所有零件绕自己的「落点」从地面长出来并上浮 */
const ASSEMBLE_GLSL = `
vec3 assemblePiece(vec3 p, vec3 ground, float d, float prog) {
  float t = clamp((prog - d * 2.2) / 0.34, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - t, 3.0);
  vec3 q = ground + (p - ground) * mix(0.72, 1.0, e);
  q.y += (e - 1.0) * 0.85;
  return q;
}`;

function withAssemble(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAssemble = U.assemble;
    shader.vertexShader =
      'attribute vec3 aPivot;\nattribute float aDelay;\nuniform float uAssemble;\n' +
      ASSEMBLE_GLSL + '\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed = assemblePiece(transformed, vec3(aPivot.x, 0.0, aPivot.z), aDelay, uAssemble);`
    );
  };
  return mat;
}

const toonMat = withAssemble(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientTexture() }));
const glowMat = withAssemble(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
const glassMat = withAssemble(new THREE.MeshBasicMaterial({
  color: 0xdbeefc, transparent: true, opacity: 0.1, depthWrite: false,
  side: THREE.DoubleSide, fog: true,
}));
const signMat = withAssemble(new THREE.MeshBasicMaterial({
  map: null, vertexColors: true, toneMapped: false, fog: true,
}));
const sheenMat = withAssemble(new THREE.MeshBasicMaterial({
  map: null, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide, fog: true,
}));

/* 描边：反向外壳，在视空间按法线外扩 */
const outlineMat = new THREE.ShaderMaterial({
  uniforms: { uAssemble: U.assemble, uWidth: U.outline, uColor: { value: new THREE.Color(0x33302a) } },
  vertexShader: `
    attribute vec3 aPivot;
    attribute float aDelay;
    uniform float uAssemble;
    uniform float uWidth;
    ${ASSEMBLE_GLSL}
    void main() {
      vec3 p = assemblePiece(position, vec3(aPivot.x, 0.0, aPivot.z), aDelay, uAssemble);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      mv.xyz += n * uWidth;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  side: THREE.BackSide,
});

/* 阴影用的深度材质：必须和主材质有同一套组装变形，否则投影会「提前组装好」 */
const depthMat = withAssemble(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));

/* ---------- 招牌图集：一块 canvas 画完所有文字，一次绘制 ---------- */
const ATLAS = (() => {
  const W = 1024, H = 3072;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);

  let cursorX = 0, cursorY = 0, rowH = 0;
  const rects = {};
  function alloc(name, w, h) {
    if (cursorX + w > W) { cursorX = 0; cursorY += rowH; rowH = 0; }
    const r = [cursorX, cursorY, w, h];
    cursorX += w + 4;
    rowH = Math.max(rowH, h);
    if (r[1] + h > H) console.warn('[10-kit] 招牌图块超出画布，会渲染成黑块：' + name + ' y=' + r[1] + ' h=' + h);
    rects[name] = [r[0] / W, 1 - (r[1] + h) / H, (r[0] + w) / W, 1 - r[1] / H];
    return r;
  }
  function panel(name, w, h, bg, draw) {
    const [x, y] = alloc(name, w, h);
    g.save();
    g.translate(x, y);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    draw(g, w, h);
    g.restore();
  }
  const KAI = '"STKaiti","KaiTi","Kaiti SC","SimSun","Microsoft YaHei",serif';
  const HEI = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';
  function han(ctx, text, x, y, size, color, font = KAI, spacing = 0) {
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = [...text];
    const total = chars.length * (size + spacing);
    chars.forEach((ch, i) => ctx.fillText(ch, x - total / 2 + (size + spacing) * (i + 0.5), y));
  }
  function vhan(ctx, text, x, y, size, color, gap = 6) {
    ctx.font = `${size}px ${KAI}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [...text].forEach((ch, i) => ctx.fillText(ch, x, y + i * (size + gap)));
  }

  /* 布幌：竖向字，布底红边 */
  function banner(name, text, sub) {
    panel(name, 110, 260, '#f2e4c6', (c, w, h) => {
      c.fillStyle = '#c23a2c';
      c.fillRect(0, 0, w, 16);
      c.fillRect(0, h - 26, w, 26);
      c.strokeStyle = '#b8332a'; c.lineWidth = 3;
      c.strokeRect(7, 22, w - 14, h - 54);
      vhan(c, text, w / 2, 62, 46, '#a52c22', 10);
      if (sub) {
        c.font = `13px ${HEI}`; c.fillStyle = '#8a5a3c'; c.textAlign = 'center';
        c.fillText(sub, w / 2, h - 40);
      }
      c.fillStyle = '#7a2a20';
      c.fillRect(w / 2 - 12, 0, 24, 8);
    });
  }
  /* 横匾：黑漆金字（去掉空格，按字数自动收字号，避免首尾字被裁） */
  function plaque(name, text) {
    panel(name, 300, 86, '#2b1e17', (c, w, h) => {
      c.strokeStyle = '#c8a75e'; c.lineWidth = 3;
      c.strokeRect(7, 7, w - 14, h - 14);
      const t = text.replace(/\s+/g, '');
      const size = t.length >= 4 ? 38 : 46;
      han(c, t, w / 2, h / 2 + 2, size, '#e8c987', KAI, 6);
    });
  }

  /* 戏台楹联：红底金字，竖着写 */
  function couplet(name, text) {
    panel(name, 74, 300, '#a8261e', (c, w, h) => {
      c.strokeStyle = '#e8c06a'; c.lineWidth = 3;
      c.strokeRect(5, 5, w - 10, h - 10);
      vhan(c, text, w / 2, 42, 42, '#f4dda6', 10);
    });
  }
  couplet('duiA', '戏台小天地');
  couplet('duiB', '天地大戏台');

  banner('bCha', '茶', '茶馆');
  banner('bJian', '剪纸', '窗花');
  banner('bNian', '年画', '木版');
  banner('bDeng', '灯笼', '纸扎');
  banner('bPi', '皮影', '影戏');
  banner('bZhu', '竹器', '篾匠');
  banner('bFruit', '水果', '时鲜');
  banner('bKite', '风筝', '纸鸢');
  banner('bTang', '糖葫芦', '冰糖');
  banner('bYao', '药材', '草药');
  banner('bJiu', '酒', '陈酿');
  banner('bMian', '面', '汤面');
  banner('bKe', '客栈', '住宿');
  banner('bChi', '小吃', '庙会');
  banner('bXiang', '香烛', '香火');
  banner('bTangHua', '糖画', '糖人');
  banner('bNi', '泥人', '面人');

  plaque('pCha', '茶 楼');
  plaque('pJian', '剪 纸 坊');
  plaque('pNian', '年 画 坊');
  plaque('pDeng', '灯 笼 铺');
  plaque('pPi', '皮 影 戏');
  plaque('pZhu', '竹 器 铺');
  plaque('pStage', '庙 会 戏 台');
  plaque('pMiao', '土 地 庙');
  plaque('pYao', '药 铺');
  plaque('pJiu', '酒 坊');
  plaque('pMian', '面 馆');
  plaque('pGate', '民 俗 老 街');
  plaque('pKe', '客 栈');

  /* ---- 坎儿井剖面标注：剖面图那种引线标签 ---- */
  function klabel(name, text, en) {
    panel(name, 260, 74, '#2f2a22', (c, w, h) => {
      c.strokeStyle = '#c8a75e'; c.lineWidth = 2;
      c.strokeRect(5, 5, w - 10, h - 10);
      c.fillStyle = '#e8c987';
      c.font = `bold 30px ${KAI}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, w / 2, en ? h / 2 - 6 : h / 2 + 1);
      if (en) {
        c.font = `11px ${HEI}`; c.fillStyle = '#a8916a';
        c.fillText(en, w / 2, h / 2 + 21);
      }
    });
  }
  klabel('kShaft', '竖井', 'SHAFT');
  klabel('kQan', '暗渠', 'QANAT');
  klabel('kMing', '明渠', 'OPEN CHANNEL');
  klabel('kSeep', '雪水渗入', 'SEEPAGE');
  klabel('kAqua', '含水层', 'AQUIFER');
  klabel('kGe', '戈壁表层', 'GOBI SURFACE');
  klabel('kWell', '母井', 'MOTHER WELL');
  klabel('kWo', '涝坝', 'RESERVOIR');

  /* ---- 坎儿井剖面沙盘用的几块牌子 ---- */
  plaque('pKarez', '坎 儿 井');
  plaque('pLaoba', '涝 坝');
  plaque('pWei', '竖 井');
  banner('bPu', '葡萄', '晾房');
  banner('bGua', '瓜果', '甜');
  panel('kplate', 460, 92, '#2a211a', (c, w, h) => {
    c.strokeStyle = '#b08b46'; c.lineWidth = 2; c.strokeRect(6, 6, w - 12, h - 12);
    han(c, '坎 儿 井', w / 2, 34, 32, '#d9b777', KAI, 4);
    c.font = `12px ${HEI}`; c.fillStyle = '#9c7f4e'; c.textAlign = 'center';
    c.fillText('KAREZ  ·  SECTION  MODEL', w / 2, 66);
  });
  panel('knotice', 250, 180, '#e0d3b4', (c, w, h) => {
    c.fillStyle = '#3a3122'; c.font = `bold 21px ${KAI}`; c.textAlign = 'center';
    c.fillText('坎 儿 井', w / 2, 34);
    c.font = `14px ${HEI}`; c.fillStyle = '#5a4a33';
    c.fillText('天山雪水 · 地下引渠', w / 2, 60);
    c.strokeStyle = 'rgba(60,48,30,.45)'; c.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      c.beginPath(); c.moveTo(24, 88 + i * 22); c.lineTo(w - 24, 88 + i * 22); c.stroke();
    }
  });

  /* 年画 */
  panel('nianhua', 200, 270, '#a8271f', (c, w, h) => {
    c.strokeStyle = '#e8c06a'; c.lineWidth = 3; c.strokeRect(7, 7, w - 14, h - 14);
    c.fillStyle = '#8e1f1a'; c.beginPath(); c.arc(w / 2, 118, 66, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e8c06a'; c.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      c.beginPath(); c.arc(w / 2, 118, 52 - i * 5, 0.5 + i * 0.2, 2.2 + i * 0.2); c.stroke();
    }
    c.fillStyle = '#e8c06a';
    c.beginPath(); c.ellipse(w / 2, 114, 30, 13, -0.25, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#a8271f';
    c.beginPath(); c.arc(w / 2 + 20, 110, 4, 0, Math.PI * 2); c.fill();
    vhan(c, '年年有余', w / 2, 205, 27, '#f3d79a', 5);
  });

  /* 福字 */
  panel('fu', 190, 190, '#b32d24', (c, w, h) => {
    c.save(); c.translate(w / 2, h / 2); c.rotate(Math.PI / 4);
    c.strokeStyle = '#e8c06a'; c.lineWidth = 4; c.strokeRect(-66, -66, 132, 132);
    c.restore();
    han(c, '福', w / 2, h / 2 + 4, 104, '#f6dda6');
  });

  /* 价目牌 */
  panel('price', 190, 250, '#d8c49b', (c, w, h) => {
    c.strokeStyle = '#7a5a30'; c.lineWidth = 3; c.strokeRect(6, 6, w - 12, h - 12);
    han(c, '价 目', w / 2, 28, 22, '#3d2a18', KAI, 2);
    const rows = [['茶', '3'], ['剪纸', '5'], ['年画', '8'], ['灯笼', '12'], ['竹篮', '15']];
    rows.forEach(([k, v], i) => {
      const y = 66 + i * 34;
      c.font = `20px ${KAI}`; c.fillStyle = '#33240f'; c.textAlign = 'left';
      c.fillText(k, 20, y);
      c.textAlign = 'right'; c.fillText(`¥${v}`, w - 20, y);
      c.strokeStyle = 'rgba(80,55,25,.35)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(18, y + 9); c.lineTo(w - 18, y + 9); c.stroke();
    });
  });

  /* 告示 */
  panel('notice', 230, 170, '#ded0b0', (c, w, h) => {
    c.fillStyle = '#3a3122'; c.font = `bold 19px ${KAI}`; c.textAlign = 'center';
    c.fillText('民 俗 老 街', w / 2, 32);
    c.strokeStyle = 'rgba(60,48,30,.5)'; c.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      c.beginPath(); c.moveTo(22, 56 + i * 24); c.lineTo(w - 22, 56 + i * 24); c.stroke();
    }
    c.strokeStyle = '#a8382c'; c.lineWidth = 3;
    c.beginPath(); c.arc(w - 36, h - 32, 18, 0, Math.PI * 2); c.stroke();
  });

  /* 底座铭牌 */
  panel('plate', 420, 86, '#2a211a', (c, w, h) => {
    c.strokeStyle = '#b08b46'; c.lineWidth = 2; c.strokeRect(6, 6, w - 12, h - 12);
    han(c, '民 俗 老 街', w / 2, 32, 30, '#d9b777', KAI, 2);
    c.font = `12px ${HEI}`; c.fillStyle = '#9c7f4e'; c.textAlign = 'center';
    c.fillText('FOLK  STREET  ·  BY  DAY', w / 2, 60);
  });

  /* 街名牌 */
  panel('street', 280, 100, '#1d4a74', (c, w, h) => {
    c.strokeStyle = '#e6eef4'; c.lineWidth = 3;
    c.strokeRect(6, 6, w - 12, h - 12);
    han(c, '拾遗老街', w / 2, h / 2 - 6, 40, '#f2f6f8', KAI, 4);
    c.font = `13px ${HEI}`; c.fillStyle = '#b9d2e4'; c.textAlign = 'center';
    c.fillText('SHIYI  OLD  STREET', w / 2, h - 20);
  });

  /* ---- 水乡社戏用的几块牌子（只做追加，前面已有图块的位置不变） ---- */
  plaque('pShe', '社 戏 台');
  plaque('pShemiao', '社 庙');
  banner('bGao', '糕团', '水磨');
  banner('bLing', '菱角', '河鲜');
  banner('bZong', '粽子', '箬叶');
  banner('bYu', '鱼鲜', '河捕');
  panel('plateShexi', 460, 92, '#22323a', (c, w, h) => {
    c.strokeStyle = '#8fb6c4'; c.lineWidth = 2; c.strokeRect(6, 6, w - 12, h - 12);
    han(c, '水 乡 社 戏', w / 2, 34, 30, '#d7ecf2', KAI, 4);
    c.font = `12px ${HEI}`; c.fillStyle = '#8fb6c4'; c.textAlign = 'center';
    c.fillText('WATER-TOWN  SHE-DRAMA', w / 2, 66);
  });
  panel('noticeShexi', 250, 200, '#e2dcc8', (c, w, h) => {
    c.fillStyle = '#33403c'; c.font = `bold 21px ${KAI}`; c.textAlign = 'center';
    c.fillText('戏 单', w / 2, 32);
    c.font = `13px ${HEI}`; c.fillStyle = '#5a655e';
    c.fillText('示意 · 不排具体剧目', w / 2, 56);
    c.strokeStyle = 'rgba(60,72,66,.4)'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      c.beginPath(); c.moveTo(24, 84 + i * 22); c.lineTo(w - 24, 84 + i * 22); c.stroke();
    }
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, rects };
})();
signMat.map = ATLAS.tex;

/* ---------- 合批：所有静态零件按材质装进 4 个桶 ---------- */
const BUCKETS = new Map();
function bucket(name) {
  let b = BUCKETS.get(name);
  if (!b) {
    b = { pos: [], nor: [], uv: [], col: [], piv: [], del: [] };
    BUCKETS.set(name, b);
  }
  return b;
}
let nowDelay = 0;
function layer(d) { nowDelay = d; }

const _col = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/* 整块内容沿街平移用：设 OX 后，接下来 addGeo 的 x 全部加上这个偏移 */
let OX = 0;

function addGeo(geo, hex, o = {}) {
  const x = (o.x || 0) + OX, y = o.y || 0, z = o.z || 0;
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(o.sx || 1, o.sy || 1, o.sz || 1);
  _m.compose(_p, _q, _s);

  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(_m);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const thin = Math.min(
    Math.abs(bb.max.x - bb.min.x),
    Math.abs(bb.max.y - bb.min.y),
    Math.abs(bb.max.z - bb.min.z)
  ) < 0.058;
  /* 比描边还细的零件（电线、竹签、栅条）不描边，否则会被墨线糊掉 */
  const b = bucket(o.bucket || (thin ? 'fine' : 'solid'));
  const pa = g.attributes.position.array;
  const na = g.attributes.normal.array;
  const ua = g.attributes.uv ? g.attributes.uv.array : null;

  _col.set(hex);
  if (o.tint) _col.multiply(new THREE.Color(o.tint));
  const jit = o.jitter === false ? 1 : 0.95 + rand() * 0.08;
  const cr = _col.r * jit, cg = _col.g * jit, cb = _col.b * jit;

  const pivot = o.pivot ? [o.pivot[0] + OX, o.pivot[1], o.pivot[2]] : [x, 0, z];
  const d = o.delay != null ? o.delay : nowDelay;
  const uvR = o.uvRect;
  const n = pa.length / 3;
  for (let i = 0; i < n; i++) {
    b.pos.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
    b.nor.push(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
    if (ua) {
      let u = ua[i * 2], v = ua[i * 2 + 1];
      if (uvR) { u = uvR[0] + u * (uvR[2] - uvR[0]); v = uvR[1] + v * (uvR[3] - uvR[1]); }
      b.uv.push(u, v);
    } else {
      b.uv.push(0, 0);
    }
    b.col.push(cr, cg, cb);
    b.piv.push(pivot[0], pivot[1], pivot[2]);
    b.del.push(d);
  }
  g.dispose();
}

function toGeometry(b) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setAttribute('aPivot', new THREE.Float32BufferAttribute(b.piv, 3));
  geo.setAttribute('aDelay', new THREE.Float32BufferAttribute(b.del, 1));
  geo.computeBoundingSphere();
  return geo;
}

/* ---------- 常用体块 ---------- */
const P = {
  box(w, h, d, c, x, y, z, o) { addGeo(new THREE.BoxGeometry(w, h, d), c, { ...o, x, y, z }); },
  box0(w, h, d, c, x, y0, z, o) { this.box(w, h, d, c, x, y0 + h / 2, z, o); },
  cyl(rt, rb, h, c, x, y, z, o, seg = 14) { addGeo(new THREE.CylinderGeometry(rt, rb, h, seg), c, { ...o, x, y, z }); },
  cyl0(rt, rb, h, c, x, y0, z, o, seg = 14) { this.cyl(rt, rb, h, c, x, y0 + h / 2, z, o, seg); },
  sph(r, c, x, y, z, o, ws = 12, hs = 8) { addGeo(new THREE.SphereGeometry(r, ws, hs), c, { ...o, x, y, z }); },
  plane(w, h, c, x, y, z, o) { addGeo(new THREE.PlaneGeometry(w, h), c, { ...o, x, y, z }); },
  torus(r, tube, c, x, y, z, o, rs = 8, ts = 16) {
    addGeo(new THREE.TorusGeometry(r, tube, rs, ts), c, { ...o, x, y, z });
  },
  tube(pts, r, c, o, seg = 40, rad = 5) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    addGeo(new THREE.TubeGeometry(curve, seg, r, rad, false), c, o || {});
  },
  sign(name, w, h, x, y, z, o = {}) {
    addGeo(new THREE.PlaneGeometry(w, h), o.color || 0xffffff, {
      ...o, x, y, z, bucket: 'sign', uvRect: ATLAS.rects[name], jitter: false,
    });
  },
  glowBox(w, h, d, c, x, y, z, o) {
    addGeo(new THREE.BoxGeometry(w, h, d), c, { ...o, x, y, z, bucket: 'glow', jitter: false });
  },
  glowPlane(w, h, c, x, y, z, o) {
    addGeo(new THREE.PlaneGeometry(w, h), c, { ...o, x, y, z, bucket: 'glow', jitter: false });
  },
  glassPlane(w, h, x, y, z, o) {
    addGeo(new THREE.PlaneGeometry(w, h), 0xdff0ff, { ...o, x, y, z, bucket: 'glass', jitter: false });
  },
  glass(w, h, d, x, y, z, o) {
    addGeo(new THREE.BoxGeometry(w, h, d), 0xdff0ff, { ...o, x, y, z, bucket: 'glass', jitter: false });
  },
};

/* 把桶变成 mesh：solid 桶额外生成一层描边 */
const worldGroups = new THREE.Group();
scene.add(worldGroups);

/** 需要加光晕 sprites 的位置：[x, y, z, size, color, opacity] */
const glowPts = [];

function finishBucket(name, mat, outline) {
  const b = BUCKETS.get(name);
  if (!b || !b.pos.length) return null;
  const geo = toGeometry(b);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (!QS.has('nodepth')) mesh.customDepthMaterial = depthMat;
  if (outline) {
    const out = new THREE.Mesh(geo, outlineMat);
    out.frustumCulled = false;
    out.castShadow = false;
    out.receiveShadow = false;
    out.renderOrder = -1;
    mesh.renderOrder = 1;
    worldGroups.add(out);
  }
  worldGroups.add(mesh);
  BUCKETS.delete(name);
  return mesh;
}

/* ---------- 15 · 地形：竹山、台地、挡土石坎 ----------
 * 这是站内第一个「底座内的真地形」。三条约定：
 *   1. 山形由 00-boot.js 的 hillY(x, z) 唯一决定，几何与物件摆放都从它取值；
 *   2. 山体按横向条带堆（照 karez 剖面「几段平直长条、避免逐列接缝」的做法），
 *      剪影呈台阶状，在三渲二平涂下反而干净，而且能并进静态合批；
 *   3. 山高卡死在 ZA.hillH（7.6 m ≤ 底座短边 24 / 3），不能顶破底座轮廓。
 */

const TEC = {
  hillFar: 0x6d8a5c,   // 山体远侧（偏冷，让山退后）
  hillMid: 0x7d9a63,   // 山体中间调
  hillNear: 0x8da971,  // 山体近侧（受光）
  hillRock: 0x8f8776,  // 露石
  terrace: 0xa89468,   // 台地夯土
  terraceAlt: 0xb5a175,
  terraceDark: 0x8f7c56,
  stoneW: 0xa9a08f,    // 挡土石坎
  stoneWDark: 0x8c8474,
  path: 0xb9a67c,      // 山道
  dirt: 0x9c8a63,
  moss: 0x6f8256,
};

/* 山溪的水色。
 * 注意：不能直接照搬 shexi 的公共口径——那套是水乡的浅蓝（waterHi 0x9fd4e6），
 * 用在山溪上会亮成游泳池。山溪要偏**青绿、压暗、低饱和**。
 * 顶层（waterHi）是实际看得见的那一层，所以它的值最关键。 */
const WAC = {
  waterDeep: 0x1f3d45,   // 深水：青黑
  water: 0x2d5a63,       // 中调：青绿
  waterHi: 0x47787f,     // 表层（实际可见）：压暗的青绿，不是亮蓝
  waterEdge: 0x17303a,   // 岸边最深
  reed: 0xa8a05c,
};

/* ---------- 底座板 ----------
 * 一块完整的厚板，边缘整齐；山与台地都坐在它上面。
 *
 * ⚠️ 关键：底座板**不能是一整块实心**，否则河会被埋掉。
 * 板顶在 baseBottom + 0.78 = −0.02，而水面在 waterY = −0.30 —— 板比水面高 0.28 米，
 * 一整块板铺过去就等于在溪上盖了块盖板，水色/水纹/涟漪全部看不见。
 * 这正是 shexi/scene/20-water.js 开头注释里提醒过的那件事。
 * 所以这里把板切成**两块**：河北岸一块（到 bankZ 为止）、河南岸一块（从 farBankZ 起），
 * 中间让出河槽，只铺一条低下去的河床。
 */
const BOARD_TOP = ZA.baseBottom + 0.78;   // = -0.02
{
  const northD = ZA.bankZ - (-ZA.halfZ);          // z: -12 → bankZ
  const southD = ZA.halfZ - ZA.farBankZ;          // z: farBankZ → +12
  /* 北岸块 */
  P.box(ZA.halfX * 2, 0.72, northD, PAL.base, 0, ZA.baseBottom + 0.36, -ZA.halfZ + northD / 2, { jitter: false });
  P.box(ZA.halfX * 2 - 0.06, 0.06, northD - 0.06, PAL.baseTop, 0, ZA.baseBottom + 0.75, -ZA.halfZ + northD / 2, { jitter: false });
  /* 南岸块 */
  P.box(ZA.halfX * 2, 0.72, southD, PAL.base, 0, ZA.baseBottom + 0.36, ZA.farBankZ + southD / 2, { jitter: false });
  P.box(ZA.halfX * 2 - 0.06, 0.06, southD - 0.06, PAL.baseTop, 0, ZA.baseBottom + 0.75, ZA.farBankZ + southD / 2, { jitter: false });
  /* 河槽底：两岸之间只铺一层低板，让河有「床」。
     顶面必须**明显低于水面（waterY = −0.30）**，否则又变成一块盖板。
     这里顶面落在 waterY − 0.72，是真正的床底。 */
  P.box(ZA.halfX * 2, 0.5, ZA.farBankZ - ZA.bankZ, 0x2f4a3c, 0, ZA.waterY - 0.72 - 0.25, (ZA.bankZ + ZA.farBankZ) / 2, { jitter: false });
}
/* 底座四周一道浅色收边（东西两侧整条；南北两侧被河断开，只留两岸的段） */
for (const [w, d, x, z] of [
  [ZA.halfX * 2 + 0.16, 0.16, 0, -ZA.halfZ],
  [ZA.halfX * 2 + 0.16, 0.16, 0, ZA.halfZ],
  [0.16, ZA.halfZ * 2 + 0.16, -ZA.halfX, 0],
  [0.16, ZA.halfZ * 2 + 0.16, ZA.halfX, 0],
]) {
  P.box(w, 0.2, d, 0x6b563d, x, ZA.baseBottom + 0.66, z, { jitter: false });
}

/* ---------- 北层 · 竹山 ----------
 * **一张高程网格**，不是一摞盒子。
 *
 * 初版沿 Z 切 11 条横向条带、每条用 Box 拉成一段台（照 karez 剖面的"平直长条"做法）。
 * 那个做法对剖面沙盘没问题，但用在一座**要近看的山**上就很糟：
 *   ① 相邻条带高度不同 → 每条都露出一圈**竖向硬边**，近看是一撮错开的平板；
 *   ② 条带之间靠 1.06 的倍率互相压，压不住的地方留**细缝**；
 *   ③ 只有三档颜色 → 坡面上是**三道横杠**。
 * 现在改成真正的高程曲面：顶点按 hillY 采样、平滑法线、顶点色做连续过渡，
 * 缝、硬边、横杠三个问题一起消失。
 */
{
  const NX = 92, NZ = 26;                       // 网格分辨率
  const x0 = -ZA.halfX, x1 = ZA.halfX;
  const z0 = ZA.ridgeZ, z1 = ZA.hillToe;
  const cols = NX + 1, rows = NZ + 1;

  const pos = [], col = [], uv = [], piv = [], del = [], index = [];
  const CC = new THREE.Color();
  const FAR = new THREE.Color(TEC.hillFar);
  const MID = new THREE.Color(TEC.hillMid);
  const NEAR = new THREE.Color(TEC.hillNear);

  /* 逐顶点：位置、颜色、组装用的 pivot 与延迟 */
  for (let i = 0; i < rows; i++) {
    const tz = i / NZ;
    const z = z0 + (z1 - z0) * tz;
    for (let j = 0; j < cols; j++) {
      const tx = j / NX;
      const x = x0 + (x1 - x0) * tx;
      const h = hillY(x, z);
      pos.push(x, h, z);
      uv.push(tx * 8, tz * 3);

      /* 颜色：按"离山脊的远近"在两段之间连续插值，再加一点逐点噪声，
         这样坡面上是渐变的，不会出现三道横杠。 */
      if (tz < 0.5) CC.copy(FAR).lerp(MID, tz * 2);
      else CC.copy(MID).lerp(NEAR, (tz - 0.5) * 2);
      /* 高处略偏黄褐（竹叶稀、露土多），低处略偏深绿 */
      const dry = Math.min(h / ZA.hillH, 1) * 0.16;
      CC.offsetHSL(0.012 * (rand() - 0.5), -0.03 * (rand() - 0.5), dry * (rand() - 0.4));
      col.push(CC.r, CC.g, CC.b);

      piv.push(x, 0, z);
      del.push(tz * 0.5);                       // 组装：从山脊往山脚依次长出来
    }
  }
  /* 三角面 */
  for (let i = 0; i < NZ; i++) {
    for (let j = 0; j < NX; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aPivot', new THREE.Float32BufferAttribute(piv, 3));
  geo.setAttribute('aDelay', new THREE.Float32BufferAttribute(del, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const hill = new THREE.Mesh(geo, toonMat);
  hill.castShadow = true;
  hill.receiveShadow = true;
  hill.customDepthMaterial = depthMat;
  hill.frustumCulled = false;
  worldGroups.add(hill);

  /* 露石：贴着坡面散一些，破掉纯色。位置取 hillY，别浮空也别埋进去。 */
  for (let i = 0; i < 70; i++) {
    const x = rnd(-ZA.halfX + 0.6, ZA.halfX - 0.6);
    const z = rnd(z0 + 0.8, z1 - 0.5);
    const h = hillY(x, z);
    if (h < 0.35) continue;
    const r = rnd(0.22, 0.55);
    P.sph(r, pick([TEC.hillRock, TEC.stoneW, TEC.stoneWDark]),
      x, h + r * rnd(0.05, 0.35), z, { sy: rnd(0.45, 0.7), jitter: true, ry: rnd(0, 3.14) }, 8, 6);
  }

  /* 山脚一圈青苔与碎石：山与台地的过渡，别让山「切」在台地上 */
  for (let i = 0; i < 110; i++) {
    const x = rnd(-ZA.halfX + 0.8, ZA.halfX - 0.8);
    const z = ZA.hillToe + rnd(-0.7, 0.8);
    P.sph(rnd(0.12, 0.3), pick([TEC.moss, TEC.stoneW, TEC.stoneWDark]),
      x, ZA.terraceY + rnd(0.02, 0.1), z, { sy: 0.6, jitter: true }, 7, 4);
  }
}

/* ---------- 山道：从山上折下来通向纸坊 ----------
 * 跟着 hillY 走，每一段都踩在坡面上（这一步最容易漏，漏了就浮空）。
 *
 * 初版每段是一块 1.1~1.35 宽、0.09 厚的亮色扁盒，段长很短、互相压 1.25 倍，
 * 近看就是**一挂错开的石板台阶**，而且颜色比坡面亮很多，非常跳。
 * 现在改成：路面压暗压薄、贴近坡色，段与段之间轻微交叠但不露台阶；
 * 只在路的**两侧**摆小石子，暗示这是一条被踩出来的土路。
 */
{
  const pts = [];
  let x = 4.6, z = -9.4;
  pts.push([x, hillY(x, z), z]);
  const legs = [
    [3.4, -8.0], [2.2, -6.8], [1.4, -5.8], [0.6, -4.6],
    [-0.2, -3.6], [-0.6, -2.6],
  ];
  for (const [nx, nz] of legs) {
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = x + (nx - x) * t;
      const pz = z + (nz - z) * t;
      pts.push([px, Math.max(hillY(px, pz), ZA.terraceY), pz]);
    }
    x = nx; z = nz;
  }

  const PATH_W = 1.02;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[i + 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2;
    const len = Math.hypot(bx - ax, bz - az);
    const ang = Math.atan2(bx - ax, bz - az);
    /* 路面：薄、暗、宽度固定，段长只多压 8% —— 不露台阶 */
    P.box0(PATH_W, 0.045, len * 1.08, TEC.dirt, mx, my + 0.012, mz, { ry: ang, jitter: true });
    /* 路心的踩痕：一条更深的窄带 */
    P.box0(PATH_W * 0.5, 0.02, len * 1.04, 0x8a7a55, mx, my + 0.032, mz, { ry: ang, jitter: true, bucket: 'fine' });
    /* 两侧的小石子：把路「镶」进坡里，不然还是一张贴片 */
    for (const s of [-1, 1]) {
      if (rand() < 0.55) continue;
      const nx2 = mx + Math.cos(ang) * s * (PATH_W / 2 + rnd(0.02, 0.16));
      const nz2 = mz - Math.sin(ang) * s * (PATH_W / 2 + rnd(0.02, 0.16));
      P.sph(rnd(0.05, 0.12), pick([TEC.stoneW, TEC.stoneWDark, TEC.moss]),
        nx2, Math.max(hillY(nx2, nz2), ZA.terraceY) + 0.03, nz2, { sy: 0.6, jitter: true }, 6, 4);
    }
  }
}

/* ---------- 中层 · 坡上台地 ---------- */
{
  const d = ZA.terraceZ1 - ZA.terraceZ0;   // 进深
  const zc = (ZA.terraceZ0 + ZA.terraceZ1) / 2;

  /* 夯土台地（略高于溪岸） */
  P.box0(ZA.halfX * 2 - 0.3, ZA.terraceY, d, TEC.terrace, 0, 0, zc, { jitter: false });
  /* 台面：拼几块深浅不同的夯土，避免一整片死板 */
  const tiles = 26;
  const tw = (ZA.halfX * 2 - 0.3) / tiles;
  for (let i = 0; i < tiles; i++) {
    const tx = -ZA.halfX + 0.15 + tw * (i + 0.5);
    P.box0(tw * 0.96, 0.05, d * rnd(0.5, 0.95), pick([TEC.terraceAlt, TEC.terraceDark, TEC.terrace]),
      tx, ZA.terraceY, zc + rnd(-d * 0.16, d * 0.16), { jitter: true });
  }

  /* 东西向主通道：把各个工位串起来 */
  P.box0(ZA.halfX * 2 - 1.2, 0.07, 1.9, TEC.path, 0, ZA.terraceY, ZA.laneZ, { jitter: false });
  for (let x = -ZA.halfX + 1.2; x < ZA.halfX - 0.8; x += rnd(1.4, 2.6)) {
    P.box0(rnd(0.5, 1.2), 0.045, rnd(0.5, 1.0), TEC.dirt, x, ZA.terraceY, ZA.laneZ + rnd(-0.5, 0.5), { jitter: true });
  }

  /* 靠山一侧的挡土石坎：一长列错缝的石头。
     注意坎要摆在山脚（terraceZ0）略靠北一点，别压到主通道 laneZ 上。 */
  const curbZ = ZA.hillToe - 0.35;
  for (let x = -ZA.halfX + 0.7; x < ZA.halfX - 0.7; x += rnd(0.52, 0.78)) {
    const h = rnd(0.5, 0.82);
    P.box0(rnd(0.42, 0.62), h, rnd(0.44, 0.6), pick([TEC.stoneW, TEC.stoneWDark]),
      x, ZA.terraceY, curbZ, { jitter: true, ry: rnd(-0.08, 0.08) });
    if (rand() < 0.3) {
      P.box0(rnd(0.36, 0.5), rnd(0.26, 0.4), rnd(0.4, 0.5), TEC.stoneWDark,
        x + rnd(-0.1, 0.1), ZA.terraceY + h, curbZ, { jitter: true });
    }
  }

  /* 山脚本身也补一排碎石，让坎与山衔接上 */
  for (let i = 0; i < 60; i++) {
    const x = rnd(-ZA.halfX + 0.8, ZA.halfX - 0.8);
    const z = ZA.hillToe + rnd(-0.2, 0.3);
    P.sph(rnd(0.1, 0.24), pick([TEC.stoneW, TEC.stoneWDark, TEC.moss]),
      x, ZA.terraceY + rnd(0.04, 0.14), z, { sy: 0.62, jitter: true }, 7, 4);
  }

  /* 溪北岸的驳岸石（南缘收边）。
     初版石块 0.4~0.66 宽、0.3~0.55 高，密排成一行，近看像一堵方块墙。
     改小、错落、并掺一部分卵石（球），才是"砌岸"而不是"码砖"。 */
  for (let x = -ZA.halfX + 0.5; x < ZA.halfX - 0.5; x += rnd(0.42, 0.78)) {
    const y0b = ZA.waterY + rnd(0.12, 0.26);
    if (rand() < 0.3) {
      P.sph(rnd(0.16, 0.3), pick([TEC.stoneW, TEC.stoneWDark, TEC.moss]),
        x, y0b + 0.1, ZA.bankZ - rnd(0.05, 0.22), { sy: rnd(0.55, 0.8), jitter: true, ry: rnd(-0.3, 0.3) }, 7, 5);
    } else {
      P.box0(rnd(0.3, 0.52), rnd(0.2, 0.36), rnd(0.32, 0.5), pick([TEC.stoneW, TEC.stoneWDark]),
        x, y0b, ZA.bankZ - rnd(0.05, 0.22), { jitter: true, ry: rnd(-0.16, 0.16) });
    }
  }
}

/* ---------- 南层 · 山溪 ----------
 * 水面用三层薄盒（深水 / 水 / 高光）+ 静态涟漪 + **两层流动的波纹贴图**。
 *
 * 初版只做了三层色带 + 12 个小涟漪圈，而溪面是 40×7 米的一大片，
 * 结果就是一块死板的绿板子——小涟漪在这么大片面积上等于没有。
 * 照 shexi/scene/50-life.js 的做法补两层可滚动的水纹贴图：
 *   一层细密短纹（近看有水感）+ 一层疏长大纹（远看有流向），
 *   两层反向滚动，视觉上就是水在往东流。
 */
const ZH_WATER = { ripples: [] };
{
  const w = ZA.farBankZ - ZA.bankZ;
  const zc = (ZA.bankZ + ZA.farBankZ) / 2;

  /* （河床已在「底座板」那一节铺好，这里不再重复铺，避免两层床互相打架） */

  /* 水体：三层**薄片**（不是盒子），顶面依次抬高一点点。
     盒子的侧面在斜视时会露出一条深色边，看着像水面缺了一块；
     改用薄片之后只留水平面，层次干净。 */
  const LAYERS = [
    [WAC.waterDeep, 0.03, -0.16],
    [WAC.water, 0.03, -0.09],
    [WAC.waterHi, 0.02, -0.035],
  ];
  for (const [c, t, dy] of LAYERS) {
    P.box(ZA.halfX * 2 - 0.1, t, w - 0.06, c, 0, ZA.waterY + dy, zc, { jitter: false, bucket: 'fine' });
  }

  /* 溪面的水纹：两层，一张 canvas 画细密短纹、一张画疏长大纹 */
  {
    const cv0 = document.createElement('canvas');
    cv0.width = cv0.height = 512;
    const g = cv0.getContext('2d');
    /* 第一层：细密短纹 */
    for (let i = 0; i < 150; i++) {
      const y = rand() * 512, x = rand() * 512;
      const len = rnd(28, 96);
      g.strokeStyle = `rgba(226,246,252,${rnd(0.08, 0.4).toFixed(2)})`;
      g.lineWidth = rnd(1.0, 2.6);
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + len * 0.3, y + rnd(-3, 3), x + len * 0.7, y + rnd(-3, 3), x + len, y + rnd(-2, 2));
      g.stroke();
    }
    /* 第二层：疏长大纹（远看有流向） */
    const cv1 = document.createElement('canvas');
    cv1.width = cv1.height = 512;
    const g2 = cv1.getContext('2d');
    for (let i = 0; i < 54; i++) {
      const y = rand() * 512, x = rand() * 512;
      const len = rnd(90, 250);
      g2.strokeStyle = `rgba(226,246,252,${rnd(0.1, 0.5).toFixed(2)})`;
      g2.lineWidth = rnd(1.6, 4.2);
      g2.beginPath();
      g2.moveTo(x, y);
      g2.bezierCurveTo(x + len * 0.3, y + rnd(-6, 6), x + len * 0.7, y + rnd(-6, 6), x + len, y + rnd(-4, 4));
      g2.stroke();
    }

    /* 两层各自铺满整个溪面，反向滚动 → 水往东流。 */
    const planeW = ZA.halfX * 2 - 0.4;
    const planeD = w - 0.16;
    for (const [cv, repX, repY, speed, dy, op] of [
      [cv0, 4.0, 3.5, -0.030, 0.035, 0.66],
      [cv1, 1.6, 1.4, 0.020, 0.052, 0.38],
    ]) {
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.repeat.set(repX, repY);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: op, depthWrite: false,
        depthTest: true, fog: true, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeD), mat);
      m.rotation.x = -Math.PI / 2;
      m.frustumCulled = false;
      m.position.set(0, ZA.waterY + dy, zc);
      m.renderOrder = 3;
      worldGroups.add(m);
      ZH_WATER.ripples.push({ tex, speed });
    }
  }

  /* 水面的静态涟漪（埠头与桥下那种一圈圈的水花） */
  for (let i = 0; i < 14; i++) {
    const x = rnd(-ZA.halfX + 2, ZA.halfX - 2);
    const z = rnd(ZA.bankZ + 0.7, ZA.farBankZ - 0.7);
    P.torus(rnd(0.3, 0.72), 0.026, WAC.waterHi, x, ZA.waterY + 0.03, z,
      { rx: -Math.PI / 2, jitter: false, bucket: 'glow' }, 6, 18);
  }

  /* 水面的倒影：岸上的房子与水碓映在水里，靠北岸压一条深色。
     初版是一排等宽深蓝方块，看着像贴了一地瓷砖——因为太规则、太实。
     改成：宽窄随机、颜色只用比水色稍深一点的青，并且贴着北岸排（倒影本来就靠岸）。 */
  for (let x = -ZA.halfX + 0.8; x < ZA.halfX - 0.8; x += rnd(1.6, 3.6)) {
    const bw = rnd(0.8, 2.6);
    const bd = rnd(0.6, 1.5);
    const off = rnd(0.5, 2.1);
    P.box(bw, 0.014, bd, pick([WAC.waterDeep, WAC.water, WAC.waterEdge]),
      x, ZA.waterY + 0.005, ZA.bankZ + off, { jitter: true, ry: rnd(-0.2, 0.2), bucket: 'fine' });
  }
  /* 东头（水碓下游）加一道淡淡的白沫，暗示水流经过 */
  for (let i = 0; i < 22; i++) {
    const x = rnd(ZA.millX - 1.5, ZA.millX + 3.5);
    const z = rnd(ZA.bankZ + 0.6, ZA.farBankZ - 0.8);
    P.box(rnd(0.3, 0.9), 0.012, rnd(0.12, 0.3), 0x8fb0b4, x, ZA.waterY + 0.022, z,
      { jitter: true, ry: rnd(-0.3, 0.3), bucket: 'fine' });
  }

  /* 溪南岸：一直铺到底座南缘，不留裸板。
     注意这块是**岸**，必须完全落在 farBankZ 以南；
     P.box0 的第 6 个参数是 y0（底面），别让它长到河里去。 */
  P.box0(ZA.halfX * 2, 0.42, ZA.halfZ - ZA.farBankZ, TEC.terraceDark,
    0, ZA.waterY - 0.1, (ZA.farBankZ + ZA.halfZ) / 2, { jitter: false });
  /* 溪南岸的石滩：同样改小、错落，掺卵石 */
  for (let x = -ZA.halfX + 0.5; x < ZA.halfX - 0.5; x += rnd(0.5, 0.9)) {
    const zz = ZA.farBankZ + rnd(-0.1, 0.45);
    const yy = ZA.waterY + rnd(0.3, 0.42);
    if (rand() < 0.32) {
      P.sph(rnd(0.17, 0.3), pick([TEC.stoneW, TEC.stoneWDark, TEC.moss]), x, yy + 0.08, zz,
        { sy: rnd(0.55, 0.8), jitter: true, ry: rnd(-0.3, 0.3) }, 7, 5);
    } else {
      P.box0(rnd(0.3, 0.56), rnd(0.2, 0.34), rnd(0.32, 0.56), pick([TEC.stoneW, TEC.stoneWDark, TEC.moss]),
        x, yy, zz, { jitter: true, ry: rnd(-0.18, 0.18) });
    }
  }

  /* 南岸几丛芦苇：水面收边用 */
  for (let i = 0; i < 46; i++) {
    const x = rnd(-ZA.halfX + 1, ZA.halfX - 1);
    const z = ZA.farBankZ - rnd(0.1, 0.6);
    P.cyl(0.02, 0.03, rnd(0.6, 1.1), WAC.reed, x, ZA.waterY + 0.5, z, { rz: rnd(-0.18, 0.18), jitter: false }, 5);
    P.sph(0.08, WAC.reed, x, ZA.waterY + 1.0, z, { sy: 0.45, jitter: false }, 6, 4);
  }
}
/* ---------- 16 · 竹林 ----------
 * 竹山要「成片」才有说服力，逐株建会瞬间撑爆合批预算，
 * 所以这里全部走 InstancedMesh（照 miaohui 人群与灯串的做法）。
 *
 * 一根竹子由四部分构成（初版只有「光竿 + 顶端几片叶」，近看太简陋）：
 *   竹竿（分段、有锥度、微微弯）→ 竹节箍（每段一道）→ 侧枝（上半段斜出）→ 竹叶簇（挂在枝上）
 * 叶量按「枝上有叶、叶成簇」来排，而不是把几片叶孤零零贴在竿顶。
 *
 * 铁律：每根竹子的落点高度必须取 hillY(x, z)，
 *       漏掉就会整片浮空或穿进山里（这是本项目最容易翻车的地方）。
 */

const BMC = {
  culm: 0xc7a46c,
  culmAlt: 0xb8985f,
  culmYoung: 0xa8b45c,   // 新竹偏青
  node: 0x9c7f4e,
  nodeDark: 0x7d6338,
  branch: 0x8a7448,
  leafA: 0x4f7a45,
  leafB: 0x6f9d55,
  leafC: 0x3f6a3c,
  leafD: 0x86a85a,
  leafDry: 0x8a8a4a,
};

const BAMBOO_H = 6.6;
const NODE_GAP = BAMBOO_H / 5;      // 五段，每段一道节箍

/* 竹竿：一整根，上细下粗（收分明显，竹子的特征） */
const culmGeo = new THREE.CylinderGeometry(0.045, 0.088, BAMBOO_H, 7, 1, true);
/* 竹节：套在竿上的短箍，比竿略粗——这是竹子最醒目的特征 */
const nodeGeo = new THREE.CylinderGeometry(0.078, 0.086, 0.1, 7);
/* 侧枝：细杆，从竹节斜出 */
const branchGeo = new THREE.CylinderGeometry(0.018, 0.03, 1.5, 4);
/* 竹叶：窄长的一片。做成「叶」，不是方块，也不是外飞的细条 */
const leafGeo = new THREE.PlaneGeometry(0.62, 0.11);

const bambooMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientTexture() });
const leafMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientTexture(), side: THREE.DoubleSide });

/* 会随风轻晃的实例网格（整片一起摆，低强度底噪） */
const bambooSway = [];

/* 先在 (x, z) 上撒点：越靠山脊越密，山脚稀疏，
   留出山道两侧的空档，别把路堵死 */
const bambooSpots = [];
{
  const step = 0.82;
  for (let x = -ZA.halfX + 0.5; x < ZA.halfX - 0.5; x += step) {
    for (let z = ZA.ridgeZ + 0.4; z < ZA.hillToe - 0.35; z += step) {
      const h = hillY(x, z);
      if (h < 0.22) continue;                       // 山脚以外不长竹
      /* 山道两侧留空：山道大致沿 x≈1±2 由北向南折下 */
      const laneClear = Math.abs(x - (1.4 - (z + 6) * 0.55)) < 1.5;
      if (laneClear) continue;
      /* 密度：坡上密、山脚疏 */
      const dens = 0.34 + 0.42 * (h / ZA.hillH);
      if (rand() > dens) continue;
      bambooSpots.push([x + rnd(-0.24, 0.24), z + rnd(-0.24, 0.24)]);
    }
  }
}

{
  const total = bambooSpots.length;
  const culms = new THREE.InstancedMesh(culmGeo, bambooMat, total);
  /* 五段竿 × 每段一道节箍 */
  const nodes = new THREE.InstancedMesh(nodeGeo,
    new THREE.MeshToonMaterial({ color: BMC.node, gradientMap: gradientTexture() }), total * 5);
  /* 侧枝：上半段每节出一枝，最多 3 枝 */
  const branches = new THREE.InstancedMesh(branchGeo,
    new THREE.MeshToonMaterial({ color: BMC.branch, gradientMap: gradientTexture() }), total * 3);
  /* 叶量大：每根 16~26 片，挂在枝端成簇 */
  const LEAF_PER = 26;
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, total * LEAF_PER);
  culms.castShadow = true;
  culms.receiveShadow = true;
  nodes.castShadow = false;
  branches.castShadow = false;
  leaves.castShadow = true;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let nodeIdx = 0, branchIdx = 0, leafIdx = 0;

  for (let i = 0; i < total; i++) {
    const [x, z] = bambooSpots[i];
    const y = hillY(x, z);
    const s = rnd(0.72, 1.18);                      // 每根高矮不同
    const lean = rnd(-0.06, 0.06);                  // 微微倾斜
    const leanZ = rnd(-0.06, 0.06);
    const spin = rnd(0, Math.PI * 2);

    /* 竹竿 */
    dummy.position.set(x, y + (BAMBOO_H * s) / 2 - 0.12, z);
    dummy.rotation.set(leanZ, spin, lean);
    dummy.scale.set(1, s, 1);
    dummy.updateMatrix();
    culms.setMatrixAt(i, dummy.matrix);
    const young = rand() < 0.28;                    // 新竹偏青
    col.set(young ? BMC.culmYoung : rand() < 0.4 ? BMC.culmAlt : BMC.culm);
    culms.setColorAt(i, col);

    /* 竹节：五等分位置各套一道箍（比竿略粗，是竹子最醒目的特征） */
    for (let k = 1; k <= 5; k++) {
      const ny = y + BAMBOO_H * s * (k / 5) - 0.12;
      dummy.position.set(x, ny, z);
      dummy.rotation.set(leanZ, spin, lean);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      nodes.setMatrixAt(nodeIdx++, dummy.matrix);
    }

    /* 侧枝：从上半段的节点斜出，每根 2~3 枝 */
    const nBranch = 2 + Math.floor(rand() * 2);
    const branchTips = [];
    for (let b = 0; b < nBranch && branchIdx < total * 3; b++) {
      /* 挂在第 3~5 段上 */
      const seg = 3 + b;
      const by = y + BAMBOO_H * s * (seg / 5) - 0.12;
      const bAng = spin + b * 2.1 + rnd(-0.4, 0.4);
      const bLen = rnd(0.9, 1.5) * s;
      const bTilt = rnd(0.5, 0.95);                 // 往外张开的角度
      /* 枝根位置（贴着竿） */
      const bx = x + Math.cos(lean) * 0.02;
      const bz = z + Math.sin(leanZ) * 0.02;
      /* 枝端位置 */
      const tipX = bx + Math.cos(bAng) * Math.sin(bTilt) * bLen;
      const tipZ = bz + Math.sin(bAng) * Math.sin(bTilt) * bLen;
      const tipY = by + Math.cos(bTilt) * bLen * 0.55;

      /* 枝：从枝根指向枝端 */
      const mx = (bx + tipX) / 2, mz = (bz + tipZ) / 2, my = (by + tipY) / 2;
      dummy.position.set(mx, my, mz);
      dummy.rotation.set(0, -bAng, bTilt - Math.PI / 2, 'YXZ');
      dummy.scale.set(1, bLen / 1.5, 1);
      dummy.updateMatrix();
      branches.setMatrixAt(branchIdx++, dummy.matrix);

      branchTips.push([tipX, tipY, tipZ]);
    }

    /* 竹叶：成簇挂在枝端（不是孤零零贴在竿顶），每簇 7~10 片 */
    const perTip = Math.max(4, Math.floor(LEAF_PER / Math.max(branchTips.length, 1)));
    for (const [tx, ty, tz] of branchTips) {
      const n = perTip + Math.floor(rand() * 4);
      const spread = rnd(0.1, 0.26);
      for (let k = 0; k < n && leafIdx < total * LEAF_PER; k++) {
        const ang = rnd(0, Math.PI * 2);
        const r = rnd(0.05, spread);
        dummy.position.set(
          tx + Math.cos(ang) * r,
          ty + rnd(-0.16, 0.2),
          tz + Math.sin(ang) * r
        );
        /* 竹叶是「披针形」，叶尖下垂、叶面接近水平向外挑 */
        dummy.rotation.set(rnd(-0.55, -0.15), ang + rnd(-0.5, 0.5), rnd(-0.5, 0.5), 'YXZ');
        dummy.scale.set(rnd(0.9, 1.4), rnd(0.9, 1.2), 1);
        dummy.updateMatrix();
        leaves.setMatrixAt(leafIdx, dummy.matrix);
        const lc = rand();
        col.set(lc < 0.34 ? BMC.leafA : lc < 0.62 ? BMC.leafB : lc < 0.82 ? BMC.leafC
          : lc < 0.94 ? BMC.leafD : BMC.leafDry);
        leaves.setColorAt(leafIdx, col);
        leafIdx++;
      }
    }
  }

  culms.count = total;
  nodes.count = nodeIdx;
  branches.count = branchIdx;
  leaves.count = leafIdx;
  culms.instanceMatrix.needsUpdate = true;
  nodes.instanceMatrix.needsUpdate = true;
  branches.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (culms.instanceColor) culms.instanceColor.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

  worldGroups.add(culms);
  worldGroups.add(nodes);
  worldGroups.add(branches);
  worldGroups.add(leaves);

  /* 竹梢轻晃：整片一起摆（按山脊距离给相位，形成波动的感觉） */
  bambooSway.push(culms, nodes, branches, leaves);
  for (const m of bambooSway) {
    m.userData.swayPhase = rnd(0, 6.28);
  }
}

/* ---------- 山上的伐竹点：让「纸从山上来」有个起点 ---------- */
{
  /* 选一处半坡的开阔地 */
  const px = 6.4, pz = -8.2;
  const py = hillY(px, pz);

  /* 清出的一小片空地 */
  for (let i = 0; i < 16; i++) {
    const x = px + rnd(-2.2, 2.2), z = pz + rnd(-1.4, 1.4);
    P.box0(rnd(0.5, 1.1), 0.05, rnd(0.5, 1.1), 0x9c8a63, x, hillY(x, z) + 0.02, z, { jitter: true, ry: rnd(0, 1.5) });
  }

  /* 齐刷刷的竹桩：砍过的痕迹 */
  for (let i = 0; i < 12; i++) {
    const x = px + rnd(-2.4, 2.4), z = pz + rnd(-1.6, 1.6);
    const h = hillY(x, z);
    P.cyl(0.075, 0.085, rnd(0.18, 0.34), BMC.node, x, h + 0.1, z, { jitter: true, rz: rnd(-0.06, 0.06) }, 6);
  }

  /* 砍倒的毛竹：横在地上还没去枝 */
  for (let i = 0; i < 4; i++) {
    const x = px + rnd(-1.8, 1.8), z = pz + rnd(-1.0, 1.0);
    const y = hillY(x, z);
    const a = rnd(0, Math.PI);
    const len = rnd(4.2, 6.0);
    const ax = Math.cos(a), az = Math.sin(a);
    /* 竹身分几段摆，跟着坡面走，避免长杆穿进山里 */
    const segs = 5;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const mx = x + ax * len * (t0 + t1) / 2;
      const mz = z + az * len * (t0 + t1) / 2;
      P.cyl(0.062, 0.062, (len / segs) * 1.06, BMC.culm, mx, hillY(mx, mz) + 0.09, mz,
        { jitter: false, rz: Math.PI / 2, ry: -a }, 6);
    }
    /* 留着的枝叶 */
    for (let k = 0; k < 4; k++) {
      const t = rnd(0.55, 1.0);
      const lx = x + ax * len * t, lz = z + az * len * t;
      P.sph(rnd(0.16, 0.26), pick([BMC.leafA, BMC.leafB]),
        lx + rnd(-0.3, 0.3), hillY(lx, lz) + rnd(0.12, 0.3), lz + rnd(-0.3, 0.3),
        { sy: 0.5, jitter: true }, 7, 4);
    }
  }

  /* 捆好的竹料 + 扁担：等着往山下挑 */
  const bx = px - 2.6, bz = pz + 1.4;
  const by = hillY(bx, bz);
  for (let k = 0; k < 6; k++) {
    P.cyl(0.055, 0.055, 3.4, k % 2 ? BMC.culmAlt : BMC.culm, bx + rnd(-0.16, 0.16), by + 0.12 + k * 0.11, bz + rnd(-0.12, 0.12),
      { jitter: false, rz: Math.PI / 2, ry: rnd(-0.12, 0.12) }, 6);
  }
  /* 捆绳 */
  for (const t of [-0.9, 0.9]) {
    P.cyl(0.36, 0.36, 0.08, 0xc9b48a, bx + t, by + 0.42, bz, { jitter: false, rz: Math.PI / 2, ry: 0.02 }, 8);
  }
  /* 扁担 */
  P.cyl(0.035, 0.035, 2.6, 0x8a6a44, bx + 0.2, by + 0.62, bz - 0.9, { jitter: false, rz: Math.PI / 2, ry: 0.5 }, 6);
}
/* ---------- 17 · 本场招牌图集 ----------
 * 共用的 10-kit ATLAS 是四场共享的固定内容（茶楼／剪纸坊…都是庙会老街的行当），
 * 这里不能往里加纸坊的牌子，否则会污染其它场景。
 * 所以本场自带一小块图集，做法与 10-kit 完全一致：一块 canvas 画完所有文字，一次绘制。
 */

/* ---------- 本场配色 ----------
 * 放在这一层，因为柱式与招牌都要用它；40-workshop 不再重复定义。
 */
const SHC = {
  wood: 0x7a5236,
  woodDark: 0x4a3227,
  woodLight: 0xa87a4e,
  plaster: 0xf0e8d6,
  plasterDeep: 0xd9cdb6,
  tile: 0x596372,
  tileEdge: 0x7e8a9c,
  ridge: 0x48505f,
  stone: 0xa9a08f,
  stoneDark: 0x8c8474,
  paper: 0xf4e8cf,
  paperWarm: 0xffe0a8,
  paperBright: 0xfdf6e4,
  water: 0x4585a8,
  waterDeep: 0x2a5f7c,
  pulp: 0xd8cfae,
  clay: 0x9c6a45,
  iron: 0x4a4a4c,
  ember: 0xd9762e,
};

/* ---------- 屋面瓦垄贴图 ----------
 * 初版屋面是一整片纯色（只有 tile/tileEdge 两块色），近看就是一块灰板，
 * 没有「一垄一垄」的瓦感。这里按 miaohui 的做法现画一张可平铺的瓦垄贴图：
 * 竖向瓦垄（每垄中间亮、两侧暗，做出圆弧受光）+ 横向搭接缝。
 */
const ROOF_TEX = (() => {
  const W = 256, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#4b5c54';
  g.fillRect(0, 0, W, H);
  const cols = 8;
  for (let i = 0; i < cols; i++) {
    const x = i * (W / cols);
    const grd = g.createLinearGradient(x, 0, x + W / cols, 0);
    grd.addColorStop(0, '#38473f');
    grd.addColorStop(0.42, '#6f8377');
    grd.addColorStop(1, '#2f3d37');
    g.fillStyle = grd;
    g.fillRect(x, 0, W / cols, H);
  }
  /* 横向搭接缝 */
  g.strokeStyle = 'rgba(18,24,22,.3)';
  g.lineWidth = 2;
  for (let y = 0; y <= H; y += H / 7) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
})();

/* 屋面材质：瓦垄贴图按屋面尺寸重复，做出「一垄一垄」的瓦感。
   要带 assemble 变形，否则入场时屋面不会跟着「从地面长出来」。 */
function roofMaterial(xw, depth) {
  const t = ROOF_TEX.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(Math.max(1, xw / 2.4), Math.max(1, depth / 2.4));
  t.colorSpace = THREE.SRGBColorSpace;
  return withAssemble(new THREE.MeshToonMaterial({ map: t, gradientMap: gradientTexture() }));
}

/* 屋面几何：带瓦垄贴图的曲面（UV 沿屋脊/坡向铺，贴图重复由材质控制） */
function roofGeoTextured(xw, halfD, rise, segs = 7, pow = 1.25) {
  const pos = [], uv = [];
  const quad = (a, b, c, d, u0, u1, v0, v1) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0);
  };
  const pt = (x, z) => {
    const t = Math.min(Math.abs(z) / halfD, 1);
    return [x, rise * (1 - Math.pow(t, pow)), z];
  };
  for (let i = 0; i < segs; i++) {
    const z0 = -halfD + (2 * halfD * i) / segs;
    const z1 = -halfD + (2 * halfD * (i + 1)) / segs;
    const l0 = pt(-xw / 2, z0), r0 = pt(xw / 2, z0);
    const l1 = pt(-xw / 2, z1), r1 = pt(xw / 2, z1);
    const v0 = i / segs, v1 = (i + 1) / segs;
    quad(l0, l1, r1, r0, 0, 1, v0, v1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/* 墙面抹灰接缝：把一整片纯色墙打散。
   初版灶房与纸仓的墙就是一整块 plaster 色，近看像一张纸 —— 加几道横竖缝就活了。 */
function plasterSeams(x, y0, z, w, h, o = {}) {
  const rows = o.rows || 4;
  const cols = o.cols || 0;
  const c = o.color || SHC.plasterDeep;
  const ry = o.ry || 0;
  const cos = Math.cos(ry), sin = Math.sin(ry);
  /* 横向缝 */
  for (let i = 1; i < rows; i++) {
    const yy = y0 + (h * i) / rows;
    const a = 0.02 + rand() * 0.015;                 // 略有高低差，别像印刷线
    P.box(w - 0.16, a, 0.028, c, x, yy, z + 0.006, { jitter: false, bucket: 'fine' });
  }
  /* 竖向缝（可选）：砌块的分格 */
  for (let i = 1; i <= cols; i++) {
    const t = i / cols;
    const dx = (t - 0.5) * (w - 0.3);
    const off = (rand() - 0.5) * 0.12;
    P.box(0.024, h - 0.2, 0.028, c,
      x + dx * cos - off * sin, y0 + h * 0.5, z + 0.006 + dx * sin + off * cos,
      { jitter: false, bucket: 'fine', ry });
  }
  /* 墙脚的返潮色带：墙根最容易脏，一条深色收边 */
  P.box(w - 0.1, 0.22, 0.03, o.dampColor || 0xb9ac95, x, y0 + 0.11, z + 0.008, { jitter: false, bucket: 'fine', ry });
}

const ZATLAS = (() => {
  const W = 512, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rects = {};
  const KAI = '"STKaiti","KaiTi","Kaiti SC","SimSun","Microsoft YaHei",serif';
  let cursorY = 0;

  function alloc(name, w, h) {
    const r = [0, cursorY, w, h];
    cursorY += h + 4;
    if (cursorY > H) console.warn('[zhuzhi] 招牌图块超出画布：' + name);
    rects[name] = [0, 1 - (r[1] + h) / H, 1, 1 - r[1] / H];
    return r;
  }
  /* 横匾：黑漆金字，照 10-kit 的 plaque 口径 */
  function plaque(name, text) {
    const w = W, h = 92;
    alloc(name, w, h);
    g.save();
    g.fillStyle = '#2b1e17'; g.fillRect(0, cursorY - h - 4, w, h);
    g.translate(0, cursorY - h - 4);
    g.strokeStyle = '#c8a75e'; g.lineWidth = 3;
    g.strokeRect(8, 8, w - 16, h - 16);
    const t = text.replace(/\s+/g, '');
    const size = t.length >= 5 ? 40 : t.length >= 4 ? 46 : 52;
    g.font = `${size}px ${KAI}`;
    g.fillStyle = '#e8c987';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...t];
    const gap = 8;
    const total = chars.length * (size + gap) - gap;
    let cx = w / 2 - total / 2 + size / 2;
    for (const ch of chars) { g.fillText(ch, cx, h / 2 + 2); cx += size + gap; }
    g.restore();
  }
  /* 竖招牌：红底金字，挂在门侧 */
  function banner(name, text, sub) {
    const w = 96, h = 240;
    alloc(name, w, h);
    const y0 = cursorY - h - 4;
    g.save();
    g.translate(0, y0);
    g.fillStyle = '#f2e4c6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c23a2c'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 22, w, 22);
    g.strokeStyle = '#b8332a'; g.lineWidth = 3;
    g.strokeRect(6, 20, w - 12, h - 48);
    g.font = `40px ${KAI}`;
    g.fillStyle = '#a52c22';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...text.replace(/\s+/g, '')];
    let cy = 52;
    for (const ch of chars) { g.fillText(ch, w / 2, cy); cy += 48; }
    if (sub) {
      g.font = `13px ${KAI}`; g.fillStyle = '#8a5a3c';
      g.fillText(sub, w / 2, h - 34);
    }
    g.restore();
  }

  plaque('zVat', '抄 纸 间');
  plaque('zMill', '水 碓 房');
  plaque('zStove', '煮 料 灶');
  plaque('zBarn', '纸 仓');
  plaque('zWall', '晒 纸');
  plaque('zPool', '沤 料 池');
  banner('zShrine', '蔡伦', '纸神');

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, rects };
})();

/* 本场招牌专用材质：与 10-kit 的 signMat 同构，但贴自己的图集 */
const zSignMat = withAssemble(new THREE.MeshBasicMaterial({
  map: ZATLAS.tex, vertexColors: true, toneMapped: false, fog: true,
}));

/* 挂一块横匾：w/h 是要显示的实际尺寸 */
function plaqueAt(name, w, h, x, y, z, o = {}) {
  addGeo(new THREE.PlaneGeometry(w, h), 0xffffff, {
    ...o, x, y, z, bucket: 'zsign', uvRect: ZATLAS.rects[name], jitter: false,
  });
}
/* 挂一块竖招 */
function bannerAt(name, w, h, x, y, z, o = {}) {
  addGeo(new THREE.PlaneGeometry(w, h), 0xffffff, {
    ...o, x, y, z, bucket: 'zsign', uvRect: ZATLAS.rects[name], jitter: false,
  });
}

/* ---------- 会动的零件：按材质合并成「一个」mesh ----------
 * 直接 new THREE.Mesh 建会动的部件时，每个 Mesh 都是一次 draw call：
 * 初版水轮 23 个零件 + 3 副碓杆 + 2 个匠人，把 draw call 从 12 顶到了 96。
 * 这里把一组几何先烘进同一份 BufferGeometry，再合成一个 Mesh——一个部件一次绘制。
 */
function mergeGeos(list) {
  const pos = [], nor = [];
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const { geo, m } of list) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i], pa[i + 1], pa[i + 2]);
      nor.push(na[i], na[i + 1], na[i + 2]);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

/* 把一组「几何 + 变换」合成一个会动的网格 */
function movingPart(list, group) {
  const geo = mergeGeos(list);
  const mesh = new THREE.Mesh(geo, toonMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depthMat;
  mesh.frustumCulled = false;
  (group || worldGroups).add(mesh);
  return mesh;
}

/* ---------- 木柱 ----------
 * 初版柱子就是一根光溜溜的圆柱（P.cyl0 一根了事），近看太简陋。
 * 这里按中式木构的层次补齐五段，成本很低但观感完全不同：
 *   柱础（石）→ 柱脚收分 → 柱身（上细下粗，微微收分）→ 柱箍 → 柱头雀替
 * o.capital 可关掉柱头（棚屋的次要柱用），o.stone 换柱础材质。
 */
function post(x, y0, z, h, o = {}) {
  const r = o.r || 0.155;
  const c = o.color || SHC.wood;
  const cDark = o.colorDark || SHC.woodDark;
  const stoneC = o.stone || SHC.stoneDark;
  const seg = o.seg || 10;

  /* 1 · 柱础：方形础石 + 一层小圆盘，柱子「坐」在石头上 */
  const bw = r * 2 + 0.2;
  P.box0(bw, 0.16, bw, stoneC, x, y0, z, { jitter: false });
  P.cyl0(r * 1.5, r * 1.7, 0.1, o.stoneTop || SHC.stone, x, y0 + 0.16, z, { jitter: false }, seg);

  /* 2 · 柱身：上细下粗，带收分（中式柱子不是直筒） */
  const shaftY = y0 + 0.26;
  const shaftH = h - 0.26 - (o.capital === false ? 0.14 : 0.34);
  P.cyl0(r * 0.86, r * 1.06, shaftH, c, x, shaftY, z, { jitter: false }, seg);

  /* 3 · 柱箍：上下各一道铁箍，木柱才像「构件」而不像一根棍 */
  P.cyl0(r * 0.9, r * 0.9, 0.055, cDark, x, shaftY + shaftH * 0.16, z, { jitter: false }, seg);
  P.cyl0(r * 0.86, r * 0.86, 0.055, cDark, x, shaftY + shaftH * 0.74, z, { jitter: false }, seg);

  /* 4 · 柱头：柱头盘 + 两侧雀替（托住上面的檐枋） */
  if (o.capital !== false) {
    const capY = shaftY + shaftH;
    P.cyl0(r * 1.2, r * 1.0, 0.12, cDark, x, capY, z, { jitter: false }, seg);
    for (const s of [-1, 1]) {
      P.box(0.3, 0.24, 0.09, cDark, x + s * (r + 0.16), capY - 0.1, z, { rz: s * 0.46, jitter: false });
    }
  }
  return shaftY + shaftH;
}
/* ---------- 40 · 纸坊工位 ----------
 * 由西向东：沤料池 → 煮料灶房 → 水碓房 → 抄纸间（主戏）→ 晾纸墙（最高）→ 纸仓，
 * 另加一座祭祀蔡伦的小神龛。全部落在台地上，靠山一侧让开挡土石坎。
 * 配色 SHC 定义在 17-signs.js（柱式与招牌都要用）。
 */

/* 悬山顶瓦屋面：两坡 + 檐板 + 瓦当 + 正脊。
   照 shexi/scene/30-shop.js 的 curvedSlopeGeo 思路，但本场自包含，不改共享工具层。 */
function roofGeo(xw, halfD, rise, o = {}) {
  const pow = o.pow || 1.25, segs = o.segs || 7;
  const pos = [];
  const quad = (a, b, c, d) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const pt = (x, z) => {
    const t = Math.min(Math.abs(z) / halfD, 1);
    return [x, rise * (1 - Math.pow(t, pow)), z];
  };
  for (let i = 0; i < segs; i++) {
    const z0 = -halfD + (2 * halfD * i) / segs;
    const z1 = -halfD + (2 * halfD * (i + 1)) / segs;
    const l0 = pt(-xw / 2, z0), r0 = pt(xw / 2, z0);
    const l1 = pt(-xw / 2, z1), r1 = pt(xw / 2, z1);
    quad(l0, l1, r1, r0);                                  // 上表面
    quad([l0[0], l0[1] - 0.14, l0[2]], [r0[0], r0[1] - 0.14, r0[2]],
         [r1[0], r1[1] - 0.14, r1[2]], [l1[0], l1[1] - 0.14, l1[2]]);  // 下表面（有厚度）
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
function tileRoof(cx, xw, zf, zb, yEave, rise, o = {}) {
  const zc = (zf + zb) / 2;
  const half = Math.abs(zf - zc);
  const pow = o.pow || 1.25, segs = o.segs || 7;

  /* 前后两坡：带瓦垄贴图的曲面。贴图要求 UV，所以材质与几何都单独建，
     再包成一个 Mesh 挂上去（屋面本来就不是合批对象，一个屋面一次绘制）。 */
  for (const sgn of [1, -1]) {
    const geo = roofGeoTextured(xw, half, rise, segs, pow);
    const mat = roofMaterial(xw, half * 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx + OX, yEave, zc);
    mesh.rotation.y = sgn > 0 ? 0 : Math.PI;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = depthMat;
    worldGroups.add(mesh);
    /* 下表面（屋面有厚度），单独一片平几何，走合批 */
    addGeo(roofGeo(xw, half, rise * 0.96, { ...o, segs }), SHC.ridge,
      { x: cx, y: yEave - 0.13, z: zc, ...(sgn > 0 ? {} : { ry: Math.PI }), jitter: false });
  }

  /* 檐板与瓦当、滴水：沿檐口排一圈圆瓦头 + 舌形滴水，
     压住屋面的「纸片感」——这是屋面最关键的一排细节 */
  for (const [zE, sgn] of [[zf, 1], [zb, -1]]) {
    P.box(xw + 0.08, 0.16, 0.14, SHC.woodDark, cx, yEave - 0.06, zE, { jitter: false });
    const n = Math.max(6, Math.floor(xw / 0.26));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const px = cx + (u - 0.5) * xw;
      /* 翼角随檩抬起 */
      const tx = Math.abs((u - 0.5) * 2);
      const lift = (o.corner === false ? 0 : rise * 0.5 * Math.pow(tx, 2.6));
      /* 瓦当：圆瓦头，横放，压在檐口上 */
      P.cyl(0.06, 0.06, 0.07, SHC.tileEdge, px, yEave + lift - 0.01, zE + sgn * 0.07,
        { rx: Math.PI / 2, jitter: false }, 7);
      /* 滴水：瓦当下面一小块垂下来的舌片 */
      P.box(0.11, 0.1, 0.05, SHC.ridge, px, yEave + lift - 0.14, zE + sgn * 0.1, { jitter: false });
    }
  }

  /* 正脊与脊头 */
  P.box(xw + 0.14, 0.22, 0.32, SHC.ridge, cx, yEave + rise + 0.05, zc, { jitter: false });
  /* 正脊上的脊瓦：一小排竖着排的瓦，脊才不像一根方木 */
  for (let x = cx - xw / 2 + 0.16; x < cx + xw / 2; x += 0.3) {
    P.cyl(0.055, 0.055, 0.14, SHC.tileEdge, x, yEave + rise + 0.2, zc, { jitter: false }, 6);
  }
  for (const s of [-1, 1]) {
    P.box(0.16, 0.42, 0.3, SHC.ridge, cx + s * (xw / 2), yEave + rise + 0.18, zc, { rz: s * 0.32, jitter: false });
  }
  /* 翼角起翘 */
  if (o.corner !== false) {
    for (const sx of [-1, 1]) {
      for (const [zE, sz] of [[zf, -1], [zb, 1]]) {
        P.box(0.6, 0.11, 0.3, SHC.tileEdge, cx + sx * (xw / 2 - 0.08), yEave + 0.04, zE + sz * 0.1, { rz: sx * 0.3, jitter: false });
      }
    }
  }
}

/* 木构开敞棚屋：柱 + 梁 + 檩，四面透风（水碓房、抄纸间用） */
function openShed(cx, cz, xw, zd, y0, hEave, o = {}) {
  const colH = hEave;
  const xs = [-xw / 2 + 0.22, xw / 2 - 0.22];
  const zs = [-zd / 2 + 0.22, zd / 2 - 0.22];
  /* 台基 */
  P.box0(xw + 0.4, 0.26, zd + 0.4, SHC.stone, cx, y0, cz, { jitter: false });
  for (const sx of xs) {
    for (const sz of zs) {
      post(cx + sx, y0 + 0.26, cz + sz, colH, { r: 0.15, seg: 10 });
    }
  }
  /* 檐枋（前后两根） */
  for (const sz of zs) {
    P.box(xw - 0.3, 0.2, 0.16, SHC.woodDark, cx, y0 + 0.26 + colH, cz + sz, { jitter: false });
  }
  /* 檩条 */
  for (const sz of zs) {
    P.cyl(0.09, 0.09, xw - 0.2, SHC.woodLight, cx, y0 + 0.26 + colH + 0.2, cz + sz, { rz: Math.PI / 2, jitter: false }, 6);
  }
  const yEave = y0 + 0.26 + colH + 0.28;
  tileRoof(cx, xw + 0.5, cz + zd / 2 + 0.45, cz - zd / 2 - 0.45, yEave, o.rise || 0.85, o);
  return yEave;
}

/* ================= 沤料池 ================= */
{
  const x = ZA.poolX, z = -1.2;
  const w = 4.6, d = 3.2;
  /* 池体：石块砌边，池底下去一截 */
  const y = ZA.terraceY;
  P.box0(w, 0.06, d, SHC.waterDeep, x, y - 0.34, z, { jitter: false });
  /* 池壁四面 */
  for (const [dx, dz, bw, bd] of [[0, -d / 2, w + 0.3, 0.26], [0, d / 2, w + 0.3, 0.26], [-w / 2, 0, 0.26, d], [w / 2, 0, 0.26, d]]) {
    P.box0(bw, 0.48, bd, SHC.stone, x + dx, y - 0.42, z + dz, { jitter: false });
  }
  /* 池水：浅黄（泡着嫩竹） */
  P.box0(w - 0.5, 0.04, d - 0.5, 0xcbbd8e, x, y - 0.5, z, { jitter: false, bucket: 'fine' });
  /* 泡着的嫩竹段：截断的短筒，压着石块 */
  for (let i = 0; i < 26; i++) {
    const px = x + rnd(-w / 2 + 0.5, w / 2 - 0.5);
    const pz = z + rnd(-d / 2 + 0.5, d / 2 - 0.5);
    P.cyl(rnd(0.09, 0.13), rnd(0.09, 0.13), rnd(1.0, 2.0), rand() < 0.5 ? PAL.bamboo : PAL.bambooDark,
      px, y - 0.44, pz, { rx: Math.PI / 2, ry: rnd(0, 3.14), jitter: true }, 6);
  }
  /* 压石 */
  for (let i = 0; i < 7; i++) {
    P.sph(rnd(0.16, 0.3), pick([SHC.stone, SHC.stoneDark]), x + rnd(-w / 2 + 0.6, w / 2 - 0.6), y - 0.34, z + rnd(-d / 2 + 0.6, d / 2 - 0.6),
      { sy: 0.6, jitter: true }, 8, 5);
  }
  /* 池边的竹料堆 */
  for (let i = 0; i < 14; i++) {
    P.cyl(0.1, 0.1, rnd(1.6, 2.6), rand() < 0.5 ? PAL.bamboo : PAL.bambooDark,
      x + rnd(-w / 2 - 1.2, w / 2 + 1.2), ZA.terraceY + 0.1 + Math.floor(i / 5) * 0.2, z + d / 2 + rnd(0.6, 1.6),
      { rz: Math.PI / 2, ry: rnd(-0.2, 0.2), jitter: true }, 6);
  }
  bannerAt('zPool', 0.62, 1.55, x - w / 2 - 0.5, ZA.terraceY + 2.4, z, { ry: 0 });
  /* 幌杆 */
  P.cyl(0.05, 0.06, 3.2, SHC.woodDark, x - w / 2 - 0.5, ZA.terraceY + 1.6, z - 0.34, { jitter: false }, 6);
}

/* ================= 煮料灶房 ================= */
{
  const x = ZA.stoveX, z = -1.4;
  const w = 5.0, d = 4.0;
  const y0 = ZA.terraceY;
  /* 三面土墙、正面敞开 */
  P.box0(w, 0.3, d, SHC.stone, x, y0, z, { jitter: false });
  P.box0(w, 2.4, 0.28, SHC.plaster, x, y0 + 0.3, z - d / 2, { jitter: false });
  P.box0(0.28, 2.4, d, SHC.plaster, x - w / 2, y0 + 0.3, z, { jitter: false });
  P.box0(0.28, 2.4, d, SHC.plaster, x + w / 2, y0 + 0.3, z, { jitter: false });
  /* 墙面抹灰接缝（后墙朝南这面 + 两山墙朝外那面） */
  plasterSeams(x, y0 + 0.3, z - d / 2 + 0.15, w, 2.4, { rows: 4, cols: 5 });
  plasterSeams(x - w / 2 - 0.15, y0 + 0.3, z, d, 2.4, { rows: 4, cols: 4, ry: Math.PI / 2 });
  plasterSeams(x + w / 2 + 0.15, y0 + 0.3, z, d, 2.4, { rows: 4, cols: 4, ry: Math.PI / 2 });
  /* 正面两根檐柱：土墙房也要有柱子挑住檐口 */
  for (const sx of [-w / 2 + 0.3, w / 2 - 0.3]) {
    post(x + sx, y0 + 0.3, z + d / 2 - 0.25, 2.6, { r: 0.14, seg: 9 });
  }
  P.box(w - 0.4, 0.18, 0.15, SHC.woodDark, x, y0 + 2.62, z + d / 2 - 0.25, { jitter: false });
  tileRoof(x, w + 0.7, z + d / 2 + 0.45, z - d / 2 - 0.45, y0 + 2.9, 0.95);

  /* 灶台：一座大灶，上坐木甑（楻桶） */
  P.box0(2.5, 0.9, 1.7, SHC.clay, x, y0 + 0.3, z - 0.5, { jitter: false });
  P.cyl0(0.72, 0.8, 1.35, PAL.wood, x, y0 + 1.2, z - 0.5, { jitter: false }, 12);
  /* 甑箍 */
  for (const yy of [0.35, 0.95]) {
    P.torus(0.78, 0.045, SHC.iron, x, y0 + 1.2 + yy, z - 0.5, { rx: Math.PI / 2, jitter: false }, 6, 16);
  }
  /* 灶膛口与火光 */
  P.box0(1.0, 0.5, 0.12, 0x2a1a12, x, y0 + 0.34, z + 0.36, { jitter: false });
  P.box(0.78, 0.34, 0.06, SHC.ember, x, y0 + 0.6, z + 0.4, { jitter: false, bucket: 'glow' });
  /* 柴垛 */
  for (let i = 0; i < 22; i++) {
    const lx = x - 2.6 + rnd(-0.6, 0.6);
    const lz = z + rnd(-1.0, 1.0);
    P.cyl(0.07, 0.07, rnd(1.0, 1.7), rand() < 0.5 ? SHC.wood : SHC.woodDark,
      lx, y0 + 0.14 + Math.floor(i / 6) * 0.15, lz, { rz: Math.PI / 2, ry: rnd(-0.15, 0.15), jitter: true }, 6);
  }
  /* 石灰堆 */
  for (let i = 0; i < 9; i++) {
    P.sph(rnd(0.24, 0.4), 0xd8d4c8, x + 2.4 + rnd(-0.5, 0.5), y0 + rnd(0.16, 0.5), z + rnd(-0.5, 0.5), { sy: 0.75, jitter: true }, 8, 5);
  }
  plaqueAt('zStove', 2.3, 0.66, x, y0 + 2.5, z + d / 2 + 0.32);
}

/* ================= 水碓房（含引水渠、卧轮与碓杆） =================
 * 传动关系必须交代清楚，否则就是「一个轮子」和「几根杆」各摆各的：
 *   水渠里的卧轮 → 同轴的**拨木（凸榫）** → 拨动碓杆尾端 → 碓杆绕**支点柱**起落 → 碓头砸进石臼
 * 所以这一组要凑齐五件：卧轮、贯穿两处的**传动轴**、轴上的拨木、碓杆的**支点柱**、石臼。
 */
const millParts = { wheel: null, hammers: [] };
{
  const x = ZA.millX, z = -1.6;
  const w = 4.4, d = 4.4;
  const y0 = ZA.terraceY;

  /* 引水渠：从溪上游分出一支，穿过碓房，再回到溪里 */
  const chW = 1.1, chY = y0 - 0.42;
  P.box0(w + 3.6, 0.16, chW + 0.5, SHC.stoneDark, x - 0.6, chY - 0.2, z + 2.0, { jitter: false });
  P.box0(w + 3.6, 0.06, chW, SHC.water, x - 0.6, chY, z + 2.0, { jitter: false, bucket: 'fine' });
  for (const s of [-1, 1]) {
    P.box0(w + 3.6, 0.42, 0.22, SHC.stone, x - 0.6, chY - 0.16, z + 2.0 + s * (chW / 2 + 0.11), { jitter: false });
  }
  P.box0(0.16, 1.1, 1.5, SHC.woodDark, x - 2.6, y0 - 0.3, z + 2.0, { jitter: false });

  /* 碓房本体：开敞木棚 */
  const yEave = openShed(x, z + 0.4, w, d, y0, 2.9, { rise: 0.8 });

  /* 传动轴：一根横贯碓房的长轴，穿过水渠里的卧轮，一直伸到棚内的碓杆上方。
     这根轴是「轮」与「杆」之间的唯一联系，初版缺了它，两者看着毫不相干。 */
  const axleY = chY + 0.62;
  const axleZ = z + 2.0;                    // 与水渠、卧轮同一条线
  const axleX0 = x - 2.4, axleX1 = x + 1.9;
  const axleLen = axleX1 - axleX0;
  const axleMidX = (axleX0 + axleX1) / 2;
  P.cyl(0.072, 0.072, axleLen, SHC.woodDark, axleMidX, axleY, axleZ, { rz: Math.PI / 2, jitter: false }, 8);
  /* 轴承座：轴的两端各一块立柱托着（轴不是悬空的） */
  for (const s of [axleX0 + 0.1, axleX1 - 0.1]) {
    P.box0(0.22, axleY - y0, 0.22, SHC.wood, s, y0 + 0.3, axleZ, { jitter: false });
    P.cyl0(0.1, 0.1, 0.1, SHC.iron, s, axleY - 0.05, axleZ, { jitter: false }, 8);
  }

  /* 卧轮：立在水渠里的木轮，水推着转（会动） */
  {
    const rx = x - 1.5, R = 0.92;
    const parts = [];
    const M = () => new THREE.Matrix4();
    /* 轮辋（两圈） */
    for (const s of [-1, 1]) {
      parts.push({ geo: new THREE.TorusGeometry(R, 0.055, 6, 20), m: M().makeTranslation(0, 0, s * 0.22) });
    }
    /* 辐条 */
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push({ geo: new THREE.BoxGeometry(R * 1.9, 0.06, 0.06), m: M().makeRotationZ(a) });
    }
    /* 叶片 */
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = M().makeRotationZ(a);
      m.setPosition(Math.cos(a) * R, Math.sin(a) * R, 0);
      parts.push({ geo: new THREE.BoxGeometry(0.08, 0.3, 0.5), m });
    }
    /* 轮毂 */
    parts.push({ geo: new THREE.CylinderGeometry(0.14, 0.14, 0.62, 8), m: M().makeRotationX(Math.PI / 2) });
    const g = new THREE.Group();
    g.position.set(rx, axleY, axleZ);
    worldGroups.add(g);
    movingPart(parts, g);
    millParts.wheel = g;
    /* 轮子轴承座（两边的立柱） */
    for (const s of [-1, 1]) {
      P.box0(0.2, axleY - y0, 0.2, SHC.wood, rx + s * 0.5, y0 + 0.3, axleZ, { jitter: false });
    }
  }

  /* 碓杆组：三副，支点柱 + 碓杆 + 碓头，全都绕支点起落 */
  const hammerY = y0 + 1.02;                // 碓杆的支点高度
  for (let i = 0; i < 3; i++) {
    const hx = x - 0.5 + i * 0.95;
    const hz = z - 0.6;

    /* 石臼（静态） */
    P.cyl0(0.3, 0.36, 0.42, SHC.stoneDark, hx, y0 + 0.26, hz, { jitter: false }, 10);
    P.cyl0(0.2, 0.2, 0.12, 0x6b6355, hx, y0 + 0.62, hz, { jitter: false }, 10);

    /* 支点柱：从台地一直顶到碓杆的支点（静态，是碓杆的着力处） */
    P.box0(0.18, hammerY - y0 - 0.16, 0.18, SHC.woodDark, hx - 0.42, y0 + 0.3, hz, { jitter: false });
    P.box0(0.42, 0.14, 0.26, SHC.woodDark, hx - 0.42, hammerY - 0.09, hz, { jitter: false });
    /* 支点轴 */
    P.cyl(0.05, 0.05, 0.34, SHC.iron, hx - 0.42, hammerY + 0.04, hz, { rx: Math.PI / 2, jitter: false }, 8);

    /* 碓杆（会动）：绕 (hx-0.42, hammerY) 这个支点摆动。
       杆身从支点往西伸到碓头、往东伸到被拨木拨动的那一头。 */
    const M = () => new THREE.Matrix4();
    const parts = [
      /* 杆身：以支点为原点，往两边伸 */
      { geo: new THREE.BoxGeometry(2.5, 0.14, 0.17), m: M().makeTranslation(0.25, 0, 0) },
      /* 碓头：杆西端往下装的石质锤头，正对石臼 */
      { geo: new THREE.CylinderGeometry(0.14, 0.16, 0.52, 8), m: M().makeTranslation(1.04, -0.3, 0) },
      { geo: new THREE.CylinderGeometry(0.17, 0.17, 0.1, 8), m: M().makeTranslation(1.04, -0.58, 0) },
      /* 尾端受拨的横档：拨木打在这上面，杆才被压下去 */
      { geo: new THREE.BoxGeometry(0.16, 0.3, 0.3), m: M().makeTranslation(-1.0, -0.1, 0) },
    ];
    const g = new THREE.Group();
    g.position.set(hx - 0.42, hammerY, hz);
    worldGroups.add(g);
    movingPart(parts, g);
    millParts.hammers.push({ g, phase: i * 0.9, baseX: hx - 0.42 });

    /* 拨木：装在传动轴上、正对这根碓杆尾端的凸榫（会动，随轴转） */
    const pinX = hx - 1.42;                  // 与碓杆尾端的横档对齐
    if (pinX > axleX0 && pinX < axleX1) {
      const pin = new THREE.Group();
      const pparts = [];
      const PM = () => new THREE.Matrix4();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const m = PM().makeRotationX(a);
        m.setPosition(0, Math.cos(a) * 0.32, Math.sin(a) * 0.32);
        pparts.push({ geo: new THREE.BoxGeometry(0.1, 0.26, 0.1), m });
      }
      const hub = new THREE.Group();
      hub.position.set(pinX, axleY, axleZ);
      worldGroups.add(hub);
      movingPart(pparts, hub);
      millParts.pins = millParts.pins || [];
      millParts.pins.push({ g: hub, phase: i * 0.9 });
    }
  }

  /* 棚内的竹浆：锤成絮状泡在水里 */
  for (let i = 0; i < 10; i++) {
    P.sph(rnd(0.2, 0.34), SHC.pulp, x + rnd(-1.6, 1.6), y0 + 0.38, z - rnd(0.2, 1.4), { sy: 0.5, jitter: true }, 7, 5);
  }

  plaqueAt('zMill', 2.0, 0.58, x, yEave - 0.35, z + d / 2 + 0.9);
}
/* ---------- 42 · 抄纸间、晾纸墙（视觉重心）、纸仓、蔡伦神龛 ---------- */

/* ================= 抄纸间：全场主戏 =================
 * 半敞开的高敞木构棚屋，屋里一口方正的抄纸槽盛着纸浆水，
 * 槽边立着纸帘与帘架，两三位匠人正在「荡帘打浪」——富阳独有绝艺。
 */
const vatParts = { arms: [], vats: [] };
{
  const x = ZA.vatX, z = -0.9;
  const w = 6.2, d = 5.0;
  const y0 = ZA.terraceY;

  /* 台基与三面墙：正面（朝南）敞开，方便看见里面的动作 */
  P.box0(w + 0.5, 0.3, d + 0.5, SHC.stone, x, y0, z, { jitter: false });
  P.box0(w, 2.9, 0.26, SHC.plaster, x, y0 + 0.3, z - d / 2, { jitter: false });   // 后墙
  P.box0(0.26, 2.9, d, SHC.plasterDeep, x - w / 2, y0 + 0.3, z, { jitter: false });// 西山墙
  /* 东山墙只砌一半，露出里面的槽 */
  P.box0(0.26, 2.9, d * 0.55, SHC.plasterDeep, x + w / 2, y0 + 0.3, z - d * 0.22, { jitter: false });
  /* 后墙内侧的抹灰接缝（抄纸间正面敞开，能看见后墙） */
  plasterSeams(x, y0 + 0.3, z - d / 2 + 0.14, w, 2.9, { rows: 4, cols: 6 });

  const yEave = y0 + 0.3 + 2.9 + 0.28;
  tileRoof(x, w + 0.8, z + d / 2 + 0.5, z - d / 2 - 0.5, yEave, 1.0);

  /* 前檐柱（支撑敞开的正面）——用统一的柱式：柱础 + 收分柱身 + 铁箍 + 柱头雀替 */
  for (const sx of [-w / 2 + 0.25, w / 2 - 0.25]) {
    post(x + sx, y0 + 0.3, z + d / 2 - 0.2, 2.9, { r: 0.155, seg: 10 });
  }
  P.box(w - 0.3, 0.2, 0.16, SHC.woodDark, x, yEave - 0.2, z + d / 2 - 0.2, { jitter: false });

  /* ---- 抄纸槽：方正木槽盛纸浆水，槽边立纸帘与帘架 ---- */
  for (const [vx, vz] of [[x - 1.35, z + 0.2], [x + 1.35, z + 0.2]]) {
    const vw = 1.9, vd = 1.5, vh = 0.78;
    /* 槽体：四面板 + 底 */
    P.box0(vw + 0.24, vh, vd + 0.24, SHC.woodDark, vx, y0 + 0.3, vz, { jitter: false });
    /* 掏空：内壁一圈用浅木色，做出「槽」的观感 */
    P.box0(vw, vh - 0.16, vd, SHC.woodLight, vx, y0 + 0.3 + 0.16, vz, { jitter: false });
    /* 浆水：浅乳白（纸浆悬浮） */
    P.box0(vw - 0.16, 0.03, vd - 0.16, 0xe4dcc0, vx, y0 + 0.3 + vh - 0.2, vz, { jitter: false, bucket: 'fine' });
    /* 帘架：横在两端的木架 */
    for (const s of [-1, 1]) {
      P.box(0.14, 0.5, vd + 0.3, SHC.wood, vx + s * (vw / 2 + 0.3), y0 + 0.3 + vh + 0.2, vz, { jitter: false });
    }
    /* 靠在槽边的纸帘：细密的帘面 + 两根边框 */
    P.box(vw * 0.9, 0.02, vd * 0.82, 0xe8e0c4, vx - 1.1, y0 + 0.3 + vh + 0.1, vz, { rx: -0.35, jitter: false });
    P.box(vw * 0.94, 0.05, 0.07, SHC.wood, vx - 1.1, y0 + 0.3 + vh + 0.12, vz + vd * 0.41, { rx: -0.35, jitter: false });
    vatParts.vats.push({ x: vx, z: vz });
  }

  /* 压过水的湿纸垛：一摞方方正正的纸 */
  {
    const sx = x + 2.3, sz = z + 1.3;
    P.box0(1.0, 0.55, 0.78, SHC.paper, sx, y0 + 0.3, sz, { jitter: false });
    /* 纸垛的层线 */
    for (let i = 1; i < 7; i++) {
      P.box(0.94, 0.012, 0.74, SHC.paperWarm, sx, y0 + 0.3 + i * 0.079, sz, { jitter: false, bucket: 'fine' });
    }
    /* 压在上面的木板与石块 */
    P.box0(1.15, 0.1, 0.92, SHC.wood, sx, y0 + 0.3 + 0.55, sz, { jitter: false });
    for (let i = 0; i < 3; i++) {
      P.sph(rnd(0.14, 0.2), SHC.stoneDark, sx + rnd(-0.3, 0.3), y0 + 0.3 + 0.68, sz + rnd(-0.25, 0.25), { sy: 0.6, jitter: true }, 7, 5);
    }
  }

  /* 地上的水渍、木桶 */
  for (let i = 0; i < 8; i++) {
    P.box(0.5 + rnd(0, 0.7), 0.015, 0.4 + rnd(0, 0.5), 0x8a97a0, x + rnd(-2.6, 2.6), y0 + 0.32, z + rnd(-1.6, 1.8), { jitter: false, bucket: 'fine' });
  }
  for (let i = 0; i < 4; i++) {
    const bx = x + rnd(-2.4, 2.4), bz = z + rnd(0.8, 2.0);
    P.cyl0(0.24, 0.2, 0.42, SHC.wood, bx, y0 + 0.3, bz, { jitter: false }, 10);
    P.cyl0(0.22, 0.22, 0.03, 0x6b8fa8, bx, y0 + 0.3 + 0.34, bz, { jitter: false }, 10);
  }

  plaqueAt('zVat', 2.6, 0.72, x, yEave - 0.42, z + d / 2 + 0.95);

  /* ---- 荡帘的匠人：手臂与纸帘一起一落（会动，单独成一个 mesh） ---- */
  for (let i = 0; i < 2; i++) {
    const v = vatParts.vats[i];
    const y0v = y0 + 0.3;
    const M = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
    /* 身躯与头：不动的部分 */
    const g = new THREE.Group();
    g.position.set(v.x, y0v, v.z - 1.15);
    worldGroups.add(g);
    movingPart([
      { geo: new THREE.CylinderGeometry(0.17, 0.23, 0.72, 7), m: M(0, 0.36, 0) },
      { geo: new THREE.SphereGeometry(0.13, 9, 7), m: M(0, 0.84, 0) },
    ], g);

    /* 手臂 + 纸帘：绕肩摆动，单独一个 mesh 挂在自己的 pivot 下 */
    const armPivot = new THREE.Group();
    armPivot.position.set(0, 0.66, 0);
    g.add(armPivot);
    movingPart([
      { geo: new THREE.BoxGeometry(0.1, 0.5, 0.1), m: M(0, -0.25, 0.06) },
      { geo: new THREE.BoxGeometry(0.72, 0.02, 0.6), m: M(0, -0.5, 0.42) },
    ], armPivot);

    vatParts.arms.push({ pivot: armPivot, phase: i * 1.9 });
  }
}

/* ================= 晾纸墙：视觉重心，全场最高人工物 =================
 * 已定「日光晒纸」：一整面朝南的白墙 + 草棚遮雨 + 墙脚接水木槽，
 * 墙上自上而下贴着成排湿纸，纸边被风轻轻掀起。
 */
const wallParts = { papers: [], group: null };
{
  const x = ZA.wallX, z = -1.0;
  const w = 7.4, h = 5.2;         // 比纸坊所有房子都高
  const WALL_T = 0.5;             // 墙厚
  const y0 = ZA.terraceY;
  /* 墙的南面（朝南那面，贴纸的面）：墙心在 z - WALL_T/2，所以南面在 z */
  const faceZ = z;

  /* 墙体：朝南一整面白墙（刷灰的夯墙），有厚度 */
  P.box0(w, h, WALL_T, SHC.plaster, x, y0, z - WALL_T / 2, { jitter: false });
  /* 墙顶压顶石 */
  P.box0(w + 0.3, 0.22, WALL_T + 0.22, SHC.stoneDark, x, y0 + h, z - WALL_T / 2, { jitter: false });
  /* 墙面上的横向抹灰接缝，破掉一整片死白 */
  for (let i = 1; i < 5; i++) {
    P.box(w - 0.2, 0.02, 0.03, SHC.plasterDeep, x, y0 + (h * i) / 5, faceZ + 0.008, { jitter: false, bucket: 'fine' });
  }
  /* 两侧的扶壁墙垛 */
  for (const s of [-1, 1]) {
    P.box0(WALL_T, h + 0.6, 1.5, SHC.plasterDeep, x + s * (w / 2 + 0.25), y0, z - WALL_T / 2 - 0.3, { jitter: false });
    P.box0(WALL_T + 0.14, 0.2, 1.64, SHC.stoneDark, x + s * (w / 2 + 0.25), y0 + h + 0.6, z - WALL_T / 2 - 0.3, { jitter: false });
  }

  /* 草棚遮雨：墙顶往外挑一坡 */
  {
    const dz = 1.5;
    const geo = roofGeo(w + 1.2, dz / 2, 0.55, { segs: 5 });
    addGeo(geo, 0xa8905c, { x: x, y: y0 + h + 0.75, z: z + 0.6, jitter: false });
    geo.dispose();
    /* 棚下的椽 */
    for (let i = 0; i <= 8; i++) {
      P.cyl(0.055, 0.055, 1.7, SHC.woodDark, x - w / 2 + (w * i) / 8, y0 + h + 0.78, z + 0.6, { rx: Math.PI / 2, jitter: false }, 6);
    }
    /* 支棚的斜撑 */
    for (const s of [-1, 1]) {
      P.box(0.1, 1.5, 0.1, SHC.woodDark, x + s * (w / 2 + 0.15), y0 + h + 0.05, z + 0.75, { rx: -0.5, jitter: false });
    }
  }

  /* 墙脚接水的木槽 */
  P.box0(w, 0.28, 0.5, SHC.wood, x, y0, z + 0.34, { jitter: false });
  P.box0(w - 0.2, 0.06, 0.34, SHC.water, x, y0 + 0.2, z + 0.34, { jitter: false, bucket: 'fine' });

  /* ---- 墙上成排的湿纸：自上而下贴着，纸边翘起 ----
    注意：墙面是 plaster(0xf0e8d6)，纸如果也用 paper(0xf4e8cf) 就会糊成一片看不见。
    这里把纸做成更亮的暖白，并在每张纸下压一道细影，纸才「浮」得出来。 */
  {
    const rows = 4, cols = 6;
    const paperGeo = new THREE.PlaneGeometry(1.06, 1.0);
    const paperMat = new THREE.MeshBasicMaterial({
      color: 0xfdf6e4, side: THREE.DoubleSide, toneMapped: false, fog: true,
    });
    const n = rows * cols;
    const mesh = new THREE.InstancedMesh(paperGeo, paperMat, n);
    mesh.castShadow = false;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = x - w / 2 + 0.72 + c * ((w - 1.44) / (cols - 1));
        const py = y0 + 0.62 + r * 1.16;
        dummy.position.set(px, py, faceZ + 0.035);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        /* 记下每张纸的基准位置，动效里按基准重算，不要在原矩阵上做增量（会累积漂移） */
        wallParts.papers.push({ x: px, y: py, z: faceZ + 0.035, phase: rnd(0, 6.28) });
        idx++;
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    worldGroups.add(mesh);
    wallParts.group = mesh;

    /* 每张纸下缘压一道细影，让纸从白墙上「浮」出来 */
    for (const p of wallParts.papers) {
      P.box(1.06, 0.03, 0.012, 0xbfae8c, p.x, p.y - 0.52, faceZ + 0.03, { jitter: false, bucket: 'fine' });
    }
  }

  /* 墙下备用的干纸垛与竹梯 */
  P.box0(1.3, 0.7, 0.9, SHC.paper, x - w / 2 + 1.0, y0 + 0.28, z + 1.4, { jitter: false });
  for (let i = 1; i < 8; i++) {
    P.box(1.24, 0.012, 0.86, SHC.paperWarm, x - w / 2 + 1.0, y0 + 0.28 + i * 0.087, z + 1.4, { jitter: false, bucket: 'fine' });
  }
  /* 竹梯靠在墙上 */
  for (const s of [-0.22, 0.22]) {
    P.cyl(0.045, 0.045, 3.4, PAL.bamboo, x + w / 2 - 1.1 + s, y0 + 1.6, z + 0.55, { rx: -0.16, jitter: false }, 6);
  }
  for (let i = 0; i < 8; i++) {
    P.cyl(0.035, 0.035, 0.44, PAL.bamboo, x + w / 2 - 1.1, y0 + 0.42 + i * 0.42, z + 0.55 + (i * 0.42) * 0.16, { rz: Math.PI / 2, jitter: false }, 6);
  }

  plaqueAt('zWall', 1.5, 0.5, x, y0 + h - 0.55, z + 0.28);
}

/* ================= 纸仓 ================= */
{
  const x = ZA.barnX, z = -1.6;
  const w = 5.4, d = 4.4;
  const y0 = ZA.terraceY;
  P.box0(w + 0.4, 0.3, d + 0.4, SHC.stone, x, y0, z, { jitter: false });
  P.box0(w, 2.7, 0.26, SHC.plaster, x, y0 + 0.3, z - d / 2, { jitter: false });
  P.box0(0.26, 2.7, d, SHC.plaster, x - w / 2, y0 + 0.3, z, { jitter: false });
  P.box0(0.26, 2.7, d, SHC.plaster, x + w / 2, y0 + 0.3, z, { jitter: false });
  /* 纸仓的三面墙都露在外面，三面都加抹灰接缝 */
  plasterSeams(x, y0 + 0.3, z - d / 2 + 0.14, w, 2.7, { rows: 4, cols: 6 });
  plasterSeams(x - w / 2 - 0.14, y0 + 0.3, z, d, 2.7, { rows: 4, cols: 5, ry: Math.PI / 2 });
  plasterSeams(x + w / 2 + 0.14, y0 + 0.3, z, d, 2.7, { rows: 4, cols: 5, ry: Math.PI / 2 });
  /* 正面：一排木门板，中间留一扇敞着 */
  for (let i = 0; i < 5; i++) {
    const dx = x - w / 2 + 0.5 + i * ((w - 1.0) / 4);
    if (i === 2) continue;
    P.box0(0.92, 2.5, 0.12, SHC.woodDark, dx, y0 + 0.3, z + d / 2, { jitter: false });
  }
  /* 敞着那扇门里的暗处与纸垛 */
  P.box0(0.94, 2.3, 0.06, 0x2a241c, x, y0 + 0.4, z + d / 2 - 0.1, { jitter: false });
  for (let i = 0; i < 5; i++) {
    P.box0(rnd(0.8, 1.2), rnd(0.5, 0.9), 0.7, SHC.paper, x + rnd(-1.4, 1.4), y0 + 0.34, z + rnd(-1.2, 1.2), { jitter: true });
  }
  tileRoof(x, w + 0.7, z + d / 2 + 0.45, z - d / 2 - 0.45, y0 + 3.28, 0.95);
  /* 正面两根檐柱（门板之间留出的开间） */
  for (const sx of [-w / 2 + 0.3, w / 2 - 0.3]) {
    post(x + sx, y0 + 0.3, z + d / 2 - 0.28, 2.7, { r: 0.14, seg: 9 });
  }
  plaqueAt('zBarn', 1.6, 0.48, x, y0 + 2.7, z + d / 2 + 0.22);
}

/* ================= 蔡伦神龛：官方页「一年一度祭祀蔡伦」的落点 =================
 * 形制无官方依据，一律作示意；匾额不写具体庙名。
 */
{
  const x = ZA.shrineX, z = ZA.shrineZ;
  const y0 = ZA.terraceY;
  /* 三面矮墙的小龛，正面敞开 */
  P.box0(2.2, 0.26, 1.5, SHC.stone, x, y0, z, { jitter: false });
  P.box0(2.0, 2.0, 0.24, SHC.plaster, x, y0 + 0.26, z - 0.63, { jitter: false });
  P.box0(0.24, 2.0, 1.3, SHC.plasterDeep, x - 0.88, y0 + 0.26, z, { jitter: false });
  P.box0(0.24, 2.0, 1.3, SHC.plasterDeep, x + 0.88, y0 + 0.26, z, { jitter: false });
  /* 龛内的暗处 */
  P.box0(1.6, 1.7, 0.06, 0x342a20, x, y0 + 0.3, z - 0.5, { jitter: false });

  /* 蔡伦坐像：低模、无脸，只留剪影与衣褶 */
  {
    const sy = y0 + 0.5;
    P.box0(0.5, 0.12, 0.4, SHC.stoneDark, x, sy, z - 0.3, { jitter: false });      // 座
    P.cyl0(0.19, 0.28, 0.62, 0x6a5a48, x, sy + 0.12, z - 0.3, { jitter: false }, 9); // 衣身
    for (let i = 0; i < 3; i++) {                                                   // 衣褶
      P.box(0.36, 0.02, 0.02, 0x584a3a, x, sy + 0.3 + i * 0.13, z - 0.14, { jitter: false, bucket: 'fine' });
    }
    P.sph(0.13, 0x8a7458, x, sy + 0.83, z - 0.3, { sy: 1.05, jitter: false }, 9, 7); // 头（无脸）
    P.box0(0.34, 0.1, 0.3, 0x4a3f30, x, sy + 0.94, z - 0.3, { jitter: false });      // 巾帻
  }

  /* 龛前：香炉、两盏油灯、几条红布 */
  P.cyl0(0.22, 0.26, 0.24, SHC.iron, x, y0 + 0.28, z + 0.25, { jitter: false }, 10);
  P.cyl0(0.2, 0.2, 0.03, 0x8a8070, x, y0 + 0.5, z + 0.25, { jitter: false }, 10);
  for (const s of [-1, 1]) {
    P.cyl0(0.09, 0.11, 0.2, SHC.iron, x + s * 0.62, y0 + 0.28, z + 0.25, { jitter: false }, 8);
    P.sph(0.05, 0xffd9a0, x + s * 0.62, y0 + 0.5, z + 0.25, { jitter: false, bucket: 'glow' }, 7, 5);
  }
  /* 红布条 */
  for (let i = 0; i < 4; i++) {
    P.box(0.1, rnd(0.4, 0.7), 0.02, PAL.clothRed, x + rnd(-0.9, 0.9), y0 + 1.5 + rnd(-0.2, 0.2), z + 0.72, { jitter: false, rz: rnd(-0.08, 0.08) });
  }
  plaqueAt('zShrine', 0.85, 0.3, x, y0 + 1.72, z + 0.13);
  bannerAt('zShrine', 0.3, 0.76, x - 0.72, y0 + 1.1, z + 0.12);
}
/* ---------- 45 · 器物与溪边 ----------
 * 溪与引水渠、埠头、竹竿架、独轮车、水桶、竹料捆等「生活切面」。
 * 这些全是静态的，走 P.* 自动并进合批。
 */

/* ================= 溪边：埠头、驳岸踏步、洗料的水栈 ================= */
{
  const zBank = ZA.bankZ;
  const y0 = ZA.terraceY;

  /* 埠头：从台地下到水面的几级踏步。
     初版只有几块石板悬着一路往下，没有侧帮，近看像几块板浮在溪上。
     补两道**石帮**（从台地一直砌到水面以下）把踏步托住，才是一个"埠头"。 */
  for (const [bx, width] of [[-8.6, 2.0], [3.2, 1.8], [12.4, 2.0]]) {
    /* 两侧石帮 */
    for (const s of [-1, 1]) {
      P.box0(0.2, 0.95, 1.75, SHC.stoneDark, bx + s * (width / 2 + 0.1), ZA.waterY - 0.38, zBank + 0.28, { jitter: false });
      /* 帮顶压石 */
      P.box0(0.26, 0.12, 1.85, TEC.stoneW, bx + s * (width / 2 + 0.1), y0 - 0.06, zBank + 0.28, { jitter: true });
    }
    for (let i = 0; i < 4; i++) {
      const y = y0 - 0.14 - i * 0.16;
      const z = zBank - 0.2 + i * 0.34;
      P.box0(width, 0.14, 0.4, SHC.stone, bx, y, z, { jitter: false });
      /* 踏步前缘的一道阴影，让层级看得清 */
      P.box(width, 0.03, 0.03, SHC.stoneDark, bx, y + 0.135, z + 0.19, { jitter: false, bucket: 'fine' });
      if (y < ZA.waterY + 0.1) break;
    }
    /* 埠头两侧的矮桩 */
    for (const s of [-1, 1]) {
      P.cyl0(0.075, 0.09, 0.62, SHC.woodDark, bx + s * (width / 2 + 0.24), y0 - 0.08, zBank + 0.62, { jitter: false }, 7);
      P.cyl0(0.085, 0.085, 0.05, SHC.wood, bx + s * (width / 2 + 0.24), y0 + 0.54, zBank + 0.62, { jitter: false }, 7);
    }
  }

  /* 洗料的水栈：伸到溪面上的一小块木台，边上有人洗竹料 */
  {
    const sx = -1.4, sw = 2.6, sd = 1.6;
    const sy = ZA.waterY + 0.42;
    for (let i = 0; i < 7; i++) {
      P.box0(sw, 0.08, sd / 7 * 0.94, SHC.wood, sx, sy, zBank - 0.1 + i * (sd / 7), { jitter: true });
    }
    /* 支撑木桩打到水里 */
    for (const [px, pz] of [[sx - sw / 2 + 0.15, zBank - 0.05], [sx + sw / 2 - 0.15, zBank - 0.05], [sx - sw / 2 + 0.15, zBank + sd - 0.2], [sx + sw / 2 - 0.15, zBank + sd - 0.2]]) {
      P.cyl0(0.1, 0.1, sy - ZA.waterY + 0.2, SHC.woodDark, px, ZA.waterY - 0.1, pz, { jitter: false }, 7);
    }
    /* 泡在水里的一捆竹料 */
    for (let i = 0; i < 6; i++) {
      P.cyl(0.075, 0.075, rnd(1.6, 2.2), i % 2 ? PAL.bamboo : PAL.bambooDark,
        sx + rnd(-0.7, 0.7), ZA.waterY + 0.06, zBank + rnd(0.5, 1.2), { rz: Math.PI / 2, ry: rnd(-0.2, 0.2), jitter: true }, 6);
    }
  }

  /* 晾晒的竹竿架：几排横杆，上面搭着洗好的竹料 */
  for (const [ax, az] of [[-12.6, 1.4], [7.8, 1.2]]) {
    for (const s of [-1, 1]) {
      P.cyl0(0.08, 0.09, 1.7, SHC.woodDark, ax + s * 1.9, y0, az, { jitter: false }, 7);
    }
    for (const yy of [1.0, 1.45]) {
      P.cyl(0.05, 0.05, 3.9, PAL.bamboo, ax, y0 + yy, az, { rz: Math.PI / 2, jitter: false }, 6);
    }
    /* 搭在架子上的竹料 */
    for (let i = 0; i < 7; i++) {
      P.cyl(0.06, 0.06, rnd(1.2, 2.0), i % 2 ? PAL.bamboo : PAL.bambooDark,
        ax + rnd(-1.6, 1.6), y0 + (rand() < 0.5 ? 1.05 : 1.5), az, { rz: Math.PI / 2, ry: rnd(-0.25, 0.25), jitter: true }, 6);
    }
  }
}

/* ================= 台地上的器物 ================= */
{
  const y0 = ZA.terraceY;

  /* 独轮车：木头轮子 + 车架 + 两只筐 */
  for (const [cx, cz, ry] of [[-7.4, 1.9, 0.4], [10.2, 1.7, -0.7]]) {
    P.torus(0.42, 0.06, SHC.woodDark, cx, y0 + 0.42, cz, { ry, jitter: false }, 6, 14);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P.box(0.8, 0.05, 0.05, SHC.wood, cx, y0 + 0.42, cz, { ry, rz: a, jitter: false, bucket: 'fine' });
    }
    P.box0(0.5, 0.12, 1.7, SHC.wood, cx, y0 + 0.8, cz, { ry, jitter: false });
    /* 两只筐 */
    for (const s of [-1, 1]) {
      const bx = cx + Math.cos(ry) * 0 + Math.sin(ry) * s * 0.75;
      const bz = cz + Math.cos(ry) * s * 0.75;
      P.cyl0(0.3, 0.24, 0.42, PAL.bamboo, bx, y0 + 0.92, bz, { jitter: false }, 10);
      P.cyl0(0.28, 0.28, 0.04, PAL.bambooDark, bx, y0 + 1.3, bz, { jitter: false }, 10);
    }
    /* 车把 */
    P.cyl(0.035, 0.035, 1.0, SHC.wood, cx, y0 + 0.86, cz + Math.cos(ry) * 1.15, { rx: 0.25, ry, jitter: false }, 6);
  }

  /* 散落的水桶与扁担 */
  for (const [bx, bz] of [[-3.6, 1.5], [-3.0, 1.9], [5.2, 1.8], [14.6, 0.6], [0.6, 2.0]]) {
    P.cyl0(0.24, 0.2, 0.44, SHC.wood, bx, y0, bz, { jitter: true }, 10);
    P.cyl0(0.22, 0.22, 0.03, 0x6b8fa8, bx, y0 + 0.36, bz, { jitter: false }, 10);
    P.torus(0.2, 0.022, SHC.iron, bx, y0 + 0.5, bz, { rx: 0.4, jitter: false }, 5, 12);
  }

  /* 成堆的嫩竹：等着进沤料池 */
  for (const [sx, sz] of [[-14.0, 1.6], [1.2, -3.4]]) {
    for (let i = 0; i < 16; i++) {
      P.cyl(0.085, 0.095, rnd(2.0, 3.2), i % 3 ? PAL.bamboo : PAL.bambooDark,
        sx + rnd(-0.9, 0.9), y0 + 0.1 + Math.floor(i / 5) * 0.18, sz + rnd(-0.6, 0.6),
        { rz: Math.PI / 2, ry: rnd(-0.3, 0.3), jitter: true }, 6);
    }
  }

  /* 台地上的几株老树：压住天际线 */
  for (const [tx, tz] of [[-17.2, -3.6], [17.6, -3.2], [-9.8, -3.9]]) {
    const th = rnd(3.4, 4.4);
    P.cyl0(0.22, 0.34, th, PAL.trunk, tx, y0, tz, { jitter: false }, 9);
    const canopy = [[0, th + 0.7, 0, 1.5], [-1.1, th + 0.35, 0.2, 1.05], [1.05, th + 0.45, -0.15, 1.1], [0.1, th + 1.25, 0.3, 1.0], [-0.4, th + 0.15, -0.9, 0.9]];
    for (const [dx, dy, dz, r] of canopy) {
      P.sph(r, pick([PAL.leaf, PAL.leafHi]), tx + dx, y0 + dy, tz + dz, { sy: 0.82, jitter: true }, 9, 6);
    }
  }

  /* 草丛（一次实例化，低强度补密度） */
  for (let i = 0; i < 120; i++) {
    const gx = rnd(-ZA.halfX + 1, ZA.halfX - 1);
    const gz = rnd(ZA.hillToe + 0.6, ZA.bankZ - 0.4);
    P.sph(rnd(0.08, 0.17), pick([PAL.leaf, PAL.moss, PAL.leafHi]),
      gx, y0 + 0.03, gz, { sy: 0.5, jitter: true }, 6, 4);
  }
}

/* ================= 溪上的小石桥 ================= */
{
  const bx = 15.8;
  const y0 = ZA.terraceY;
  const w = 1.9;
  const z0 = ZA.bankZ - 0.3, z1 = ZA.farBankZ + 0.3;
  /* 桥面：几块石板 */
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const z = z0 + (z1 - z0) * (i + 0.5) / segs;
    const arc = Math.sin(((i + 0.5) / segs) * Math.PI) * 0.34;
    P.box0(w, 0.16, (z1 - z0) / segs * 1.06, SHC.stone, bx, y0 - 0.2 + arc, z, { jitter: true });
  }
  /* 桥栏 */
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const z = z0 + (z1 - z0) * t;
      const arc = Math.sin(t * Math.PI) * 0.34;
      P.cyl0(0.07, 0.08, 0.5, SHC.stoneDark, bx + s * (w / 2 - 0.08), y0 - 0.04 + arc, z, { jitter: false }, 7);
    }
    /* 栏板 */
    for (let i = 0; i < 4; i++) {
      const t = (i + 1) / 5;
      const z = z0 + (z1 - z0) * t;
      const arc = Math.sin(t * Math.PI) * 0.34;
      P.box(0.1, 0.34, (z1 - z0) / 5 * 0.9, SHC.stone, bx + s * (w / 2 - 0.08), y0 + 0.2 + arc, z, { jitter: false });
    }
  }
}
/* ---------- 46 · 补密度：溪里、院前、建筑附加、竹林下层 ----------
 * 场景原本"空"，是因为**大面积的平面没有内容**，而不是缺主体：
 *   ① 溪占掉底座约四成，却只有水色和水纹；② 院前那条台地大片留白；
 *   ③ 竹林下的山地面是纯色；④ 建筑只有体块，没有挂物与细节。
 * 这一层专门补这四处。全部走 P.* 并进静态合批，draw call 几乎不涨。
 */

/* ---------- 小工具 ---------- */

/* 篱笆：一排立柱 + 两道横杆 */
function fenceRun(x0, z0, x1, z1, h = 0.85, o = {}) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(2, Math.round(len / 0.62));
  const ang = Math.atan2(dx, dz);
  const y0 = o.y0 != null ? o.y0 : ZA.terraceY;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    P.cyl0(0.045, 0.055, h, o.post || SHC.woodDark, x0 + dx * t, y0, z0 + dz * t,
      { jitter: true, ry: ang }, 6);
  }
  for (const ry of [h * 0.42, h * 0.82]) {
    P.cyl(0.028, 0.028, len, o.rail || PAL.bamboo, x0 + dx / 2, y0 + ry, z0 + dz / 2,
      { rz: Math.PI / 2, ry: ang, jitter: false }, 6);
  }
}

/* 窗棂：贴在墙面上的井字格（土墙房也有窗，别让墙是一整片） */
function lattice(x, y, z, w, h, o = {}) {
  const c = o.color || SHC.woodDark;
  const ry = o.ry || 0;
  P.box(w + 0.12, 0.07, 0.07, c, x, y + h / 2, z, { jitter: false, ry });
  P.box(w + 0.12, 0.07, 0.07, c, x, y - h / 2, z, { jitter: false, ry });
  P.box(0.07, h, 0.07, c, x - w / 2, y, z, { jitter: false, ry });
  P.box(0.07, h, 0.07, c, x + w / 2, y, z, { jitter: false, ry });
  for (let i = 1; i <= 2; i++) {
    P.box(0.045, h, 0.045, c, x - w / 2 + (w * i) / 3, y, z, { jitter: false, ry });
  }
  P.box(w, 0.045, 0.045, c, x, y, z, { jitter: false, ry });
  /* 窗洞里的暗 */
  P.box(w, h, 0.02, 0x3a3126, x, y, z - 0.03, { jitter: false, ry });
}

/* 纸灯笼：鼓腹 + 上下金箍 + 流苏。
   注意灯身直接走 'glow' 桶（MeshBasicMaterial，全亮不上阴影），
   不要再另加一个大发光球——初版那样做，发光球半径 1.5r 会把灯身整个包住，
   看到的只是一团奶油色的球，红灯笼反而没了。 */
function lantern(x, y, z, r = 0.17, o = {}) {
  const c = o.color || PAL.lantern;
  P.sph(r, c, x, y, z, { sy: 1.25, jitter: false, bucket: 'glow' }, 10, 8);
  P.cyl(0.018, 0.018, r * 0.6, SHC.woodDark, x, y + r * 1.55, z, { jitter: false }, 6);
  P.cyl0(r * 0.72, r * 0.72, 0.03, PAL.brass, x, y + r * 1.05, z, { jitter: false, bucket: 'glow' }, 8);
  P.cyl0(r * 0.72, r * 0.72, 0.03, PAL.brass, x, y - r * 1.05, z, { jitter: false, bucket: 'glow' }, 8);
  P.cyl(0.01, 0.01, r * 0.55, PAL.lantern, x, y - r * 1.45, z, { jitter: false }, 5);
}

/* 晾晒架：两根立柱 + 横杆 + 挂着的湿纸。
   初版纸片窄(0.26)、短(0.5~0.85)、等距排，远看就是一排白色栅栏。
   改成：纸片加宽加长、长度随机差更大、各带一点倾角，才像"挂着晾的纸"。 */
function dryRack(x, z, o = {}) {
  const y0 = o.y0 != null ? o.y0 : ZA.terraceY;
  const h = o.h || 1.95, w = o.w || 2.5;
  for (const s of [-1, 1]) {
    P.cyl0(0.06, 0.075, h, SHC.woodDark, x + s * w / 2, y0, z, { jitter: false }, 7);
    /* 斜撑 */
    P.cyl(0.032, 0.032, 0.8, SHC.woodDark, x + s * (w / 2 - 0.3), y0 + 0.28, z,
      { rz: s * 0.72, jitter: false }, 5);
  }
  /* 横杆：一道主杆 + 一道略低的副杆 */
  P.cyl(0.032, 0.032, w + 0.24, PAL.bamboo, x, y0 + h, z, { rz: Math.PI / 2, jitter: false }, 6);
  P.cyl(0.026, 0.026, w + 0.1, PAL.bamboo, x, y0 + h - 0.34, z + 0.06, { rz: Math.PI / 2, jitter: false }, 6);
  /* 挂着的纸：宽、长、长短不齐，带一点倾角 */
  const n = Math.max(3, Math.round(w / 0.52));
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + (w * (i + 0.5)) / n;
    const ph = rnd(0.95, 1.5);                    // 纸更长
    const sag = rnd(-0.045, 0.045);               // 各自略有倾角
    P.box(0.44, ph, 0.014, pick([SHC.paperBright, 0xf2e6cc, 0xeadfc4]),
      px, y0 + h - ph / 2 - 0.03, z + 0.035, { jitter: false, rz: sag });
    /* 纸下缘压出的阴影线，让纸从亮背景里"浮"出来 */
    P.box(0.44, 0.02, 0.018, 0xc8b894, px, y0 + h - ph - 0.03, z + 0.036, { jitter: false, rz: sag, bucket: 'fine' });
    /* 夹纸的竹夹 */
    P.box(0.09, 0.05, 0.05, PAL.bambooDark, px, y0 + h - 0.015, z + 0.02, { jitter: false });
  }
}

/* ================= 一 · 溪里 =================
 * 溪是大片留白，必须往里放东西：石、浅滩、水草、拦水堰、踏步石。
 */
{
  const yW = ZA.waterY;

  /* 溪石：**成组**散落，不要均匀撒点。
     初版是 26 块石头均匀随机，俯看像一地圆点（波尔卡）；
     真实溪里的石头是几处成堆、其余留空的。改成 5 个石堆 + 少量孤石。 */
  const STONE_GROUPS = [[-9.0, 6.2], [-1.6, 9.0], [5.4, 6.0], [12.6, 8.8], [-15.0, 8.4]];
  for (const [gx, gz] of STONE_GROUPS) {
    const n = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.28), rr = Math.sqrt(rand()) * 1.7;
      const r = rnd(0.24, 0.56) * (1 - rr / 4);      // 堆心的石头大、边上小
      P.sph(r, pick([TEC.stoneW, TEC.stoneWDark, 0x8f8776]),
        gx + Math.cos(a) * rr, yW + r * rnd(0.1, 0.55), gz + Math.sin(a) * rr * 0.8,
        { sy: rnd(0.5, 0.75), jitter: true, ry: rnd(0, 3.14) }, 8, 6);
    }
  }
  /* 孤石：少数几块，破一下"只有堆"的规律 */
  for (let i = 0; i < 9; i++) {
    const x = rnd(-ZA.halfX + 2, ZA.halfX - 2);
    const z = rnd(ZA.bankZ + 1.2, ZA.farBankZ - 1.2);
    const r = rnd(0.2, 0.42);
    P.sph(r, pick([TEC.stoneW, TEC.stoneWDark]), x, yW + r * rnd(0.1, 0.5), z,
      { sy: rnd(0.5, 0.7), jitter: true, ry: rnd(0, 3.14) }, 8, 6);
  }
  /* 两处卵石浅滩：靠岸的一片碎石 */
  for (const [bx, bz, br] of [[-11.5, 5.6, 2.4], [8.4, 8.6, 2.8]]) {
    for (let i = 0; i < 42; i++) {
      const a = rnd(0, Math.PI * 2), rr = Math.sqrt(rand()) * br;
      P.sph(rnd(0.08, 0.19), pick([TEC.stoneW, TEC.stoneWDark, 0xb5ac9a]),
        bx + Math.cos(a) * rr, yW + rnd(0.0, 0.12), bz + Math.sin(a) * rr * 0.7,
        { sy: 0.45, jitter: true }, 6, 4);
    }
  }
  /* 三处踏步石：从北岸踩到南岸。
     注意做**扁而小**的石片——初版半径 0.34~0.44、厚 0.22，
     在近景里像一排方块墙横在溪上。改成半径 0.24~0.32、厚 0.1，才像踏步。 */
  for (const sx of [-3.4, 5.0, 13.0]) {
    for (let i = 0; i < 5; i++) {
      const z = ZA.bankZ + 0.95 + i * 1.22;
      P.cyl0(rnd(0.24, 0.32), rnd(0.26, 0.34), 0.1, TEC.stoneW,
        sx + rnd(-0.3, 0.3), yW + rnd(0.08, 0.16), z, { jitter: true, ry: rnd(0, 1.5) });
    }
  }

  /* 菖蒲／水草：成丛长在浅水与岸边，是最能填溪的东西 */
  for (let i = 0; i < 74; i++) {
    /* 贴着两岸长，中间留出水道 */
    const nearBank = rand() < 0.5;
    const x = rnd(-ZA.halfX + 1, ZA.halfX - 1);
    const z = nearBank ? ZA.bankZ + rnd(0.1, 1.5) : ZA.farBankZ - rnd(0.1, 1.7);
    const n = 3 + Math.floor(rand() * 4);
    const cy = yW + 0.02;
    for (let k = 0; k < n; k++) {
      const a = rnd(-0.3, 0.3);
      const hh = rnd(0.45, 1.0);
      P.cyl(0.016, 0.024, hh, pick([TEC.moss, 0x6f8a4a, PAL.leaf]), x + rnd(-0.14, 0.14), cy + hh / 2, z + rnd(-0.14, 0.14),
        { rz: a, rx: rnd(-0.2, 0.2), jitter: false }, 5);
    }
  }

  /* 拦水堰：横在溪里的一道低石堰，把水位抬起来喂水碓的引水渠。
     位置就在水碓引水口的下游一点，让「渠水从哪来」有个交代。 */
  {
    const wx = ZA.millX + 0.6;
    const z0 = ZA.bankZ + 0.4, z1 = ZA.farBankZ - 1.4;
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const z = z0 + (z1 - z0) * (i + 0.5) / segs;
      const w = (z1 - z0) / segs;
      P.box0(rnd(0.7, 1.0), rnd(0.22, 0.36), w * 1.05, pick([TEC.stoneW, TEC.stoneWDark]),
        wx + rnd(-0.15, 0.15), yW - 0.05, z, { jitter: true, ry: rnd(-0.06, 0.06) });
    }
    /* 堰下的白沫 */
    for (let i = 0; i < 20; i++) {
      const z = z0 + (z1 - z0) * rand();
      P.box(rnd(0.3, 0.8), 0.012, rnd(0.1, 0.26), 0x9cc0c4, wx + rnd(0.5, 1.9), yW + 0.03, z,
        { jitter: true, ry: rnd(-0.4, 0.4), bucket: 'fine' });
    }
  }

  /* 漂在水面的落竹与浮木：山里溪上常见 */
  for (let i = 0; i < 7; i++) {
    const x = rnd(-ZA.halfX + 3, ZA.halfX - 3);
    const z = rnd(ZA.bankZ + 1.0, ZA.farBankZ - 1.0);
    const a = rnd(-0.35, 0.35);
    P.cyl(0.055, 0.055, rnd(1.6, 3.0), rand() < 0.5 ? PAL.bamboo : PAL.bambooDark,
      x, yW + 0.04, z, { rz: Math.PI / 2, ry: a, jitter: true }, 6);
  }

  /* 鱼篓：几只竹编的鱼篓半沉在岸边浅水里，用竹桩系着 —— 溪边人家的日常 */
  for (const [fx, fz] of [[-6.8, 5.3], [3.0, 9.9], [10.4, 5.4], [15.6, 9.6]]) {
    const fy = yW + 0.12;
    /* 篓身：鼓腹，笼口朝上 */
    P.cyl0(0.12, 0.22, 0.18, PAL.bambooDark, fx, fy - 0.12, fz, { jitter: false }, 9);
    P.cyl0(0.26, 0.2, 0.34, PAL.bamboo, fx, fy + 0.04, fz, { jitter: false }, 9);
    P.cyl0(0.13, 0.13, 0.05, PAL.bambooDark, fx, fy + 0.38, fz, { jitter: false }, 9);
    /* 篓口倒须（几根竹签交叠） */
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      P.box(0.26, 0.015, 0.015, PAL.bamboo, fx, fy + 0.4, fz, { ry: a, rz: 0.25, jitter: false, bucket: 'fine' });
    }
    /* 系篓的竹桩 */
    P.cyl0(0.05, 0.06, 0.7, SHC.woodDark, fx + 0.42, yW + 0.05, fz, { jitter: false }, 6);
    P.cyl(0.01, 0.01, 0.42, 0xc9b48a, fx + 0.22, yW + 0.55, fz, { rz: 1.1, jitter: false, bucket: 'fine' }, 4);
  }
}

/* ================= 二 · 院前与台地 =================
 * 建筑前那条台地是大片留白，按「纸坊的活计」铺东西。
 */
{
  const y0 = ZA.terraceY;

  /* 晾晒架三组，摆在抄纸间与晾纸墙之间的院子空地上 */
  dryRack(-3.6, 2.2);
  dryRack(1.6, 2.9, { w: 2.8 });
  dryRack(9.4, 2.4);

  /* 石灰池：三个方形浅池，泡着石灰水（煮料要用） */
  for (const [px, pz] of [[-13.6, 1.5], [-12.3, 2.4], [-14.9, 2.5]]) {
    P.box0(1.5, 0.34, 1.3, TEC.stoneW, px, y0, pz, { jitter: false });
    P.box(1.2, 0.04, 1.0, 0xd8d4c4, px, y0 + 0.32, pz, { jitter: false, bucket: 'fine' });
    /* 池边堆的石灰 */
    for (let i = 0; i < 3; i++) {
      P.sph(rnd(0.14, 0.22), 0xe0dcd0, px + rnd(-0.9, 0.9), y0 + rnd(0.1, 0.26), pz + rnd(-0.9, 0.9),
        { sy: 0.6, jitter: true }, 7, 5);
    }
  }

  /* 纸垛：方方正正压着木板与石头，上面盖草席 */
  for (const [sx, sz, ry] of [[4.2, 1.5, 0.2], [-6.4, 2.6, -0.3], [12.0, 0.2, 0.5], [-0.4, 3.2, 0.1]]) {
    const n = Math.floor(rnd(0.5, 0.9));
    const sh = 0.42 + n * 0.16;
    P.box0(1.15, sh, 0.85, SHC.paperBright, sx, y0, sz, { jitter: false, ry });
    for (let i = 1; i < 6; i++) {
      P.box(1.1, 0.012, 0.8, 0xdcd0b0, sx, y0 + (sh * i) / 6, sz, { jitter: false, ry, bucket: 'fine' });
    }
    /* 压板 + 石头 */
    P.box0(1.3, 0.09, 1.0, SHC.wood, sx, y0 + sh, sz, { jitter: false, ry });
    for (let i = 0; i < 2; i++) {
      P.sph(rnd(0.12, 0.18), TEC.stoneWDark, sx + rnd(-0.35, 0.35), y0 + sh + 0.16, sz + rnd(-0.28, 0.28),
        { sy: 0.6, jitter: true }, 7, 5);
    }
    /* 盖着的一角草席 */
    if (rand() < 0.6) {
      P.box(1.4, 0.05, 1.1, 0xc9b183, sx + rnd(-0.2, 0.2), y0 + sh + 0.3, sz + rnd(-0.2, 0.2),
        { jitter: true, ry: ry + rnd(-0.4, 0.4) });
    }
  }

  /* 陶缸、木桶、竹筐：成组摆，别一个一个孤零零地放 */
  for (const [gx, gz] of [[-9.2, 3.0], [6.6, 1.2], [14.4, 2.0], [-16.0, 0.4], [1.8, 1.2]]) {
    for (let i = 0; i < 4; i++) {
      const a = rnd(0, 6.28), rr = rnd(0.2, 0.75);
      const bx = gx + Math.cos(a) * rr, bz = gz + Math.sin(a) * rr * 0.7;
      if (rand() < 0.5) {
        /* 陶缸：鼓腹收口 */
        P.cyl0(0.2, 0.26, 0.12, 0x6b5a44, bx, y0, bz, { jitter: true }, 10);
        P.cyl0(0.3, 0.24, 0.42, 0x8a6f4e, bx, y0 + 0.1, bz, { jitter: false }, 10);
        P.cyl0(0.19, 0.19, 0.04, 0x4a3c2c, bx, y0 + 0.5, bz, { jitter: false }, 10);
      } else {
        /* 木桶 + 铁箍 */
        P.cyl0(0.24, 0.2, 0.44, SHC.wood, bx, y0, bz, { jitter: true }, 10);
        P.torus(0.225, 0.018, SHC.iron, bx, y0 + 0.14, bz, { rx: Math.PI / 2, jitter: false }, 5, 12);
        P.torus(0.215, 0.018, SHC.iron, bx, y0 + 0.34, bz, { rx: Math.PI / 2, jitter: false }, 5, 12);
      }
    }
  }

  /* 菜园：一小块篱笆围起来的菜地，种着几行菜 —— 纸坊也是过日子的地方 */
  {
    const gx = -17.4, gz = 2.6, gw = 4.0, gd = 3.2;
    fenceRun(gx - gw / 2, gz - gd / 2, gx + gw / 2, gz - gd / 2, 0.7);
    fenceRun(gx - gw / 2, gz + gd / 2, gx + gw / 2, gz + gd / 2, 0.7);
    fenceRun(gx - gw / 2, gz - gd / 2, gx - gw / 2, gz + gd / 2, 0.7);
    /* 菜畦：四行土垄 + 一排排菜 */
    for (let r = 0; r < 4; r++) {
      const rz = gz - gd / 2 + 0.5 + r * 0.72;
      P.box0(gw - 1.0, 0.1, 0.42, 0x7d6b4a, gx, y0, rz, { jitter: true });
      for (let i = 0; i < 7; i++) {
        const cx = gx - (gw - 1.4) / 2 + i * ((gw - 1.4) / 6);
        const kind = rand();
        if (kind < 0.5) {
          /* 叶菜：一球一球的 */
          P.sph(rnd(0.1, 0.16), pick([PAL.leaf, PAL.leafHi, 0x6f9d55]), cx, y0 + 0.16, rz, { sy: 0.8, jitter: true }, 7, 5);
        } else if (kind < 0.8) {
          /* 葱蒜：细长一丛 */
          for (let k = 0; k < 3; k++) {
            P.cyl(0.012, 0.02, rnd(0.24, 0.4), 0x7fa05a, cx + rnd(-0.05, 0.05), y0 + 0.2, rz, { rz: rnd(-0.15, 0.15), jitter: false }, 4);
          }
        } else {
          /* 爬藤的竹架 */
          P.cyl0(0.02, 0.025, 0.9, PAL.bamboo, cx, y0, rz, { jitter: false }, 5);
          P.cyl0(0.02, 0.025, 0.9, PAL.bamboo, cx + 0.16, y0, rz, { jitter: false }, 5);
          P.cyl(0.015, 0.015, 0.2, PAL.bamboo, cx + 0.08, y0 + 0.8, rz, { rz: Math.PI / 2, jitter: false }, 5);
        }
      }
    }
  }

  /* 晾衣绳：两柱一绳，挂着几件布 */
  for (const [lx, lz] of [[-5.0, 3.4], [11.0, 3.0]]) {
    for (const s of [-1, 1]) {
      P.cyl0(0.05, 0.06, 1.7, SHC.woodDark, lx + s * 1.5, y0, lz, { jitter: false }, 6);
    }
    P.cyl(0.012, 0.012, 3.0, 0xc9b48a, lx, y0 + 1.6, lz, { rz: Math.PI / 2, jitter: false }, 4);
    for (let i = 0; i < 4; i++) {
      const cx = lx - 1.2 + i * 0.8;
      P.box(0.4, rnd(0.5, 0.8), 0.02, pick([0x6f8fa8, 0xa8352c, 0xd9c39a, 0x8a9a6a]),
        cx, y0 + 1.15, lz + 0.02, { jitter: true, rz: rnd(-0.05, 0.05) });
    }
  }

  /* 靠墙斜放的家伙：竹筛、斗笠、蓑衣、扁担、扫帚 —— 让墙脚不空 */
  for (const [px, pz, ry] of [
    [-13.0, -3.0, 0.3], [-12.4, -3.0, -0.2], [8.2, -3.2, 0.5], [12.2, 1.3, -0.4],
    [-2.6, 1.7, 1.2], [16.0, 0.6, 0.8], [-7.6, 1.6, -0.9], [3.4, -3.0, 0.2],
  ]) {
    const k = rand();
    if (k < 0.34) {
      /* 竹筛：圆盘靠在墙上 */
      P.cyl0(0.34, 0.34, 0.05, PAL.bamboo, px, y0 + 0.3, pz, { rx: 0.5, ry, jitter: false }, 12);
      P.torus(0.33, 0.028, PAL.bambooDark, px, y0 + 0.3, pz, { rx: 0.5, ry, jitter: false }, 5, 14);
    } else if (k < 0.62) {
      /* 斗笠：扣在地上或挂着 */
      P.cyl0(0.03, 0.36, 0.2, 0xa8906a, px, y0 + 0.16, pz, { ry: rnd(0, 3.14), jitter: false }, 12);
    } else if (k < 0.82) {
      /* 蓑衣：一束草披挂着 */
      for (let i = 0; i < 5; i++) {
        P.box(rnd(0.3, 0.42), 0.5, 0.03, 0xa8965c, px, y0 + 0.42, pz + i * 0.02, { jitter: true, rz: rnd(-0.08, 0.08) });
      }
    } else {
      /* 扫帚：一捆细枝 + 柄 */
      P.cyl(0.02, 0.03, 0.9, SHC.wood, px, y0 + 0.55, pz, { rz: 0.35, jitter: false }, 5);
      for (let i = 0; i < 6; i++) {
        P.cyl(0.008, 0.01, 0.4, 0xb5a06a, px + 0.2 + rnd(-0.06, 0.06), y0 + 0.2, pz + rnd(-0.06, 0.06),
          { rz: rnd(0.2, 0.5), jitter: false }, 4);
      }
    }
  }

  /* 独轮车用的竹筐：散在两处，筐里露着竹料 */
  for (const [bx, bz] of [[-4.4, 3.6], [9.8, 3.4], [15.2, 0.2]]) {
    for (let i = 0; i < 3; i++) {
      const px = bx + rnd(-0.4, 0.4), pz = bz + rnd(-0.3, 0.3);
      P.cyl0(0.3, 0.24, 0.42, PAL.bamboo, px, y0, pz, { jitter: true }, 10);
      P.cyl0(0.28, 0.28, 0.04, PAL.bambooDark, px, y0 + 0.36, pz, { jitter: false }, 10);
      /* 筐里插着的竹料 */
      for (let k = 0; k < 3; k++) {
        P.cyl(0.03, 0.03, rnd(0.4, 0.8), PAL.bamboo, px + rnd(-0.14, 0.14), y0 + 0.6, pz + rnd(-0.14, 0.14),
          { rz: rnd(-0.3, 0.3), rx: rnd(-0.3, 0.3), jitter: false }, 5);
      }
    }
  }
}

/* ================= 三 · 建筑附加 =================
 * 建筑只有体块会显得"模型感"，补窗、灯、篷、挂物。
 */
{
  const y0 = ZA.terraceY;

  /* 煮料灶房：山墙上的窗 + 檐下挂的干辣椒与竹筛 */
  lattice(ZA.stoveX - 2.5 - 0.16, y0 + 1.7, -1.4, 0.9, 0.8, { ry: Math.PI / 2 });
  P.cyl(0.025, 0.025, 2.2, 0xc9b48a, ZA.stoveX, y0 + 2.75, -3.4 + 0.16, { rz: Math.PI / 2, jitter: false }, 4);
  for (let i = 0; i < 7; i++) {
    P.sph(0.06, PAL.chili, ZA.stoveX - 0.9 + i * 0.24, y0 + 2.5, -3.4 + 0.2, { sy: 1.5, jitter: true }, 6, 5);
  }
  P.cyl0(0.3, 0.3, 0.04, PAL.bamboo, ZA.stoveX + 1.7, y0 + 2.4, -3.4 + 0.2, { rx: 0.35, jitter: false }, 12);

  /* 纸仓：正面门板之间的窗棂 + 檐下两盏灯笼 */
  lattice(ZA.barnX - 2.0, y0 + 1.8, -1.6 + 2.2 + 0.16, 0.8, 0.7);
  lattice(ZA.barnX + 2.0, y0 + 1.8, -1.6 + 2.2 + 0.16, 0.8, 0.7);
  lantern(ZA.barnX - 3.1, y0 + 2.35, -1.6 + 2.2 + 0.5, 0.16);
  lantern(ZA.barnX + 3.1, y0 + 2.35, -1.6 + 2.2 + 0.5, 0.16);

  /* 抄纸间：檐下挂两盏灯笼，正面前方摆一张长案（晾帘、数纸用）。
     注意：这里**不要**加布篷——初版在正前方挑了一片布篷，
     正好把「荡帘打浪」这个全场主戏挡住，得不偿失。 */
  lantern(ZA.vatX - 3.3, y0 + 3.3, -0.9 + 2.5 + 0.6, 0.17);
  lantern(ZA.vatX + 3.3, y0 + 3.3, -0.9 + 2.5 + 0.6, 0.17);
  {
    const tx = ZA.vatX + 3.6, tz = -0.9 + 2.5 + 0.55;
    P.box0(1.9, 0.1, 0.7, SHC.wood, tx, y0 + 0.72, tz, { jitter: false });
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) {
        P.cyl0(0.045, 0.05, 0.72, SHC.woodDark, tx + s * 0.8, y0, tz + t * 0.25, { jitter: false }, 6);
      }
    }
    /* 案上摊着的纸与压石 */
    P.box(1.4, 0.012, 0.5, SHC.paperBright, tx, y0 + 0.78, tz, { jitter: false, ry: 0.1 });
    P.sph(0.1, TEC.stoneWDark, tx + 0.55, y0 + 0.85, tz, { sy: 0.6, jitter: false }, 7, 5);
    P.sph(0.09, TEC.stoneWDark, tx - 0.58, y0 + 0.85, tz + 0.1, { sy: 0.6, jitter: false }, 7, 5);
  }

  /* 水碓房：檐下挂着备用的碓头与绳 */
  P.cyl0(0.16, 0.16, 0.5, TEC.stoneWDark, ZA.millX + 1.9, y0 + 2.2, -1.6 + 2.2 + 0.5, { rx: 0.4, jitter: false }, 8);
  P.torus(0.2, 0.025, 0xc9b48a, ZA.millX + 1.4, y0 + 2.3, -1.6 + 2.2 + 0.5, { rx: 0.3, jitter: false }, 5, 12);

  /* 晾纸墙：墙头挂两盏灯（夜里也好认），墙下多摆几摞纸 */
  lantern(ZA.wallX + 4.1, y0 + 5.3, -1.0 + 0.5, 0.17);
  lantern(ZA.wallX - 4.1, y0 + 5.3, -1.0 + 0.5, 0.17);
  for (const [sx, sz] of [[ZA.wallX + 3.2, 1.2], [ZA.wallX + 3.4, 2.0], [ZA.wallX - 3.3, 1.0]]) {
    P.box0(1.0, 0.62, 0.78, SHC.paperBright, sx, y0, sz, { jitter: false, ry: rnd(-0.2, 0.2) });
    for (let i = 1; i < 5; i++) {
      P.box(0.96, 0.012, 0.74, 0xdcd0b0, sx, y0 + (0.62 * i) / 5, sz, { jitter: false, bucket: 'fine' });
    }
  }

  /* 沤料池：池边加栏杆，免得人掉下去；再加一块木牌 */
  {
    const px = ZA.poolX, pz = -1.2, w = 4.6, d = 3.2;
    for (const s of [-1, 1]) {
      P.cyl(0.05, 0.05, 0.9, SHC.woodDark, px + s * (w / 2 + 0.2), y0 + 0.75, pz, { rx: Math.PI / 2, jitter: false }, 6);
    }
    for (let i = 0; i < 5; i++) {
      P.cyl0(0.05, 0.055, 0.85, SHC.woodDark, px - w / 2 - 0.2 + (w + 0.4) * i / 4, y0, pz + d / 2 + 0.3, { jitter: false }, 6);
    }
    P.cyl(0.04, 0.04, w + 0.4, SHC.woodDark, px, y0 + 0.8, pz + d / 2 + 0.3, { rz: Math.PI / 2, jitter: false }, 6);
  }

  /* 神龛：加一圈矮栏与两棵小柏，让龛前有个"场地" */
  {
    const sx = ZA.shrineX, sz = ZA.shrineZ;
    for (const dx of [-1.4, 1.4]) {
      P.cyl0(0.06, 0.07, 0.9, SHC.woodDark, sx + dx, y0, sz + 1.3, { jitter: false }, 6);
    }
    P.cyl(0.04, 0.04, 2.8, SHC.woodDark, sx, y0 + 0.85, sz + 1.3, { rz: Math.PI / 2, jitter: false }, 6);
    for (const dx of [-1.9, 1.9]) {
      P.cyl0(0.09, 0.13, rnd(0.8, 1.1), PAL.trunk, sx + dx, y0, sz - 0.3, { jitter: false }, 7);
      for (let i = 0; i < 3; i++) {
        P.sph(rnd(0.24, 0.34), pick([PAL.leaf, 0x3f5f3a]), sx + dx + rnd(-0.2, 0.2), y0 + rnd(0.9, 1.3), sz - 0.3 + rnd(-0.2, 0.2),
          { sy: 0.8, jitter: true }, 8, 6);
      }
    }
  }
}

/* ================= 四 · 竹林下层 =================
 * 竹林里的地面原本是纯绿，加灌木、石头、竹笋、落叶。
 */
{
  /* 灌木丛：铺在山坡上。
     注意要做得**扁而低**——初版是 sy=0.7 的球、抬到 h + 0.4r，
     俯看就是一个个深色圆斑（球顶 + 一圈影子），像地上挖了个坑。
     改成 sy≈0.32、几乎贴地的扁丛，才是"地被"。颜色也调亮，别比坡面还深太多。 */
  for (let i = 0; i < 175; i++) {
    const x = rnd(-ZA.halfX + 0.8, ZA.halfX - 0.8);
    const z = rnd(ZA.ridgeZ + 0.6, ZA.hillToe - 0.4);
    const h = hillY(x, z);
    if (h < 0.3) continue;
    const r = rnd(0.18, 0.42);
    P.sph(r, pick([TEC.moss, 0x7d9a55, 0x6f8a4a, PAL.leafHi, 0x5f7a45]),
      x, h + r * 0.14, z, { sy: rnd(0.26, 0.4), jitter: true, ry: rnd(0, 3.14) }, 8, 5);
  }
  /* 石头：散在坡上，给纯绿的地面留点"硬"的东西 */
  for (let i = 0; i < 56; i++) {
    const x = rnd(-ZA.halfX + 0.8, ZA.halfX - 0.8);
    const z = rnd(ZA.ridgeZ + 0.6, ZA.hillToe - 0.3);
    const h = hillY(x, z);
    if (h < 0.2) continue;
    P.sph(rnd(0.16, 0.42), pick([TEC.stoneW, TEC.stoneWDark, 0x8f8776]), x, h + rnd(0.02, 0.12), z,
      { sy: rnd(0.5, 0.8), jitter: true, ry: rnd(0, 3.14) }, 8, 6);
  }
  /* 竹笋：从地里冒出来的尖锥，极有辨识度 */
  for (let i = 0; i < 40; i++) {
    const x = rnd(-ZA.halfX + 0.8, ZA.halfX - 0.8);
    const z = rnd(ZA.ridgeZ + 1.0, ZA.hillToe - 0.6);
    const h = hillY(x, z);
    if (h < 0.3) continue;
    const sh = rnd(0.2, 0.46);
    P.cyl0(0.02, rnd(0.09, 0.14), sh, pick([0x8a7a48, 0x9c8a52, 0x6f6238]), x, h, z,
      { jitter: true, rz: rnd(-0.1, 0.1) }, 7);
    /* 笋壳：几片斜挑的尖叶 */
    for (let k = 0; k < 3; k++) {
      const a = rnd(0, 6.28);
      P.plane(0.16, 0.13, 0x7a6a40, x + Math.cos(a) * 0.07, h + sh * rnd(0.3, 0.7), z + Math.sin(a) * 0.07,
        { rx: rnd(-0.9, -0.4), ry: a, jitter: false });
    }
  }
  /* 倒伏的竹子：横在坡上 */
  for (let i = 0; i < 12; i++) {
    const x = rnd(-ZA.halfX + 2, ZA.halfX - 2);
    const z = rnd(ZA.ridgeZ + 1.2, ZA.hillToe - 1.0);
    const h = hillY(x, z);
    const a = rnd(0, 3.14);
    const len = rnd(2.4, 4.6);
    const segs = 5;
    for (let k = 0; k < segs; k++) {
      const t = (k + 0.5) / segs;
      const px = x + Math.cos(a) * len * (t - 0.5);
      const pz = z + Math.sin(a) * len * (t - 0.5);
      P.cyl(0.05, 0.05, (len / segs) * 1.06, PAL.bamboo, px, hillY(px, pz) + 0.06, pz,
        { rz: Math.PI / 2, ry: -a, jitter: false }, 6);
    }
  }
  /* 落叶层：坡上撒一层碎叶，破掉纯色 */
  for (let i = 0; i < 180; i++) {
    const x = rnd(-ZA.halfX + 0.8, ZA.halfX - 0.8);
    const z = rnd(ZA.ridgeZ + 0.6, ZA.hillToe - 0.3);
    const h = hillY(x, z);
    if (h < 0.2) continue;
    P.box(rnd(0.16, 0.34), 0.012, rnd(0.1, 0.2), pick([0x9c8a52, 0x8a7a48, 0x6f6238, 0xb5a06a]),
      x, h + 0.01, z, { jitter: true, ry: rnd(0, 3.14), bucket: 'fine' });
  }
}

/* ================= 五 · 家禽与零星活物 =================
 * 一两群鸡鸭，花不了多少面，但"有人过日子"的感觉立刻出来。
 */
{
  const y0 = ZA.terraceY;
  for (let i = 0; i < 16; i++) {
    /* 分两群：一群在菜园边，一群在院前 */
    const inGarden = i < 8;
    const x = inGarden ? rnd(-19.0, -15.6) : rnd(-5.5, -2.5);
    const z = inGarden ? rnd(1.4, 3.8) : rnd(2.4, 3.9);
    const ry = rnd(0, 6.28);
    const s = rnd(0.85, 1.15);
    /* 身体 + 头 + 冠 + 尾 */
    P.sph(0.14 * s, pick([0xf0ead8, 0xd9a24a, 0x8a6f52, 0xc9c0a8]), x, y0 + 0.2 * s, z, { sx: 1.25, sy: 0.95, ry, jitter: false }, 8, 6);
    P.sph(0.075 * s, 0xe8e2d2, x + Math.cos(ry) * 0.17 * s, y0 + 0.32 * s, z + Math.sin(ry) * 0.17 * s,
      { sy: 1.1, jitter: false }, 7, 5);
    if (rand() < 0.5) {
      P.sph(0.035, 0xc0392b, x + Math.cos(ry) * 0.17 * s, y0 + 0.4 * s, z + Math.sin(ry) * 0.17 * s, { sy: 0.6, jitter: false }, 6, 4);
    }
    P.box(0.05 * s, 0.045 * s, 0.05 * s, 0xd9a24a, x + Math.cos(ry) * 0.24 * s, y0 + 0.31 * s, z + Math.sin(ry) * 0.24 * s, { jitter: false });
    P.box(0.11 * s, 0.16 * s, 0.04 * s, 0xf0ead8, x - Math.cos(ry) * 0.19 * s, y0 + 0.24 * s, z - Math.sin(ry) * 0.19 * s,
      { rz: -0.5, ry, jitter: false });
    /* 两只脚 */
    for (const sgn of [-1, 1]) {
      P.cyl(0.012, 0.012, 0.13 * s, 0xd9a24a, x + sgn * 0.04, y0 + 0.065 * s, z, { jitter: false }, 4);
    }
  }
}
/* ---------- 47 · 人 ----------
 * 三十来个纸坊里的人：低模、无脸、剪影式，和场景同一套描边，
 * 全部在做工序动作，不做表情、不围观。
 * 用 InstancedMesh 分部件（下摆 / 躯干 / 头 / 斗笠）合批，方法照 miaohui 的人群。
 */

{
  const y0 = ZA.terraceY;

  /* 人的落点高度：山上取 hillY，溪里取水面（站在浅水或踏步石上），其余取台地。
     必须分三种情况——初版只有「山/台地」两档，
     结果补在溪边收鱼篓、踏步石过溪的那几个人全都悬在水面上方 0.64 米。 */
  const groundAt = (px, pz) => {
    if (pz < ZA.hillToe) return hillY(px, pz);
    if (pz > ZA.bankZ) return ZA.waterY + 0.06;   // 水中／踏步石
    return y0;
  };

  /* 衣服用靛蓝、赭红、土黄、墨绿这类民间色 */
  const CLOTH = [0x3f5f80, 0xa8352c, 0xc08a3a, 0x3f6a4a, 0x5a4a3c];
  const skinMat = new THREE.MeshToonMaterial({ color: 0xc8a184, gradientMap: gradientTexture() });

  /* 每个人的落点与朝向：[x, z, 朝向 ry, 姿势] */
  const people = [];

  /* 抄纸槽边三人：荡帘、提帘、揭纸（动作最细，由 42-vat 的会动匠人担任两个，
     这里补第三个在旁边递帘） */
  people.push([ZA.vatX - 2.6, -2.6, 0.15, 'stand']);
  people.push([ZA.vatX + 2.9, -1.9, -0.4, 'stand']);

  /* 晾纸墙下两人：举着湿纸往墙上贴 */
  people.push([ZA.wallX - 2.4, 1.5, 3.14, 'raise']);
  people.push([ZA.wallX + 1.2, 1.7, 3.14, 'raise']);

  /* 水碓房里一人添料 */
  people.push([ZA.millX + 1.4, -2.4, 0.6, 'bend']);

  /* 煮料灶前一人看火 */
  people.push([ZA.stoveX + 0.6, 0.2, 3.14, 'bend']);

  /* 沤料池边两人翻竹料 */
  people.push([ZA.poolX - 1.6, -3.0, 0.5, 'bend']);
  people.push([ZA.poolX + 1.8, -2.9, -0.6, 'bend']);

  /* 溪边埠头一人挑水 */
  people.push([-8.6, 0.6, 3.14, 'carry']);

  /* 山路上两人挑着竹料从山上下来（沿用山道的坐标） */
  people.push([1.0, -4.9, 0.35, 'carry']);
  people.push([0.2, -3.7, 0.35, 'carry']);

  /* 神龛前一人上香 */
  people.push([ZA.shrineX - 0.5, ZA.shrineZ + 1.0, 3.14, 'bend']);

  /* 纸仓门口一人搬运 */
  people.push([ZA.barnX - 1.6, 1.2, 0.2, 'carry']);

  /* 台地上零散走动的：做出一路上的“有人在干活” */
  const walkers = [
    [-11.8, 0.4, 1.5], [-6.2, 0.9, -1.2], [3.8, 1.1, 0.8], [9.0, 0.5, -0.5],
    [14.0, 1.4, 2.2], [-16.4, 0.8, 0.9], [6.8, -2.8, -1.8], [-2.2, 1.6, 1.1],
    [11.6, -2.2, 0.3], [-4.6, -3.2, 2.6], [8.2, 1.9, -0.9], [1.6, -2.0, 0.6],
    [-13.6, -2.4, 1.9], [16.2, -1.4, -2.4], [-9.0, 1.8, 0.4], [4.6, -1.4, 2.8],
  ];
  for (const [wx, wz, wr] of walkers) people.push([wx, wz, wr, 'stand']);

  /* ---- 第二轮补的：让新加的活计也有人 ----
     （晾晒架、菜园、石灰池、鱼篓、竹料堆，都该有人在做） */
  const extra = [
    /* 晾晒架下：两人在挂纸／收纸 */
    [-3.6, 1.3, 3.14, 'raise'], [-3.6, 3.0, 0.0, 'stand'],
    [1.6, 1.9, 3.14, 'raise'], [9.4, 1.4, 3.14, 'raise'],
    /* 石灰池边：一人在搅石灰 */
    [-13.6, 0.9, 0.2, 'bend'],
    /* 菜园里：一人蹲着间苗 */
    [-17.4, 2.2, 1.4, 'bend'],
    /* 溪边收鱼篓：两个 */
    [-6.8, 5.5, 3.4, 'bend'], [10.4, 5.6, 3.0, 'bend'],
    /* 踏步石上过溪：一个 */
    [5.0, 6.6, 0.0, 'carry'],
    /* 竹料堆边捆料：两个 */
    [-14.0, 1.0, 0.6, 'bend'], [1.2, -2.9, -0.8, 'bend'],
    /* 纸仓门口搬纸垛：一个 */
    [12.0, 1.0, 0.3, 'carry'],
    /* 神龛旁扫地的：一个 */
    [ZA.shrineX + 1.6, ZA.shrineZ + 1.6, 2.2, 'bend'],
    /* 水碓房后递竹料的：一个 */
    [ZA.millX - 2.6, -1.0, 1.2, 'carry'],
  ];
  for (const [px, pz, pr, pose] of extra) people.push([px, pz, pr, pose]);

  const total = people.length;

  /* 分部件建实例网格：每个部件一次绘制 */
  const skirtGeo = new THREE.CylinderGeometry(0.19, 0.3, 0.66, 7);
  const bodyGeo = new THREE.CapsuleGeometry(0.21, 0.5, 4, 7);
  const headGeo = new THREE.SphereGeometry(0.135, 9, 7);
  const hatGeo = new THREE.ConeGeometry(0.33, 0.17, 9);

  /* 每个颜色一组，最后把 count 收到实际用量（照 miaohui 的做法，避免越界） */
  const skirts = CLOTH.map((c) => new THREE.InstancedMesh(
    skirtGeo, new THREE.MeshToonMaterial({ color: c, gradientMap: gradientTexture() }), total));
  const bodies = CLOTH.map((c) => new THREE.InstancedMesh(
    bodyGeo, new THREE.MeshToonMaterial({ color: c, gradientMap: gradientTexture() }), total));
  const heads = new THREE.InstancedMesh(headGeo, skinMat, total);
  const hats = new THREE.InstancedMesh(hatGeo,
    new THREE.MeshToonMaterial({ color: 0xa8906a, gradientMap: gradientTexture() }), total);

  const dummy = new THREE.Object3D();
  const filled = CLOTH.map(() => 0);
  let hIdx = 0, hatIdx = 0;

  for (let i = 0; i < total; i++) {
    const [px, pz, ry, pose] = people[i];
    /* 落点高度：山上的人取 hillY，台地上的取台地面 */
    const gy = groundAt(px, pz);
    const s = rnd(0.92, 1.06);
    const gi = Math.floor(rand() * CLOTH.length);

    /* 姿势：弯腰的压低、举纸的抬手（这里只做整体高度/倾角的差别，
       手臂的细分动作交给 42-vat 里那两个会动的匠人） */
    let lean = 0;
    if (pose === 'bend') lean = 0.32;
    if (pose === 'raise') lean = -0.1;

    dummy.rotation.set(lean, ry, 0);
    dummy.scale.set(s, s, s);

    /* 下摆 */
    dummy.position.set(px, gy + 0.33 * s, pz);
    dummy.updateMatrix();
    skirts[gi].setMatrixAt(filled[gi], dummy.matrix);
    /* 躯干 */
    dummy.position.set(px + lean * 0.1, gy + (0.33 + 0.52) * s, pz);
    dummy.updateMatrix();
    bodies[gi].setMatrixAt(filled[gi], dummy.matrix);
    filled[gi]++;

    /* 头（无脸：只是一个球，不做五官） */
    dummy.position.set(px, gy + (0.33 + 1.0) * s, pz);
    dummy.updateMatrix();
    heads.setMatrixAt(hIdx++, dummy.matrix);

    /* 斗笠或包布巾：约四成戴斗笠 */
    if (rand() < 0.5) {
      dummy.position.set(px, gy + (0.33 + 1.16) * s, pz);
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      hats.setMatrixAt(hatIdx++, dummy.matrix);
    }
  }

  for (let g = 0; g < CLOTH.length; g++) {
    skirts[g].count = filled[g];
    bodies[g].count = filled[g];
    skirts[g].castShadow = true; skirts[g].receiveShadow = true;
    bodies[g].castShadow = true; bodies[g].receiveShadow = true;
    skirts[g].instanceMatrix.needsUpdate = true;
    bodies[g].instanceMatrix.needsUpdate = true;
    worldGroups.add(skirts[g]);
    worldGroups.add(bodies[g]);
  }
  heads.count = hIdx;
  hats.count = hatIdx;
  heads.castShadow = true; hats.castShadow = true;
  heads.instanceMatrix.needsUpdate = true;
  hats.instanceMatrix.needsUpdate = true;
  worldGroups.add(heads);
  worldGroups.add(hats);

  /* 挑担行商：扁担 + 两只筐，加在个别 'carry' 的人身上 */
  for (const [px, pz, ry, pose] of people) {
    if (pose !== 'carry') continue;
    const gy = groundAt(px, pz);
    const c = Math.cos(ry), s2 = Math.sin(ry);
    /* 扁担 */
    P.cyl(0.035, 0.035, 1.9, SHC.wood, px, gy + 1.32, pz, { rz: Math.PI / 2, ry: -ry, jitter: false }, 6);
    /* 两只筐挂在扁担两端 */
    for (const side of [-1, 1]) {
      const bx = px + c * 0 - s2 * side * 0.85;
      const bz = pz + c * side * 0.85;
      P.cyl0(0.26, 0.22, 0.34, PAL.bamboo, bx, gy + 0.82, bz, { jitter: false }, 9);
      P.cyl0(0.25, 0.25, 0.03, PAL.bambooDark, bx, gy + 1.14, bz, { jitter: false }, 9);
      /* 吊绳 */
      P.cyl(0.012, 0.012, 0.32, 0xc9b48a, bx, gy + 1.2, bz, { jitter: false, bucket: 'fine' }, 5);
    }
  }
}
/* ---------- 50 · 光、地形验证诊断、交互与主循环 ----------
 * 本版是「地形验证版」：只搭底座 + 竹山 + 台地 + 山道，
 * 目的是先把站内第一个真地形验通（hillY 一致性、山高上限、阴影范围、取景）。
 * 纸坊工位、水碓、抄纸间、晾纸墙等由 20/30/40 各层随后补上。
 */

finishBucket('solid', toonMat, true);
finishBucket('fine', toonMat, false);
finishBucket('glow', glowMat, false);
finishBucket('sign', signMat, false);
finishBucket('zsign', zSignMat, false);

/* ---------- 光：白天，太阳偏西南，竹山要能投出成片林影 ---------- */
scene.add(new THREE.HemisphereLight(0xdcecd2, 0x9a9070, 1.22));
scene.add(new THREE.AmbientLight(0xe9efe0, 0.3));

const sun = new THREE.DirectionalLight(0xfff4dc, 2.6);
sun.position.set(-16, 20, 17);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
/* 山进底座后，阴影范围必须覆盖 24 米进深（shexi 只覆盖 13 米） */
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 17;
sun.shadow.camera.bottom = -17;
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.camera.updateProjectionMatrix();
sun.target.position.set(0, 1.2, -3);
scene.add(sun);
scene.add(sun.target);

/* 北侧冷补光：山背光的一面从死黑里拉回来 */
const fill = new THREE.DirectionalLight(0xc2d8ea, 0.46);
fill.position.set(10, 11, -18);
scene.add(fill);

/* ---------- 光晕贴图（后续工位会用） ---------- */
function radialTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW_TEX = radialTexture();

/* ---------- 相机：加山后要再抬高、再拉远，否则三层塌成两层 ---------- */
const cam = {
  az: 0.9, pol: 0.6, dist: 130,
  goalAz: -0.72, goalPol: 1.08, goalDist: 58,
  target: new THREE.Vector3(0, 4.5, -1.5),
};
if (window.innerWidth < window.innerHeight) {
  cam.goalAz = -0.62;
  cam.goalDist = 76;
}
const intro = { t: 0, dur: 4.4, done: SKIP_INTRO, deadline: performance.now() + 4400 };
function finishIntro() {
  if (intro.done) return;
  intro.done = true;
  cam.az = cam.goalAz; cam.pol = cam.goalPol; cam.dist = cam.goalDist;
}
for (const [key, field] of [['az', 'goalAz'], ['pol', 'goalPol'], ['dist', 'goalDist']]) {
  const v = parseFloat(QS.get(key));
  if (Number.isFinite(v)) cam[field] = v;
}
for (const [key, axis] of [['tx', 'x'], ['ty', 'y'], ['tz', 'z']]) {
  const v = parseFloat(QS.get(key));
  if (Number.isFinite(v)) cam.target[axis] = v;
}
if (SKIP_INTRO) {
  cam.az = cam.goalAz; cam.pol = cam.goalPol; cam.dist = cam.goalDist;
}

let dragging = false;
let panning = false;
let lastX = 0, lastY = 0;
let lastMid = null;
let lastInput = -999;
let NOW = 0;
const pointers = new Map();
let pinchDist = 0;

function clampTarget() {
  /* 视线中心限制在 40×24 底座范围内 */
  cam.target.x = THREE.MathUtils.clamp(cam.target.x, -20, 20);
  cam.target.z = THREE.MathUtils.clamp(cam.target.z, -12, 12);
}

/* ---------- 相机适配：供共用导览组件（tools/shared/tour.js）调用 ---------- */
const camTargetGoal = cam.target.clone();
function flyTo(v) {
  if (Number.isFinite(v.az)) cam.goalAz = v.az;
  if (Number.isFinite(v.pol)) cam.goalPol = v.pol;
  if (Number.isFinite(v.dist)) cam.goalDist = v.dist;
  if (Number.isFinite(v.tx) || Number.isFinite(v.ty) || Number.isFinite(v.tz)) {
    camTargetGoal.set(
      Number.isFinite(v.tx) ? v.tx : cam.target.x,
      Number.isFinite(v.ty) ? v.ty : cam.target.y,
      Number.isFinite(v.tz) ? v.tz : cam.target.z
    );
  }
  lastInput = NOW;                 // 别让闲置自转马上把镜头带走
}
const HOME_VIEW = {
  az: cam.goalAz, pol: cam.goalPol, dist: cam.goalDist,
  tx: cam.target.x, ty: cam.target.y, tz: cam.target.z,
};
function resetView() { flyTo(HOME_VIEW); }
/* 手动平移/走动时同步目标点，免得和插值互相拽 */
function syncTargetGoal() {
  clampTarget();
  camTargetGoal.copy(cam.target);
}
function panBy(dx, dy) {
  const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * cam.dist * fitK) / Math.max(window.innerHeight, 1);
  const rx = Math.cos(cam.az), rz = -Math.sin(cam.az);
  const fx = -Math.sin(cam.az), fz = -Math.cos(cam.az);
  cam.target.x += -rx * dx * k + fx * dy * k;
  cam.target.z += -rz * dx * k + fz * dy * k;
  syncTargetGoal();
  lastInput = NOW;
}
const held = new Set();
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
window.addEventListener('keydown', (e) => {
  const k = (e.key || '').toLowerCase();
  if (MOVE_KEYS.includes(k)) { held.add(k); lastInput = NOW; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => held.delete((e.key || '').toLowerCase()));
window.addEventListener('blur', () => held.clear());
function moveByKeys(dt) {
  if (!held.size) return;
  const sp = Math.sin(cam.az), cs = Math.cos(cam.az);
  const fx = -sp, fz = -cs, rx = cs, rz = -sp;
  let mx = 0, mz = 0;
  const speed = 10 * (cam.dist / 60);
  if (held.has('w') || held.has('arrowup')) { mx += fx; mz += fz; }
  if (held.has('s') || held.has('arrowdown')) { mx -= fx; mz -= fz; }
  if (held.has('d') || held.has('arrowright')) { mx += rx; mz += rz; }
  if (held.has('a') || held.has('arrowleft')) { mx -= rx; mz -= rz; }
  const len = Math.hypot(mx, mz);
  if (len > 0) {
    cam.target.x += (mx / len) * speed * dt;
    cam.target.z += (mz / len) * speed * dt;
    syncTargetGoal();
    lastInput = NOW;
  }
}
function onPointerDown(e) {
  finishIntro();
  try { canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* 拿不到捕获也能拖动 */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = true;
  panning = e.button === 2 || e.button === 1 || e.shiftKey;
  lastX = e.clientX; lastY = e.clientY;
  lastInput = NOW;
  canvas.classList.add('grabbing');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastInput = NOW;
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) cam.goalDist = THREE.MathUtils.clamp(cam.goalDist * (pinchDist / Math.max(d, 1)), 10, 160);
    pinchDist = d;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (lastMid) panBy(mid.x - lastMid.x, mid.y - lastMid.y);
    lastMid = mid;
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (panning) { panBy(dx, dy); return; }
  cam.goalAz -= dx * 0.0055;
  cam.goalPol = THREE.MathUtils.clamp(cam.goalPol - dy * 0.0042, 0.16, 1.42);
}
function onPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) { dragging = false; panning = false; canvas.classList.remove('grabbing'); }
  pinchDist = 0;
  lastMid = null;
}
canvas.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  finishIntro();
  cam.goalDist = THREE.MathUtils.clamp(cam.goalDist * Math.exp(e.deltaY * 0.0011), 10, 160);
  lastInput = NOW;
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function updateCamera(dt, now) {
  if (intro.done) {
    cam.dist += (cam.goalDist - cam.dist) * Math.min(1, dt * 5);
    cam.az += (cam.goalAz - cam.az) * Math.min(1, dt * 5);
    cam.pol += (cam.goalPol - cam.pol) * Math.min(1, dt * 5);
    /* 看点也插值，点热点飞过去才顺 */
    cam.target.lerp(camTargetGoal, Math.min(1, dt * 3.2));
    clampTarget();
    if (now - lastInput > 6) cam.goalAz += dt * 0.06;
  } else {
    intro.t = Math.max(intro.t + dt, (performance.now() - (intro.deadline - intro.dur * 1000)) / 1000);
    const k = 1 - Math.pow(1 - Math.min(1, intro.t / intro.dur), 3);
    cam.az = THREE.MathUtils.lerp(0.9, cam.goalAz, k);
    cam.pol = THREE.MathUtils.lerp(0.6, cam.goalPol, k);
    cam.dist = THREE.MathUtils.lerp(130, cam.goalDist, k);
    cam.target.copy(camTargetGoal);
    if (intro.t >= intro.dur || performance.now() >= intro.deadline) finishIntro();
  }
  const d = cam.dist * fitK;
  const sp = Math.sin(cam.pol), cp = Math.cos(cam.pol);
  camera.position.set(
    cam.target.x + Math.sin(cam.az) * sp * d,
    cam.target.y + cp * d,
    cam.target.z + Math.cos(cam.az) * sp * d
  );
  camera.lookAt(cam.target);
}

/* ---------- 主循环 ---------- */
const HOLD = parseFloat(QS.get('hold'));
const clockAssemble = { t: 0 };
let firstFrame = true;
function frame() {
  tickTime();
  const dt = timeState.delta;
  const now = timeState.elapsed;
  NOW = now;

  if (Number.isFinite(HOLD)) {
    U.assemble.value = HOLD;
  } else if (U.assemble.value < 1) {
    clockAssemble.t += dt;
    U.assemble.value = Math.min(1, clockAssemble.t / 3.6);
  }
  U.time.value = now;

  /* ---- 动效（少而准，5 处） ---- */

  /* 1. 卧轮在水渠里持续转动（水推着走）
     转速 omega 同时驱动传动轴上的拨木与碓杆，三者必须同一个角速度——
     否则轮子转、杆子动，但两者对不上，一眼假。 */
  const omega = 0.9;
  if (millParts.wheel) millParts.wheel.rotation.z = -now * omega;

  /* 1b. 传动轴上的拨木：跟着轴一起转（拨木打到碓杆尾端，杆才被压下去） */
  if (millParts.pins) {
    for (const p of millParts.pins) p.g.rotation.x = now * omega;
  }

  /* 2. 碓杆绕支点起落：**由拨木的转角驱动**，而不是各自独立地 sin 一下。
     这样「轮转 → 拨木压杆 → 碓头砸臼」在时序上是对上的。 */
  for (const h of millParts.hammers) {
    const phase = now * omega + h.phase;
    /* 拨木每转一圈压杆一次，所以频率是轴转角的 1 倍；
       只在拨木朝下那半圈把杆压下去，其余时间靠自重回落。 */
    const push = Math.max(0, Math.cos(phase));
    h.g.rotation.z = push * 0.30 - 0.15;
  }

  /* 3. 抄纸匠人荡帘打浪：手臂与纸帘前后起落 */
  for (const a of vatParts.arms) {
    a.pivot.rotation.x = Math.sin(now * 1.5 + a.phase) * 0.42 - 0.22;
  }

  /* 4. 晾纸墙上的纸边被风轻轻掀起
     每帧都按基准位置重算，不要在上一帧矩阵上做增量——那会累积漂移，
     初版就是这样把纸慢慢拧歪、最后看不见的。 */
  if (wallParts.group && wallParts.papers.length) {
    const dummy = wallParts.dummy || (wallParts.dummy = new THREE.Object3D());
    const arr = wallParts.group.instanceMatrix.array;
    for (let i = 0; i < wallParts.papers.length; i++) {
      const p = wallParts.papers[i];
      const s = Math.sin(now * 1.3 + p.phase);
      /* 绕底边掀起：位置微抬 + 绕 X 轴一点点转，视觉上就是纸边翘起来 */
      dummy.position.set(p.x, p.y + Math.abs(s) * 0.012, p.z + Math.abs(s) * 0.02);
      dummy.rotation.set(s * 0.055, s * 0.03, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dummy.matrix.toArray(arr, i * 16);
    }
    wallParts.group.instanceMatrix.needsUpdate = true;
  }

  /* 5. 竹梢成片轻晃（低强度底噪，不占「5 处」名额） */
  for (const m of bambooSway) {
    m.rotation.z = Math.sin(now * 0.62 + m.userData.swayPhase) * 0.012;
  }

  /* 6. 溪面的水纹往东流：两层反向滚动（低强度底噪） */
  for (const r of ZH_WATER.ripples) {
    r.tex.offset.x = (r.tex.offset.x + r.speed * dt) % 1;
  }

  moveByKeys(dt);
  updateCamera(dt, now);
  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    const boot = document.getElementById('boot');
    if (boot) {
      if (SHOT) boot.style.display = 'none';
      else boot.classList.add('gone');
    }
    window.__MINS_READY = true;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* 地形验证诊断：山高实测值必须 ≤ 8 米，否则就是顶破了底座轮廓 */
function sampleHillMax() {
  let m = 0, at = [0, 0];
  for (let x = -ZA.halfX; x <= ZA.halfX; x += 0.5) {
    for (let z = ZA.ridgeZ; z <= ZA.hillToe; z += 0.5) {
      const h = hillY(x, z);
      if (h > m) { m = h; at = [x, z]; }
    }
  }
  return { max: +m.toFixed(3), at };
}

window.__MINS_DIAG = () => ({
  assemble: +U.assemble.value.toFixed(3),
  drawCalls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
  camera: [cam.az, cam.pol, cam.dist].map((v) => +v.toFixed(2)),
  base: [ZA.halfX * 2, ZA.halfZ * 2],
  hill: sampleHillMax(),
  hillCap: +(ZA.halfZ * 2 / 3).toFixed(2),
});

/* 诊断用：列出实际参与渲染的对象，用于定位 draw call 是谁贡献的 */
window.__MINS_LIST = () => {
  const rows = [];
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isSprite) return;
    rows.push({
      type: o.isInstancedMesh ? 'inst' : o.isSprite ? 'sprite' : 'mesh',
      name: o.name || '',
      cls: o.material && o.material.type ? o.material.type : '',
      count: o.isInstancedMesh ? o.count : 1,
    });
  });
  return rows;
};
window.__MINS_SCENE = scene;
window.__MINS = {
  setView(o = {}) {
    for (const [key, field] of [['az', 'goalAz'], ['pol', 'goalPol'], ['dist', 'goalDist']]) {
      if (Number.isFinite(o[key])) cam[field] = o[key];
    }
    for (const [key, axis] of [['tx', 'x'], ['ty', 'y'], ['tz', 'z']]) {
      if (Number.isFinite(o[key])) cam.target[axis] = o[key];
    }
    intro.done = true;
    cam.az = cam.goalAz; cam.pol = cam.goalPol; cam.dist = cam.goalDist;
    camTargetGoal.copy(cam.target);   // 别忘了同步插值目标，否则看点会被拽回去
  },
  hillY,
};
/* ---------- 60 · 场景导览配置（竹山纸坊） ----------
 * 逻辑全在 tools/shared/tour.js；这里只描述「这个场景要讲什么」。
 * 口径：底座 40 × 24（halfX 20 / halfZ 12）。
 *   山体 z < −5 用 hillY(x,z)（0 ~ 7.6）；台地 −5 ≤ z ≤ 4.2 地面 y = 0.34；
 *   山溪 4.2 < z < 11.2，水面 y = −0.30；溪南岸画出来的岸顶 ≈ 0.02。
 *   +z 朝向观者（所有门板、匾额、敞口都朝 +z），竹山山脊贴在 z = −12 的北缘。
 *
 * 两条来自几何复核的注意事项：
 *   1) 台地是一整块实心板（顶面 0.34），沤料池内部（水面 −0.12、压石 0.14）
 *      全在板体内、从上方看不见 —— 沤料池的热点要标在池沿上方，不能标在「水面」。
 *   2) 默认机位下蔡伦神龛被纸仓东山墙整个挡住，它的机位必须从东南看（az ≈ +0.55）。
 */

const zhuzhiTour = createSceneTour(THREE, {
  scene,
  canvas,
  camera,
  /* 组装没走完先别显示金环：热点不受顶点着色器的「长出来」变形影响 */
  ready: () => U.assemble.value >= 0.999 || SHOT,

  ui: {
    masthead: '竹山纸坊',
    mastheadIndex: '竹纸制作 · 依山傍水',
    kicker: '竹纸制作技艺 · 竹山纸坊',
    title: '从一根竹子，到一张纸',
    lead: '竹纸制作技艺（Ⅷ-71，浙江富阳子项）。北面一座低矮竹山，坡下台地上一路排开纸坊的全部工位——沤料、煮料、水碓、抄纸、晒纸、入仓，一条工序线走完。',
    legend: [
      { color: '#4f7a3a', label: '竹山', note: '纸从山上来，山高卡在 7.6 米' },
      { color: '#c7bda8', label: '晒纸墙', note: '7.4 × 5.2 的白墙，全场最高人工物' },
      { color: '#8a6a44', label: '水碓', note: '溪水推卧轮，带动碓杆' },
      { color: '#6a8a9a', label: '山溪', note: '自西向东，供水碓与洗料' },
    ],
    tip: '点亮金环，镜头会飞过去并展开说明；共 12 处。本模型为原创示意，山形与工位排布为教学方便作了调整，不是实测或复原。',
    keys: [
      [{ kbd: '左键拖动' }, ' 旋转'],
      [{ kbd: '滚轮' }, '／', { kbd: '双指' }, ' 缩放'],
      [{ kbd: '右键' }, '／', { kbd: 'Shift' }, '+拖动 平移'],
      [{ kbd: 'W' }, { kbd: 'A' }, { kbd: 'S' }, { kbd: 'D' }, ' 走动'],
      [{ kbd: '点金环' }, ' 看说明'],
    ],
  },

  spots: [
    {
      id: 'hill', name: '竹山', en: 'BAMBOO HILL',
      marker: [-2.0, 7.9, -11.6],
      view: { az: -0.30, pol: 1.12, dist: 18, tx: -2.0, ty: 5.6, tz: -10.5 },
      text: '纸坊背靠的竹山，山脊最高 7.6 米——正好卡在底座短边的三分之一以内。山上成片毛竹林，一条土路折下山来，半坡留着一处伐竹点。整条工序线的起点就在这座山上。',
    },
    {
      id: 'cutting', name: '伐竹点', en: 'CUTTING SPOT',
      marker: [6.4, 3.0, -8.2],
      view: { az: -0.30, pol: 1.12, dist: 12, tx: 6.0, ty: 2.3, tz: -8.2 },
      text: '半坡清出的一小片空地：地上留着一圈齐刷刷的竹桩，几根砍倒的毛竹还没去枝，旁边码着已经捆好的竹料。嫩竹下山，就是为了进坡下的沤料池。',
    },
    {
      id: 'road', name: '上山土路', en: 'HILL ROAD',
      marker: [2.2, 1.9, -6.8],
      view: { az: 0.85, pol: 1.15, dist: 14, tx: 2.2, ty: 1.4, tz: -6.6 },
      text: '下山的土路在坡上折了两道，从伐竹点绕到山脚、再落到台地。挑竹料的人走的就是这一条——所以纸坊的工位全都贴着这条路的落点往东排。',
    },
    {
      id: 'pool', name: '沤料池', en: 'RETTING POOL',
      marker: [-15.2, 0.85, -1.2],
      view: { az: -0.15, pol: 1.20, dist: 11, tx: -15.2, ty: 0.5, tz: -1.2 },
      text: '工序的第一站：嫩竹截断后泡进池子里沤，靠微生物把竹料泡软脱胶。池子是石砌的，泡着的竹段上压着石头防浮——至少要沤上一个月，急不来。',
    },
    {
      id: 'stove', name: '煮料灶', en: 'BOILING STOVE',
      marker: [-10.4, 4.6, -1.4],
      view: { az: 0.10, pol: 1.15, dist: 14, tx: -10.4, ty: 1.8, tz: -1.4 },
      text: '沤过的竹料下大灶、加石灰一起煮，把剩下的木质素和胶质彻底煮掉。灶膛里一直有火，灶边堆着柴垛和石灰——这一站决定纸浆的成色。',
    },
    {
      id: 'mill', name: '水碓房', en: 'WATER-POWERED STAMP',
      marker: [-6.9, 1.9, 0.4],
      view: { az: 0.15, pol: 1.20, dist: 11, tx: -6.9, ty: 0.9, tz: 0.2 },
      text: '溪水引进渠里推着卧轮转，轮轴上的拨木一下一下拨动碓杆尾端，三副碓杆就绕着支点柱起落，把煮好的竹料砸成纸浆。整条工序线上唯一不靠人力的一站。',
    },
    {
      id: 'vat', name: '抄纸间', en: 'VAT HOUSE',
      marker: [-0.2, 5.1, -0.9],
      view: { az: 0.06, pol: 1.14, dist: 15, tx: -0.2, ty: 1.6, tz: -0.4 },
      text: '全场主戏：半敞开的高敞棚屋里两口方正抄纸槽，槽边立着纸帘与帘架。匠人把纸帘斜插进浆水里、再平平提起，帘上就留下一层薄浆——叫「荡帘打浪」，是富阳竹纸的独门手艺，纸的匀薄全靠这一下。',
    },
    {
      id: 'wall', name: '晒纸墙', en: 'DRYING WALL',
      marker: [6.2, 6.0, -1.0],
      view: { az: 0.12, pol: 1.15, dist: 14, tx: 6.2, ty: 3.0, tz: -1.0 },
      text: '7.4 × 5.2 米的朝南白墙，全场最高的人工物。抄好的湿纸一张张贴上去，靠日头晒干——纸边被风轻轻掀起的那排湿纸就是它。墙顶挑出一坡草棚遮雨，墙脚一道木槽接水。',
    },
    {
      id: 'barn', name: '纸仓', en: 'PAPER BARN',
      marker: [13.4, 4.9, -1.6],
      view: { az: 0.15, pol: 1.15, dist: 13, tx: 13.4, ty: 2.0, tz: -1.0 },
      text: '晒干的纸最后进仓。正面一排木门板、中间一扇敞着，里面能看见码好的纸垛——纸怕潮，所以仓是三面土墙、只留正面开门。',
    },
    {
      id: 'shrine', name: '蔡伦神龛', en: 'CAI LUN SHRINE',
      marker: [16.4, 2.95, -1.75],
      view: { az: 0.55, pol: 1.18, dist: 10, tx: 16.6, ty: 1.1, tz: -2.6 },
      text: '纸坊东头一座三面矮墙的小龛，供着纸神蔡伦——官方记载里，纸坊「一年一度祭祀蔡伦」。龛里是一尊无脸的低模坐像，龛前有香炉、两盏油灯和几条红布。形制为示意，匾上不写具体庙名。',
    },
    {
      id: 'creek', name: '山溪', en: 'MOUNTAIN CREEK',
      marker: [0.0, 0.35, 7.7],
      view: { az: -0.20, pol: 1.10, dist: 30, tx: 0.0, ty: -0.2, tz: 7.7 },
      text: '一条山溪自西向东贴着底座南缘走，占去最南的一条。水碓的动力、洗料的用水都从这儿来——纸坊为什么落在山脚溪边，答案就是它。溪上有埠头、洗料水栈和一座小石桥。',
    },
    {
      id: 'bridge', name: '溪上石桥', en: 'STONE BRIDGE',
      marker: [15.8, 1.5, 7.7],
      view: { az: 1.15, pol: 1.15, dist: 12, tx: 15.8, ty: 0.5, tz: 7.7 },
      text: '溪东头一座小石桥，桥面缓拱、两侧带栏杆，把北岸的纸坊和南岸连起来。桥不长，但从侧面才看得出那道拱——正对着看只是一条端头。',
    },
  ],

  onFlyTo(view) {
    finishIntro();          // 有人操作，先把入场结束掉
    flyTo(view);
  },
  onReset() {
    resetView();
  },
});

window.__TOUR = zhuzhiTour;