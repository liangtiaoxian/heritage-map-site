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

/* 水乡社戏 · 微缩模型（三渲二）
 * 一条河、一岸临水铺面、河上停着乌篷船，戏台一半搭在岸上一半挑在水上，
 * 台口朝向河面——看客坐在对岸的长凳上、站在水里船上看，是「隔河看戏」的样子。
 * 全部程序化建模，没有外部模型与贴图，招牌文字用 canvas 现画。
 * 由 build.mjs 拼接成一个模块：
 *   00 引导 / 10 工具（与民俗老街、坎儿井共用）/ 20 河与两岸 / 30 河台与铺面 / 40 船与杂物 / 50 动效与交互
 */

const QS = new URLSearchParams(location.search);
const SKIP_INTRO = QS.has('skip');
const SHOT = QS.has('shot');

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0xe4ecef, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
/* 水乡的空气：淡青，远处淡淡退掉 */
scene.fog = new THREE.FogExp2(0xdfe9ee, 0.0056);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 400);

const U = {
  time: { value: 0 },
  assemble: { value: 0 },
  outline: { value: 0.024 },
  dpr: { value: Math.min(window.devicePixelRatio || 1, 2) },
};

/* ---------- 尺寸口径：底座 42 × 26 米，岸在北、河在南、对岸压在最南一条 ---------- */
const SA = {
  halfX: 21, halfZ: 13,
  baseBottom: -0.8,
  deckY: 0.0,
  /* 北岸（岸）到 z = −2.2 为止，往南是水面，水面到 z = 9.8，再往南是对岸：河占 12 米 */
  bankZ: -2.2,
  farBankZ: 9.8,
  waterY: -0.285,
  /* 河台：一半落在岸上，一半挑在水上 */
  stageX: 3.4,
  stageZ: -1.9,
  stageW: 9.2,
  stageD: 5.0,
  stageY: 1.18,
  eaveY: 4.42,
  /* 北岸的临水铺面与社庙 */
  shopZ: -8.3,
  shopFront: -6.8,
  templeX: -12.6,
  templeZ: -7.3,
  plazaZ: -5.2,
  bridgeX: -16.0,
  westShopX: -19.6,
  landingX: -4.6,
  boatZ: 3.3,
};

/* 竖屏时把相机拉远，保证 42 米长的底座不被裁掉 */
let fitK = 1;
function resizeNow() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  fitK = camera.aspect >= 1 ? 1 : THREE.MathUtils.clamp(16 / Math.sin(hHalf) / 44, 1, 3.6);
  if (scene.fog) scene.fog.density = 0.0056 / Math.max(1, fitK);
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
const rand = mulberry32(20261121);
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

/* ---------- 20 · 底座、两岸、河面、河埠头、石桥 ---------- */

/* 水乡的色：青灰的石头、发绿的水、黄泥的对岸 */
const WAC = {
  waterDeep: 0x24566f, water: 0x3f7c9c, waterHi: 0x9ed0e2, waterEdge: 0x1e4c60,
  stone: 0xa9a49a, stoneDark: 0x8b877d, stoneWet: 0x7b776d, quay: 0x9b968b,
  mud: 0x9c8f74, grass: 0x86975a, reed: 0x9aa86a,
  willow: 0x5d8a4a, willowHi: 0x7cab5e, willowTwig: 0x4e763d,
  brick: 0xa2705a, ink: 0x2f2a26,
};

/* 底座：三块拼出来——北岸基座、对岸基座、河槽底。河是往下凹进去的，
   所以底座不能是一整块实心板，否则水面会被埋在板子里。三块全部按 SA 推。 */
layer(0.0);
P.box(42, 0.8, SA.halfZ + SA.bankZ, PAL.base, 0, -0.4, (SA.bankZ - SA.halfZ) / 2, { jitter: false });
P.box(42, 0.8, SA.halfZ - SA.farBankZ, PAL.base, 0, -0.4, (SA.farBankZ + SA.halfZ) / 2, { jitter: false });
P.box(42, 0.25, SA.farBankZ - SA.bankZ, PAL.base, 0, -0.675, (SA.bankZ + SA.farBankZ) / 2, { jitter: false });
/* 台沿的两道刻线压到槽底以下，别横穿河面 */
P.box(42.05, 0.05, SA.halfZ * 2 + 0.05, PAL.baseEdge, 0, -0.72, 0, { jitter: false });
P.box(42.1, 0.02, SA.halfZ * 2 + 0.1, PAL.brass, 0, -0.785, 0, { jitter: false });
P.box(2.9, 0.5, 0.03, PAL.baseEdge, 0, -0.42, SA.halfZ + 0.02, { jitter: false });
P.sign('plateShexi', 2.7, 0.47, 0, -0.42, SA.halfZ + 0.04, { delay: 0.02 });

/* ---------- 北岸：一整片青石板，铺到水边的驳岸为止 ---------- */
layer(0.05);
{
  const z0 = -(SA.halfZ - 0.4), z1 = SA.bankZ - 0.04;
  for (let z = z0; z < z1; z += 0.74) {
    const off = Math.round((z - z0) / 0.74) % 2 ? 0.6 : 0;
    for (let x = -20.8 + off; x < 20.8; x += 1.24) {
      const tone = pick([PAL.road, PAL.roadDark, 0x9aa0a2, 0x8e9497]);
      P.box(1.16, 0.06, 0.68, tone, x, 0.0, z, { jitter: true });
    }
  }
  /* 靠水一侧被水汽泡深的一条 */
  P.box(41.2, 0.008, 0.5, 0x8b9195, 0, 0.035, SA.bankZ - 0.36, { jitter: false });
  /* 青苔补丁 */
  for (let i = 0; i < 46; i++) {
    P.box(rnd(0.3, 0.9), 0.006, rnd(0.2, 0.5), PAL.moss, rnd(-20, 20), 0.034, rnd(z0 + 0.2, z1), { jitter: true });
  }
  /* 排水沟：一条暗沟沿铺面走 */
  P.box(40, 0.04, 0.16, PAL.gutter, 0, 0.02, -6.62, { jitter: false });
}

/* 北岸驳岸：石砌护岸 + 压顶石 */
layer(0.07);
{
  P.box(42, 0.9, 0.22, WAC.stoneDark, 0, -0.45, SA.bankZ, { jitter: false });
  P.box(42.1, 0.64, 0.24, WAC.quay, 0, -0.32, SA.bankZ - 0.01, { jitter: false });
  P.box(42.2, 0.14, 0.36, WAC.stone, 0, 0.06, SA.bankZ - 0.02, { jitter: false });
  for (let x = -20.6; x < 20.8; x += 1.5) {
    P.box(0.07, 0.62, 0.06, WAC.stoneWet, x, -0.34, SA.bankZ - 0.14, { jitter: false });
  }
  /* 三处小埠头：两级踏步直接下到水面 */
  for (const x of [9.4, 14.2, -8.8]) {
    P.box(1.5, 0.16, 0.5, WAC.stone, x, -0.06, SA.bankZ + 0.24, { jitter: false });
    P.box(1.5, 0.16, 0.5, WAC.stone, x, -0.22, SA.bankZ + 0.7, { jitter: false });
  }
}

/* ---------- 河面：河底、水体、中间层、一条高光带 ---------- */
/* 水要比岸上的东西先到：这样入场动画里不会先露出一层底座的颜色 */
layer(0.03);
{
  const zc = (SA.bankZ + SA.farBankZ) / 2;
  const w = SA.farBankZ - SA.bankZ;
  /* 一层比一层窄、一层比一层高：从上面看就是「深—浅—高光」三圈，
     高光那圈只留在河心，才像有天空反光的一条河 */
  P.box(42, 0.05, w - 0.02, 0x5f5f54, 0, -0.525, zc, { jitter: false, bucket: 'fine' });
  P.box(41.9, 0.16, w - 0.04, WAC.waterDeep, 0, SA.waterY - 0.1, zc, { jitter: false, bucket: 'fine' });
  P.box(41.8, 0.12, w - 1.2, WAC.water, 0, SA.waterY - 0.07, zc, { jitter: false, bucket: 'fine' });
  P.box(41.5, 0.03, w - 3.0, WAC.waterHi, 0, SA.waterY - 0.015, zc, { jitter: false, bucket: 'glow' });
  /* 两岸脚下的暗带：水挨着石岸总有一道阴影 */
  for (const z of [SA.bankZ + 0.35, SA.farBankZ - 0.35]) {
    P.box(41.8, 0.02, 0.7, WAC.waterEdge, 0, SA.waterY, z, { jitter: false, bucket: 'fine' });
  }
  /* 水面的静态涟漪：埠头与桥下各一圈 */
  for (const [x, z, r] of [[-4.6, 0.4, 0.72], [-4.2, 1.0, 0.5], [-16.0, 3.2, 0.85], [12.4, 0.5, 0.62], [17.2, 5.4, 0.55], [2.0, 7.6, 0.7]]) {
    P.torus(r, 0.028, WAC.waterHi, x, SA.waterY + 0.032, z, { rx: -Math.PI / 2, jitter: false, bucket: 'glow' }, 6, 18);
  }
  /* 水里的浮萍与两丛芦苇，靠对岸放，别挡台口 */
  for (let i = 0; i < 24; i++) {
    P.sph(rnd(0.08, 0.16), pick([0x6d8a4a, 0x7d9a52]), rnd(-19, 19), SA.waterY + 0.045, rnd(SA.farBankZ - 2.4, SA.farBankZ - 0.5), { sy: 0.22, jitter: true }, 7, 4);
  }
  for (const [x0, z0] of [[-11.6, SA.farBankZ - 1.2], [19.4, SA.farBankZ - 1.5]]) {
    for (let i = 0; i < 9; i++) {
      const x = x0 + rnd(-0.7, 0.7), z = z0 + rnd(-0.5, 0.5);
      P.cyl(0.02, 0.03, rnd(0.6, 1.1), WAC.reed, x, SA.waterY + 0.4, z, { rz: rnd(-0.18, 0.18), jitter: false }, 5);
      P.sph(0.08, WAC.reed, x, SA.waterY + 0.9, z, { sy: 0.45, jitter: false }, 6, 4);
    }
  }
  /* 四只白鹅：水面上最便宜的一点活气 */
  for (const [x, z, ry] of [[15.2, 9.0, 0.4], [16.3, 8.4, -0.7], [-9.4, 8.6, 0.2], [-10.3, 9.1, -0.5]]) {
    P.sph(0.3, 0xf2efe6, x, SA.waterY + 0.12, z, { sx: 1.35, sy: 0.7, ry, jitter: false }, 10, 7);
    P.cyl(0.05, 0.07, 0.34, 0xf2efe6, x + 0.26, SA.waterY + 0.3, z, { rz: -0.3, jitter: false }, 8);
    P.sph(0.12, 0xf2efe6, x + 0.34, SA.waterY + 0.48, z, { jitter: false }, 8, 6);
    P.box(0.12, 0.06, 0.07, 0xd9a24a, x + 0.45, SA.waterY + 0.46, z, { jitter: false });
    P.box(0.06, 0.04, 0.05, 0x3a3630, x + 0.4, SA.waterY + 0.52, z + 0.05, { jitter: false });
  }
}

/* ---------- 对岸：一条黄泥岸，是真正看戏的地方 ---------- */
layer(0.11);
{
  P.box(42, 0.8, 0.22, WAC.stoneDark, 0, -0.4, SA.farBankZ, { jitter: false });
  P.box(42.1, 0.5, 0.24, WAC.quay, 0, -0.3, SA.farBankZ + 0.01, { jitter: false });
  P.box(42.2, 0.12, 0.34, WAC.stone, 0, 0.05, SA.farBankZ + 0.02, { jitter: false });
  P.box(42, 0.5, 2.9, WAC.mud, 0, -0.25, SA.farBankZ + 1.6, { jitter: false });
  P.box(42, 0.06, 1.1, WAC.grass, 0, 0.03, SA.halfZ - 0.7, { jitter: false });
  P.box(42, 0.05, 0.9, 0x9a9268, 0, 0.03, SA.farBankZ + 1.1, { jitter: false });
  /* 岸边的杂草与几块菜地 */
  for (let i = 0; i < 34; i++) {
    const x = rnd(-20.4, 20.4), z = rnd(SA.farBankZ + 0.3, SA.halfZ - 1.0);
    P.sph(rnd(0.14, 0.26), pick([WAC.grass, 0x7d8f52, 0x94a45e]), x, 0.09, z, { sy: 0.5, sx: 1.3, jitter: true }, 6, 4);
  }
  for (const [x, w] of [[-13.6, 3.2], [-8.8, 2.6], [7.4, 3.0], [12.8, 3.4]]) {
    P.box(w, 0.08, 1.0, 0x8a7a52, x, 0.04, SA.halfZ - 0.6, { jitter: false });
    for (let i = 0; i < 5; i++) {
      P.box(0.06, 0.3, 0.06, WAC.willowTwig, x - w / 2 + 0.3 + i * (w / 5), 0.2, SA.halfZ - 0.6, { rz: rnd(-0.1, 0.1), jitter: false });
    }
  }
  /* 对岸一处石阶：看客从这儿下水、上船 */
  for (let i = 0; i < 4; i++) {
    P.box(1.8, 0.16, 0.46, WAC.stone, 1.4, -0.05 - i * 0.16, SA.farBankZ - 0.1 - i * 0.42, { jitter: false });
  }
  P.box(2.2, 0.4, 0.3, WAC.quay, 1.4, 0.22, SA.farBankZ + 0.5, { jitter: false });
}

/* ---------- 河埠头：石阶下水，系船石与洗衣台 ---------- */
layer(0.13);
{
  const x0 = SA.landingX;
  for (let i = 0; i < 6; i++) {
    P.box(2.6, 0.17, 0.44, WAC.stone, x0, -0.04 - i * 0.155, SA.bankZ + 0.26 + i * 0.42, { jitter: false });
  }
  for (const s of [-1, 1]) {
    P.box(0.2, 0.34, 2.9, WAC.quay, x0 + s * 1.4, 0.1, SA.bankZ + 1.5, { jitter: false });
    P.box(0.26, 0.12, 3.0, WAC.stone, x0 + s * 1.4, 0.31, SA.bankZ + 1.5, { jitter: false });
  }
  /* 系船石：砌在岸沿上，船就系在这儿 */
  for (const dz of [-0.2, -0.7]) {
    P.box(0.34, 0.36, 0.3, WAC.stoneDark, x0 + 1.3, -0.1, SA.bankZ + dz, { ry: rnd(-0.2, 0.2), jitter: true });
  }
  /* 洗衣台：半块石头伸进水里 */
  P.box(1.0, 0.16, 0.8, WAC.stone, x0 - 1.9, -0.22, SA.bankZ + 1.9, { jitter: false });
  P.box(0.9, 0.26, 0.7, WAC.stoneDark, x0 - 1.9, -0.42, SA.bankZ + 1.9, { jitter: false });
  P.box(0.52, 0.2, 0.4, 0x8a6a52, x0 - 1.5, -0.06, SA.bankZ + 1.6, { jitter: false });
  /* 埠头旁边的竹竿与晾着的蓝布（竿子立在岸上，布朝着河） */
  for (const dz of [0, 1.2]) {
    P.cyl0(0.05, 0.06, 2.1, PAL.bamboo, x0 - 2.9, 0.02, SA.bankZ - 1.6 + dz, {}, 7);
  }
  P.box(0.05, 0.05, 1.4, PAL.bamboo, x0 - 2.9, 2.05, SA.bankZ - 1.0, { jitter: false });
  for (let i = 0; i < 4; i++) {
    P.box(0.03, rnd(0.8, 1.1), 0.42, pick([0x3f5f80, 0x4a6f95, 0x2f4f70]), x0 - 2.9, 1.5 - i * 0.02, SA.bankZ - 1.5 + i * 0.4, { jitter: true });
  }
}

/* ---------- 石桥：跨河的缓拱石桥，是西头的一个看点 ---------- */
layer(0.04);
{
  const bx = SA.bridgeX;
  const zc = (SA.bankZ + SA.farBankZ) / 2;
  const L = (SA.farBankZ - SA.bankZ) + 0.6, rise = 1.05, yEnd = 0.5, yMid = yEnd + rise;
  /* 这一座不参与「从地里长出来」：拱上每块都带角度，组装动画的纵向压缩会把它挤成一把扇子。
     delay 给 −1，等于入场时桥已经架好了。 */
  const set = { jitter: false, delay: -1 };
  /* 桥台 */
  for (const z of [SA.bankZ + 0.25, SA.farBankZ - 0.25]) {
    P.box(2.8, 1.5, 0.8, WAC.stoneDark, bx, -0.25, z, set);
    P.box(3.0, 0.16, 1.0, WAC.stone, bx, 0.55, z, set);
  }
  /* 券石：桥洞那一圈石头，圆心压到河底以下 */
  for (let i = 0; i < 9; i++) {
    const th = 0.45 + (i / 8) * (Math.PI - 0.9);
    P.box(2.4, 0.26, 0.86, WAC.stone, bx, -1.6 + 3.0 * Math.sin(th), zc + 3.0 * Math.cos(th), { ...set, rx: th + Math.PI / 2 });
  }
  /* 桥面：13 段折出来的缓拱 */
  for (let i = 0; i < 13; i++) {
    const t = -1 + (i / 12) * 2;
    const z = zc + t * (L / 2);
    const y = yMid - rise * t * t;
    const rx = Math.atan((-4 * rise * t) / L);
    P.box(2.6, 0.2, 1.0, WAC.stone, bx, y, z, { ...set, rx });
    P.box(3.0, 0.05, 1.02, WAC.stoneWet, bx, y + 0.12, z, { ...set, rx });
    for (const s of [-1, 1]) {
      P.box(0.1, 0.34, 1.0, WAC.quay, bx + s * 1.24, y + 0.28, z, { ...set, rx });
      P.box(0.16, 0.08, 1.02, WAC.stone, bx + s * 1.24, y + 0.47, z, { ...set, rx });
    }
  }
  /* 桥头望柱与踏步 */
  for (const t of [-1, 1]) {
    const z = zc + t * (L / 2 + 0.28);
    for (const s of [-1, 1]) {
      P.box(0.26, 1.0, 0.26, WAC.stone, bx + s * 1.24, yEnd + 0.44, z, set);
      P.sph(0.17, WAC.stone, bx + s * 1.24, yEnd + 1.0, z, { ...set, sy: 1.1 }, 8, 6);
    }
    for (let i = 0; i < 3; i++) {
      P.box(2.6, 0.17, 0.42, WAC.stone, bx, 0.38 - i * 0.19, z + t * (0.5 + i * 0.4), set);
    }
  }
  /* 桥头两侧的两丛灌木 */
  for (const [x, z] of [[bx - 2.2, SA.bankZ - 0.7], [bx + 2.2, SA.farBankZ + 0.8]]) {
    for (let i = 0; i < 4; i++) {
      P.sph(rnd(0.28, 0.44), pick([WAC.willow, WAC.willowHi]), x + rnd(-0.4, 0.4), 0.3 + rnd(0, 0.3), z + rnd(-0.4, 0.4), { sy: 0.85, jitter: true }, 8, 5);
    }
  }
}
/* ---------- 30 · 河台、社庙、临水铺面、后台戏房 ---------- */

/* 反曲屋面：整片曲面做成一个几何体。
   拿「一摞板子」叠出来的坡顶，每片都会被描边割一刀，看着像百叶窗而不是屋顶。 */
function curvedSlopeGeo(xw, zEave, zRidge, yEave, rise, pow, segs, thick) {
  const hx = xw / 2;
  const pos = [];
  const top = [], bot = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = zEave + (zRidge - zEave) * t;
    const y = yEave + rise * Math.pow(t, pow);
    top.push([-hx, y, z], [hx, y, z]);
    bot.push([-hx, y - thick, z], [hx, y - thick, z]);
  }
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < segs; i++) {
    const l0 = top[i * 2], r0 = top[i * 2 + 1], l1 = top[i * 2 + 2], r1 = top[i * 2 + 3];
    const b0 = bot[i * 2], c0 = bot[i * 2 + 1], b1 = bot[i * 2 + 2], c1 = bot[i * 2 + 3];
    quad(l1, l0, r0, r1);      // 上表面（朝上）
    quad(c0, b0, b1, c1);      // 下表面（朝下）
    quad(l0, l1, b1, b0);      // 左侧
    quad(r1, r0, c0, c1);      // 右侧
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
function tileRoof(cx, xw, zf, zb, yEave, rise, opt = {}) {
  const pow = opt.pow || 1.3;
  const segs = opt.segs || 8;
  const tile = opt.tile || PAL.tile;
  const zc = (zf + zb) / 2;
  const half = zf - zc;                       // 檐口到正脊的水平距离
  const geo = curvedSlopeGeo(xw, half, 0, yEave, rise, pow, segs, 0.15);
  const pivot = [cx, 0, zc];
  addGeo(geo, tile, { x: cx, y: 0, z: zc, pivot, jitter: false });
  addGeo(geo, tile, { x: cx, y: 0, z: zc, ry: Math.PI, pivot, jitter: false });   // 后坡：同一片转 180°
  geo.dispose();
  /* 檐板与瓦当 */
  for (const [zEave, sgn] of [[zf, 1], [zb, -1]]) {
    P.box(xw + 0.06, 0.16, 0.14, PAL.woodDark, cx, yEave - 0.03, zEave, { jitter: false });
    for (let x = cx - xw / 2 + 0.22; x < cx + xw / 2; x += 0.26) {
      P.cyl(0.058, 0.058, 0.07, PAL.tileEdge, x, yEave - 0.05, zEave + sgn * 0.06, { rx: Math.PI / 2, jitter: false }, 7);
    }
  }
  /* 正脊与脊头 */
  P.box(xw + 0.12, 0.2, 0.3, PAL.ridge, cx, yEave + rise + 0.05, zc, { jitter: false });
  for (const s of [-1, 1]) {
    P.box(0.16, 0.4, 0.28, PAL.ridge, cx + s * (xw / 2), yEave + rise + 0.16, zc, { rz: s * 0.32, jitter: false });
  }
  /* 翼角起翘：贴着檐口挑出来，不要飘在屋顶外面 */
  if (opt.corner !== false) {
    for (const sx of [-1, 1]) {
      for (const [zEave, sz] of [[zf, -1], [zb, 1]]) {
        P.box(0.62, 0.11, 0.3, PAL.tileEdge, cx + sx * (xw / 2 - 0.08), yEave + 0.04, zEave + sz * 0.1, { rz: sx * 0.3, jitter: false });
        P.box(0.26, 0.24, 0.24, PAL.tile, cx + sx * (xw / 2 + 0.02), yEave + 0.17, zEave + sz * 0.14, { rz: sx * 0.38, jitter: false });
      }
    }
  }
}

/* 格扇窗 / 板窗：竖横棂条，朝 +z */
function latticeZ(cx, cy, cz, w, h, cols, rows, c = PAL.woodDark) {
  P.box(w + 0.14, 0.1, 0.1, c, cx, cy + h / 2, cz, { jitter: false });
  P.box(w + 0.14, 0.1, 0.1, c, cx, cy - h / 2, cz, { jitter: false });
  P.box(0.1, h, 0.1, c, cx - w / 2, cy, cz, { jitter: false });
  P.box(0.1, h, 0.1, c, cx + w / 2, cy, cz, { jitter: false });
  for (let i = 1; i < cols; i++) {
    P.box(0.05, h, 0.05, c, cx - w / 2 + (w * i) / cols, cy, cz, { jitter: false });
  }
  for (let j = 1; j < rows; j++) {
    P.box(w, 0.05, 0.05, c, cx, cy - h / 2 + (h * j) / rows, cz, { jitter: false });
  }
}

/* 纸灯笼：鼓腹、上下金箍、流苏，挂哪儿都好看 */
function paperLantern(x, y, z, r = 0.24, color = PAL.lantern, glow = 0) {
  P.sph(r, color, x, y, z, { sy: 1.16, jitter: false }, 10, 8);
  for (const dy of [-r * 1.1, r * 1.1]) {
    P.cyl(r * 0.52, r * 0.52, 0.06, PAL.brass, x, y + dy, z, { jitter: false }, 10);
  }
  P.cyl(0.018, 0.018, 0.34, 0x6b3a2a, x, y + r * 1.35, z, { jitter: false }, 5);
  P.box(0.04, 0.2, 0.04, 0xc23a2c, x, y - r * 1.45, z, { jitter: false });
  if (glow > 0) glowPts.push([x, y, z, glow, 0xffb469, 0.36]);
}

/* ---------- 河台：一半落岸、一半挑水，台口朝河 ---------- */
const TAI = SA.stageY + 0.16;   // 台面标高
layer(0.17);
{
  const SX = SA.stageX, SZ = SA.stageZ, SW = SA.stageW;
  const zBack = SZ - SA.stageD / 2;      // −3.4：台基后沿
  const zFront = SZ + SA.stageD / 2;     // +1.6：台面前挑前沿
  /* 台基：只砌在岸上那一段 */
  const zBase = (zBack + SA.bankZ) / 2, dBase = SA.bankZ - zBack;
  P.box(SW, SA.stageY, dBase, WAC.stone, SX, SA.stageY / 2, zBase, { jitter: false });
  P.box(SW + 0.2, 0.22, dBase + 0.2, WAC.stoneDark, SX, 0.11, zBase, { jitter: false });
  for (const y of [0.42, 0.82]) {
    P.box(SW + 0.06, 0.04, dBase + 0.06, WAC.stoneWet, SX, y, zBase, { jitter: false });
  }
  /* 台面：一整片木板，从后沿一直挑到水面上 */
  P.box(SW + 0.5, 0.16, SA.stageD + 0.3, PAL.woodLight, SX, SA.stageY + 0.08, SZ, { jitter: false });
  P.box(SW + 0.62, 0.1, SA.stageD + 0.42, PAL.woodDark, SX, SA.stageY + 0.02, SZ, { jitter: false });
  /* 水里的两根石柱 + 斜撑：挑出来的台面得有东西托 */
  for (const sx of [-1, 1]) {
    const px = SX + sx * 3.9;
    const zPier = zFront - 0.55;
    P.cyl(0.17, 0.21, 2.15, WAC.stone, px, -0.85 + 1.075, zPier, { jitter: false }, 10);
    P.box(0.16, 0.16, 1.1, PAL.woodDark, px, SA.stageY - 0.12, zPier - 0.52, { rx: 0.62, jitter: false });
    P.box(0.26, 0.14, 0.3, WAC.stoneWet, px, SA.waterY - 0.12, zPier, { jitter: false });
  }
  /* 台后上台的踏步 */
  for (let i = 0; i < 4; i++) {
    P.box(2.6, 0.34, 0.44, WAC.stone, SX + 2.6, 0.17 + i * 0.335, zBack - 0.3 - i * 0.44, { jitter: false });
  }
  /* 四根台柱、柱础、檐枋 */
  const colTop = SA.eaveY - 0.14;
  for (const sx of [-1, 1]) {
    for (const [z, dz] of [[zFront - 0.25, 0], [zBack + 0.3, 1]]) {
      const px = SX + sx * 4.15;
      P.cyl(0.26, 0.3, 0.18, WAC.stoneDark, px, TAI + 0.09, z, { jitter: false }, 12);
      P.cyl0(0.15, 0.17, colTop - TAI, 0xa8352c, px, TAI + 0.18, z, {}, 12);
      P.cyl(0.2, 0.2, 0.12, 0x8e2620, px, colTop - 0.1, z, { jitter: false }, 12);
      if (dz === 0) {
        /* 台口的抱柱与雀替 */
        P.box(0.34, 0.42, 0.2, 0x8e2620, px + sx * -0.3, colTop - 0.34, z, { rz: sx * 0.5, jitter: false });
      }
    }
  }
  P.box(SW + 0.9, 0.3, 0.28, 0xa8352c, SX, colTop + 0.16, zFront - 0.25, { jitter: false });
  P.box(SW + 0.9, 0.3, 0.28, 0xa8352c, SX, colTop + 0.16, zBack + 0.3, { jitter: false });
  for (const sx of [-1, 1]) {
    P.box(0.28, 0.3, SA.stageD - 0.5, 0xa8352c, SX + sx * 4.15, colTop + 0.16, SZ, { jitter: false });
  }
  /* 挂落：檐枋下的一排小牙子 */
  for (let x = SX - 3.6; x <= SX + 3.6; x += 0.6) {
    P.box(0.34, 0.22, 0.14, 0x8e2620, x, colTop - 0.06, zFront - 0.25, { jitter: false });
  }
  /* 屋面：水乡戏台的高屋顶，四角起翘 */
  tileRoof(SX, SW + 0.8, zFront + 0.45, zBack - 0.45, SA.eaveY, 0.95, { pow: 1.25, segs: 9 });
  /* 匾额与楹联（挂在台口，朝河） */
  P.sign('pShe', 2.3, 0.66, SX, colTop - 0.5, zFront - 0.1, { delay: 0.34 });
  P.sign('duiA', 0.54, 2.2, SX - 4.15, TAI + 1.5, zFront - 0.03, { delay: 0.36 });
  P.sign('duiB', 0.54, 2.2, SX + 4.15, TAI + 1.5, zFront - 0.03, { delay: 0.36 });
  /* 台上：台毯、守旧、一桌二椅、锣鼓架 */
  P.box(6.2, 0.03, 3.6, 0xa8261e, SX, TAI + 0.02, SZ - 0.2, { jitter: false });
  P.box(6.0, 0.02, 3.4, 0xbc3a2c, SX, TAI + 0.04, SZ - 0.2, { jitter: false });
  /* 守旧（背景幕布）一直顶到檐下，别在幕顶和屋檐之间留一条黑缝 */
  P.box(7.6, 2.9, 0.08, PAL.wallOchre, SX, TAI + 1.5, zBack + 0.5, { jitter: false });
  P.box(7.7, 0.26, 0.12, 0x8e2620, SX, TAI + 2.96, zBack + 0.5, { jitter: false });
  for (const sx of [-1, 1]) {
    P.box(0.9, 2.9, 0.1, 0x8e2620, SX + sx * 4.2, TAI + 1.5, zBack + 0.56, { jitter: false });
  }
  /* 顶棚：把屋顶底面盖住，台上不至于发黑 */
  P.box(7.9, 0.08, 4.5, PAL.woodLight, SX, SA.eaveY - 0.12, SZ - 0.2, { jitter: false });
  /* 一桌二椅 */
  P.box(1.6, 0.07, 0.9, PAL.woodDark, SX - 0.5, TAI + 0.72, SZ - 1.9, { jitter: false });
  for (const [dx, dz] of [[-0.7, -0.36], [0.7, -0.36], [-0.7, 0.36], [0.7, 0.36]]) {
    P.box(0.08, 0.72, 0.08, PAL.wood, SX - 0.5 + dx, TAI + 0.36, SZ - 1.9 + dz, { jitter: false });
  }
  for (const sx of [-1, 1]) {
    P.box(0.5, 0.06, 0.44, PAL.wood, SX + sx * 1.3, TAI + 0.42, SZ - 2.2, { jitter: false });
    P.box(0.46, 0.72, 0.06, 0x7a5236, SX + sx * 1.3, TAI + 0.72, SZ - 2.42, { jitter: false });
    for (const [dx, dz] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.16], [0.2, 0.16]]) {
      P.box(0.06, 0.42, 0.06, PAL.wood, SX + sx * 1.3 + dx, TAI + 0.21, SZ - 2.2 + dz, { jitter: false });
    }
  }
  /* 锣鼓架：板鼓、大锣、铙钹 */
  P.box(0.9, 0.06, 0.6, PAL.woodDark, SX + 2.9, TAI + 0.66, SZ - 1.4, { jitter: false });
  for (const [dx, dz] of [[-0.36, -0.22], [0.36, -0.22], [-0.36, 0.22], [0.36, 0.22]]) {
    P.box(0.06, 0.66, 0.06, PAL.wood, SX + 2.9 + dx, TAI + 0.33, SZ - 1.4 + dz, { jitter: false });
  }
  P.cyl(0.17, 0.19, 0.2, 0x8a5a3a, SX + 2.9, TAI + 0.79, SZ - 1.4, { jitter: false }, 12);
  P.torus(0.3, 0.045, 0xc4a05a, SX + 2.9, TAI + 1.2, SZ - 1.9, { rx: 0.3, jitter: false }, 6, 16);
  P.cyl(0.2, 0.2, 0.04, 0xc4a05a, SX + 2.5, TAI + 1.16, SZ - 1.9, { rx: 1.1, jitter: false }, 12);
  /* 台口两面小旗（旗架立在台柱边） */
  for (const sx of [-1, 1]) {
    P.cyl0(0.04, 0.05, 2.0, PAL.woodDark, SX + sx * 4.6, TAI, zFront - 0.9, {}, 6);
    P.box(0.5, 0.34, 0.02, pick([0xc23a2c, 0xd9a24a]), SX + sx * 4.85, TAI + 1.7, zFront - 0.9, { jitter: false });
  }
  /* 台前石灯与长凳：立在岸上，别插进河里 */
  for (const sx of [-1, 1]) {
    const lz = SA.bankZ - 0.7;
    P.box(0.5, 0.3, 0.5, WAC.stoneDark, SX + sx * 5.3, 0.15, lz, { jitter: false });
    P.cyl(0.15, 0.19, 0.5, WAC.stone, SX + sx * 5.3, 0.55, lz, { jitter: false }, 8);
    P.box(0.44, 0.4, 0.44, PAL.paper, SX + sx * 5.3, 1.0, lz, { jitter: false });
    P.box(0.5, 0.08, 0.5, PAL.tile, SX + sx * 5.3, 1.24, lz, { jitter: false });
    glowPts.push([SX + sx * 5.3, 1.0, lz, 0.7, 0xffd9a0, 0.3]);
  }
  /* 檐下两盏大红灯笼 */
  paperLantern(SX - 3.3, colTop - 0.62, zFront - 0.5, 0.3, PAL.lantern, 1.3);
  paperLantern(SX + 3.3, colTop - 0.62, zFront - 0.5, 0.3, PAL.lantern, 1.3);
}

/* ---------- 社庙：台口对着河，庙门朝着戏台那一侧，酬神而演剧 ---------- */
layer(0.2);
{
  const TX = SA.templeX, TZ = SA.templeZ;
  P.box(5.0, 0.35, 4.0, WAC.stone, TX, 0.175, TZ, { jitter: false });
  P.box(5.2, 0.14, 4.2, WAC.stoneDark, TX, 0.07, TZ, { jitter: false });
  P.box(4.4, 2.5, 3.2, PAL.plaster, TX, 1.6, TZ, { jitter: false });
  P.box(4.6, 0.22, 3.4, PAL.plasterDeep, TX, 0.35, TZ, { jitter: false });
  /* 门洞、红门、门枕石 */
  P.box(1.5, 2.0, 0.14, 0x3a3128, TX, 1.35, TZ + 1.62, { jitter: false });
  for (const s of [-1, 1]) {
    P.box(0.68, 1.94, 0.1, 0x8e2620, TX + s * 0.37, 1.32, TZ + 1.7, { jitter: false });
    P.box(0.1, 0.1, 0.1, PAL.brass, TX + s * 0.13, 1.4, TZ + 1.76, { jitter: false });
    P.box(0.3, 0.3, 0.5, WAC.stoneDark, TX + s * 0.85, 0.15, TZ + 1.72, { jitter: false });
  }
  P.sign('pShemiao', 1.6, 0.46, TX, 2.62, TZ + 1.66, { delay: 0.4 });
  /* 屋面 */
  tileRoof(TX, 5.2, TZ + 1.9, TZ - 1.9, 3.1, 0.8, { pow: 1.4 });
  /* 庙前：香炉、石鼓、供桌 */
  P.box(2.0, 0.18, 1.0, WAC.stone, TX, 0.09, TZ + 2.9, { jitter: false });
  P.box(1.8, 0.8, 0.8, PAL.woodDark, TX, 0.58, TZ + 2.9, { jitter: false });
  P.cyl(0.5, 0.42, 0.5, 0x6f6a5e, TX, 1.23, TZ + 2.9, { jitter: false }, 14);
  P.cyl(0.54, 0.54, 0.1, 0x5a554a, TX, 1.5, TZ + 2.9, { jitter: false }, 14);
  for (const s of [-1, 1]) {
    P.box(0.1, 0.22, 0.1, 0x5a554a, TX + s * 0.46, 1.66, TZ + 2.9, { rz: s * 0.3, jitter: false });
  }
  for (const [dx, dz] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) {
    P.cyl(0.09, 0.07, 0.42, 0x5a554a, TX + dx, 0.78, TZ + 2.9 + dz, { jitter: false }, 8);
  }
  for (const s of [-1, 1]) {
    P.cyl(0.34, 0.34, 0.22, WAC.stoneDark, TX + s * 2.5, 0.11, TZ + 2.6, { jitter: false }, 12);
    P.sph(0.34, WAC.stone, TX + s * 2.5, 0.28, TZ + 2.6, { sy: 0.55, jitter: false }, 10, 6);
  }
  P.sign('noticeShexi', 0.66, 0.53, TX + 1.9, 1.45, TZ + 1.78, { delay: 0.44 });
  P.cyl0(0.045, 0.05, 1.7, PAL.woodDark, TX + 1.9, 0, TZ + 1.78, {}, 6);
}

/* ---------- 北岸的临水铺面：门脸一律朝河 ---------- */
layer(0.23);
function riverShop(u) {
  const { x, w, d, name, twoStory } = u;
  const zf = SA.shopFront, zb = zf - d;      // 门脸在 −6.8，往北是进深
  const zc = (zf + zb) / 2;
  const h = twoStory ? 2.4 : 2.5;
  P.box(w + 0.3, 0.3, d + 0.3, WAC.stone, x, 0.15, zc, { jitter: false });
  P.box(w, h, 0.26, PAL.plasterDeep, x, 0.3 + h / 2, zb + 0.13, { jitter: false });
  for (const s of [-1, 1]) {
    P.box(0.42, h, d - 0.4, PAL.plaster, x + s * (w / 2 - 0.21), 0.3 + h / 2, zc, { jitter: false });
  }
  P.box(w - 0.9, 0.06, d - 0.5, 0x8a6a52, x, 0.33, zc, { jitter: false });
  /* 柜台与货架：门脸开着，能看见店里 */
  P.box(w - 1.4, 0.9, 0.5, PAL.wood, x, 0.78, zf - 0.5, { jitter: false });
  P.box(w - 1.2, 0.08, 0.62, PAL.woodLight, x, 1.27, zf - 0.5, { jitter: false });
  for (let r = 0; r < 3; r++) {
    P.box(w - 1.2, 0.06, 0.34, PAL.wood, x, 0.9 + r * 0.66, zb + 0.5, { jitter: false });
    for (let i = 0; i < 4; i++) {
      P.box(0.22, 0.3, 0.24, pick([PAL.ceramic, PAL.ochre, 0xa8352c, PAL.jade]), x - w / 2 + 0.7 + i * ((w - 1.4) / 3), 1.05 + r * 0.66, zb + 0.5, { jitter: true });
    }
  }
  /* 檐下灯笼与幌子 */
  paperLantern(x - w / 2 + 0.7, 3.1, zf + 0.18, 0.22, PAL.lantern, 0.9);
  P.sign(name, 0.46, 1.1, x + w / 2 - 0.7, 2.05, zf + 0.12, { delay: 0.4 });
  P.cyl0(0.035, 0.04, 0.9, PAL.woodDark, x + w / 2 - 0.7, 2.5, zf + 0.12, {}, 6);
  /* 屋面 */
  if (twoStory) {
    P.box(w, 0.24, d - 0.2, PAL.wood, x, 2.86, zc, { jitter: false });
    P.box(w - 1.0, 1.7, 0.24, PAL.plaster, x, 3.8, zb + 0.2, { jitter: false });
    for (const s of [-1, 1]) {
      P.box(0.4, 1.7, d - 0.6, PAL.plaster, x + s * (w / 2 - 0.2), 3.8, zc, { jitter: false });
    }
    P.box(w - 0.9, 0.08, 1.1, PAL.wood, x, 2.98, zf - 0.35, { jitter: false });
    for (let i = 0; i < 6; i++) {
      P.box(0.07, 0.7, 0.07, PAL.woodDark, x - w / 2 + 0.5 + i * ((w - 1.0) / 5), 3.32, zf - 0.86, { jitter: false });
    }
    P.box(w - 0.9, 0.08, 0.1, PAL.woodDark, x, 3.68, zf - 0.86, { jitter: false });
    latticeZ(x - w / 4, 3.8, zf - 0.1, 0.9, 1.1, 2, 2);
    latticeZ(x + w / 4, 3.8, zf - 0.1, 0.9, 1.1, 2, 2);
    tileRoof(x, w + 0.6, zf + 0.35, zb - 0.35, 4.72, 0.7, { pow: 1.4 });
  } else {
    P.box(w, 0.24, d - 0.2, PAL.wood, x, 2.86, zc, { jitter: false });
    latticeZ(x - w / 4, 2.05, zf - 0.08, 1.0, 1.0, 2, 2);
    latticeZ(x + w / 4, 2.05, zf - 0.08, 1.0, 1.0, 2, 2);
    tileRoof(x, w + 0.6, zf + 0.35, zb - 0.35, 3.14, 0.66, { pow: 1.4 });
  }
}
/* 三间铺面连着排：相邻屋面接上，成一条连续的瓦顶 */
riverShop({ x: 10.8, w: 3.6, d: 3.0, name: 'bCha', twoStory: true });
riverShop({ x: 14.4, w: 3.6, d: 3.0, name: 'bGao' });
riverShop({ x: 18.0, w: 3.6, d: 3.0, name: 'bZhu' });

/* 西头一间临水面棚：四根柱子一片布棚，灶上一直冒着气 */
layer(0.25);
{
  const x = SA.westShopX, z = -7.6, w = 3.2, d = 3.0;
  P.box(w + 0.4, 0.24, d + 0.4, WAC.stone, x, 0.12, z, { jitter: false });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      P.cyl0(0.08, 0.1, 2.5, PAL.wood, x + sx * (w / 2 - 0.2), 0.24, z + sz * (d / 2 - 0.2), {}, 8);
    }
  }
  P.box(w + 0.9, 0.1, d + 0.9, PAL.cloth, x, 2.78, z, { rx: 0.06, jitter: false });
  P.box(w + 0.7, 0.08, d + 0.7, PAL.clothRed, x, 2.66, z, { rx: 0.06, jitter: false });
  for (let i = 0; i < 5; i++) {
    P.box(w + 0.9, 0.06, 0.1, i % 2 ? PAL.cloth : PAL.clothRed, x, 2.72, z - d / 2 - 0.35 + i * ((d + 0.7) / 4), { jitter: false });
  }
  /* 灶台、锅、烟囱、水缸 */
  P.box(1.2, 0.7, 0.9, WAC.brick, x - 0.7, 0.59, z - 0.5, { jitter: false });
  P.cyl(0.42, 0.42, 0.18, 0x3a3630, x - 0.7, 1.03, z - 0.5, { jitter: false }, 14);
  P.cyl(0.34, 0.34, 0.12, 0x5a554a, x - 0.7, 1.12, z - 0.5, { jitter: false }, 14);
  P.box(0.4, 1.5, 0.4, WAC.brick, x - 1.2, 1.7, z - 0.9, { jitter: false });
  P.cyl(0.36, 0.3, 0.7, 0x7a6a52, x + 1.0, 0.6, z + 0.9, { jitter: false }, 12);
  /* 两张矮桌与四条凳 */
  for (const [dx, dz, ry] of [[0.5, 0.6, 0.2], [1.1, -0.7, -0.3]]) {
    P.box(1.0, 0.06, 0.8, PAL.woodLight, x + dx, 0.78, z + dz, { ry, jitter: false });
    for (const s of [-1, 1]) {
      P.box(0.08, 0.75, 0.08, PAL.wood, x + dx + s * 0.4, 0.4, z + dz, { ry, jitter: false });
    }
    P.box(0.32, 0.06, 0.3, PAL.wood, x + dx, 0.45, z + dz + 0.66, { ry, jitter: false });
    P.box(0.32, 0.06, 0.3, PAL.wood, x + dx, 0.45, z + dz - 0.66, { ry, jitter: false });
  }
  P.sign('bMian', 0.46, 1.1, x + w / 2 + 0.3, 1.75, z + d / 2 + 0.1, { delay: 0.42 });
  P.cyl0(0.035, 0.04, 0.95, PAL.woodDark, x + w / 2 + 0.3, 2.2, z + d / 2 + 0.1, {}, 6);
  glowPts.push([x - 0.7, 1.15, z - 0.5, 0.8, 0xffd9a0, 0.24]);
}

/* ---------- 后台戏房：戏班扮装的地方，紧挨着河台后面 ---------- */
layer(0.27);
{
  const x = 7.4, z = -5.4, w = 2.8, d = 2.4;
  P.box(w + 0.3, 0.24, d + 0.3, WAC.stone, x, 0.12, z, { jitter: false });
  P.box(w, 2.2, 0.24, PAL.plaster, x, 1.34, z - d / 2 + 0.12, { jitter: false });
  for (const s of [-1, 1]) {
    P.box(0.3, 2.2, d - 0.5, PAL.plaster, x + s * (w / 2 - 0.15), 1.34, z, { jitter: false });
  }
  P.box(w, 1.9, 0.22, PAL.plasterDeep, x, 1.2, z + d / 2 - 0.11, { jitter: false });
  P.box(1.0, 1.8, 0.08, 0x8e2620, x, 1.1, z + d / 2 + 0.02, { jitter: false });
  P.box(1.2, 0.2, 0.14, PAL.woodDark, x, 2.06, z + d / 2 + 0.02, { jitter: false });
  tileRoof(x, w + 0.6, z + d / 2 + 0.35, z - d / 2 - 0.35, 2.5, 0.55, { pow: 1.35, segs: 5 });
  /* 门口两只衣箱与一根挑着戏服的竹竿 */
  for (const [dx, dz] of [[-0.9, 0.6], [0.9, 0.5]]) {
    P.box(0.7, 0.5, 0.5, pick([0x8a5a3a, 0xa8352c]), x + dx, 0.49, z + d / 2 + dz, { ry: rnd(-0.2, 0.2), jitter: true });
    P.box(0.74, 0.07, 0.54, PAL.woodDark, x + dx, 0.77, z + d / 2 + dz, { jitter: false });
  }
  P.cyl0(0.045, 0.05, 2.4, PAL.bamboo, x + 1.7, 0, z + 1.1, {}, 6);
  P.box(1.5, 0.06, 0.06, PAL.bamboo, x + 2.4, 2.32, z + 1.1, { jitter: false });
  for (let i = 0; i < 3; i++) {
    P.box(0.06, rnd(0.9, 1.2), 0.5, pick([0x2f4f70, 0x8e2620, 0xd9c39a]), x + 1.9 + i * 0.42, 1.7, z + 1.1, { jitter: true });
  }
}
/* ---------- 40 · 柳树、摊位、乌篷船、看戏的人 ---------- */

/* 垂柳：水乡的树都得会垂 */
function willow(x, z, s = 1) {
  P.box(1.1 * s, 0.1, 1.1 * s, WAC.stone, x, 0.05, z, { jitter: false });
  P.cyl(0.34 * s, 0.4 * s, 0.2, WAC.stoneDark, x, 0.13, z, { jitter: false }, 10);
  P.cyl0(0.13 * s, 0.24 * s, 1.6 * s, PAL.trunk, x, 0.2, z, { rx: 0.05, jitter: false }, 9);
  for (const [dx, dy, dz, rz, rx] of [[-0.5, 1.5, 0.2, 0.72, 0.2], [0.52, 1.4, -0.16, -0.66, -0.16], [0.08, 1.75, 0.34, 0.24, 0.3]]) {
    P.cyl(0.04 * s, 0.1 * s, 1.05 * s, PAL.trunk, x + dx * s, (0.2 + dy) * s + 0.4, z + dz * s, { rz, rx, jitter: false }, 7);
  }
  const canopy = [[0, 2.75, 0, 1.05], [-0.85, 2.55, 0.12, 0.72], [0.8, 2.6, -0.1, 0.78], [0.1, 3.05, 0.22, 0.72], [-0.3, 2.35, -0.66, 0.6]];
  for (const [dx, dy, dz, r] of canopy) {
    P.sph(r * s, WAC.willow, x + dx * s, dy * s, z + dz * s, { sy: 0.66, jitter: true }, 9, 6);
    P.sph(r * 0.6 * s, WAC.willowHi, x + dx * s - 0.08, (dy + r * 0.4) * s, z + dz * s + 0.04, { sy: 0.5 }, 7, 5);
  }
  /* 垂下来的柳条：细长条 + 尖上一小簇叶 */
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd(-0.1, 0.1);
    const rr = rnd(0.6, 1.5) * s;
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr * 0.85;
    const len = rnd(0.9, 1.9) * s;
    P.box(0.035, len, 0.035, WAC.willowTwig, px, 2.6 * s - len / 2 + rnd(-0.2, 0.3), pz, { rz: rnd(-0.18, 0.18), rx: rnd(-0.16, 0.16), jitter: false });
    P.sph(0.1 * s, WAC.willowHi, px + rnd(-0.06, 0.06), 2.6 * s - len + rnd(-0.2, 0.3), pz, { sy: 0.55, jitter: false }, 6, 4);
  }
}

layer(0.24);
willow(-7.6, -3.0, 1.05);
willow(-19.8, -3.4, 0.95);
willow(20.0, -3.2, 0.9);
willow(-15.4, -5.0, 0.85);
willow(-9.6, -5.4, 0.8);
willow(-14.2, 11.9, 1.1);
willow(-5.8, 11.6, 1.0);
willow(4.4, 12.0, 1.05);
willow(13.4, 11.7, 1.0);
/* 铺面背后那条空出来的地：几棵柳、两垛柴、几垄菜 */
willow(-16.5, -10.9, 0.9);
willow(-3.0, -11.3, 0.85);
willow(10.6, -11.1, 0.9);
/* 铺面背后那块地：两垛柴、几垄菜 */
for (const [x, z] of [[-13.0, -11.6], [7.6, -11.8]]) {
  P.box(1.6, 0.7, 0.9, PAL.wood, x, 0.35, z, { jitter: false });
  P.box(1.7, 0.12, 1.0, PAL.woodDark, x, 0.76, z, { jitter: false });
  for (let i = 0; i < 4; i++) {
    P.cyl(0.09, 0.09, 0.9, PAL.wood, x - 0.6 + i * 0.4, 0.45, z + 0.62, { rz: Math.PI / 2, jitter: false }, 6);
  }
}
for (const [x, w] of [[-18.6, 3.0], [0.4, 3.2], [16.0, 3.0]]) {
  P.box(w, 0.08, 1.0, 0x8a7a52, x, 0.04, -11.9, { jitter: false });
  for (let i = 0; i < 5; i++) {
    P.box(0.06, 0.28, 0.06, WAC.willowTwig, x - w / 2 + 0.3 + i * (w / 5), 0.19, -11.9, { jitter: false });
  }
}

/* ---------- 摊位：三张，卖的都是水里长的 ---------- */
layer(0.26);
function stall(x, z, name, goods) {
  const w = 1.9, d = 1.1;
  P.box(w + 0.2, 0.34, d + 0.2, PAL.woodDark, x, -0.02, z, { jitter: false });
  P.box(w, 0.1, d, PAL.woodLight, x, 0.2, z, { jitter: false });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      P.cyl0(0.055, 0.065, 2.0, PAL.wood, x + sx * (w / 2), 0.25, z + sz * (d / 2), {}, 7);
    }
  }
  /* 布棚：中间压下去一点 */
  P.box(w + 0.9, 0.12, d * 0.6, PAL.cloth, x, 2.28, z - d * 0.28, { rx: -0.12, jitter: false });
  P.box(w + 0.9, 0.12, d * 0.6, PAL.cloth, x, 2.28, z + d * 0.28, { rx: 0.12, jitter: false });
  P.box(w + 0.9, 0.1, 0.12, PAL.clothRed, x, 2.36, z, { jitter: false });
  /* 竹筐与货 */
  if (goods === 'ling') {
    for (const dx of [-0.55, 0.1, 0.66]) {
      P.cyl(0.26, 0.2, 0.16, PAL.bamboo, x + dx, 0.33, z + 0.1, { jitter: false }, 10);
      for (let i = 0; i < 5; i++) {
        P.sph(0.075, pick([0x4a6b32, 0x5c7d3c, 0x3f5f2a]), x + dx + rnd(-0.14, 0.14), 0.42, z + 0.1 + rnd(-0.12, 0.12), { sy: 0.62, jitter: true }, 7, 4);
      }
    }
    P.box(0.5, 0.12, 0.4, PAL.wood, x - 0.7, 0.3, z - 0.32, { jitter: false });
    P.box(0.06, 0.3, 0.06, PAL.bamboo, x - 0.7, 0.45, z - 0.32, { rz: 0.4, jitter: false });
  } else if (goods === 'yu') {
    P.box(1.5, 0.12, 0.7, PAL.wood, x, 0.3, z, { jitter: false });
    for (const [dx, ry] of [[-0.45, 0.1], [0.0, -0.12], [0.45, 0.08]]) {
      P.sph(0.19, pick([0x8f9ba4, 0xa3aeb6, 0x76828c]), x + dx, 0.42, z, { sx: 1.9, sy: 0.5, ry, jitter: false }, 9, 6);
      P.box(0.2, 0.18, 0.03, 0x6f7a84, x + dx - 0.42, 0.42, z, { ry, jitter: false });
      P.box(0.04, 0.03, 0.04, 0x2f2a26, x + dx + 0.22, 0.47, z + 0.06, { jitter: false });
    }
    P.cyl(0.2, 0.16, 0.2, PAL.bamboo, x + 0.75, 0.34, z - 0.05, { jitter: false }, 9);
  } else {
    P.cyl(0.4, 0.34, 0.12, PAL.bamboo, x - 0.35, 0.31, z, { jitter: false }, 12);
    for (let i = 0; i < 6; i++) {
      P.box(0.19, 0.16, 0.19, pick([0x4f6f38, 0x5d7d40, 0x43612f]), x - 0.55 + (i % 3) * 0.2, 0.44, z - 0.09 + Math.floor(i / 3) * 0.18, { ry: rnd(0, 0.6), jitter: true });
    }
    /* 一串挂起来的粽子 */
    P.cyl0(0.03, 0.03, 1.0, PAL.bamboo, x + 0.6, 0.3, z + 0.3, { rz: 0.1, jitter: false }, 6);
    for (let i = 0; i < 4; i++) {
      P.box(0.16, 0.14, 0.16, 0x4f6f38, x + 0.66, 1.16 - i * 0.19, z + 0.3, { ry: 0.4 + i * 0.2, jitter: false });
    }
  }
  P.sign(name, 0.46, 1.1, x + w / 2 + 0.28, 1.65, z + 0.2, { delay: 0.42 });
  P.cyl0(0.035, 0.04, 0.9, PAL.woodDark, x + w / 2 + 0.28, 2.1, z + 0.2, {}, 6);
}
stall(-8.4, -5.2, 'bLing', 'ling');
stall(-4.2, -5.2, 'bYu', 'yu');
stall(12.6, -5.4, 'bZong', 'zong');

/* ---------- 岸上的杂件：长凳、水缸、石墩、挑灯的竹竿 ---------- */
layer(0.28);
function bench(x, z, len, ry = 0, baseY = 0.0) {
  P.box(len, 0.08, 0.34, PAL.woodLight, x, baseY + 0.44, z, { ry, jitter: false });
  P.box(len, 0.06, 0.1, PAL.wood, x, baseY + 0.62, z - 0.16, { ry, jitter: false });
  for (const s of [-1, 1]) {
    P.box(0.1, 0.42, 0.3, PAL.wood, x + s * (len / 2 - 0.18), baseY + 0.21, z, { ry, jitter: false });
  }
}
{
  /* 对岸的长凳：看戏的正座 */
  for (const x of [-6.4, -1.6, 3.6, 8.8]) bench(x, SA.farBankZ + 1.05, 2.4);
  bench(-11.0, SA.farBankZ + 1.3, 2.0);
  bench(13.0, SA.farBankZ + 1.2, 2.0);
  /* 北岸广场两条 */
  bench(-1.0, -4.2, 2.2, 0.06);
  bench(9.8, -4.4, 2.0, -0.1);
  /* 水缸 */
  for (const [x, z] of [[9.4, -6.3], [16.2, -6.2], [-17.4, -6.0]]) {
    P.cyl(0.42, 0.36, 0.72, 0x7a6a52, x, 0.36, z, { jitter: false }, 14);
    P.cyl(0.44, 0.44, 0.08, 0x5f5240, x, 0.74, z, { jitter: false }, 14);
    P.cyl(0.36, 0.36, 0.02, WAC.water, x, 0.76, z, { jitter: false }, 14);
    P.box(0.3, 0.06, 0.3, PAL.woodDark, x + 0.1, 0.8, z, { ry: 0.4, jitter: false });
  }
  /* 石墩与挑水的担子 */
  for (const [x, z] of [[-6.8, -3.0], [11.6, -3.4], [-13.4, -2.6]]) {
    P.cyl(0.2, 0.24, 0.44, WAC.stone, x, 0.22, z, { jitter: false }, 10);
    P.sph(0.2, WAC.stone, x, 0.46, z, { sy: 0.5, jitter: false }, 9, 6);
  }
  /* 沿河挑灯的竹竿：白天只是陈设，灯不点 */
  const lit = [-18.6, -12.4, -8.4, 11.8, 15.4, 19.0, 20.4];
  for (const x of lit) {
    P.cyl0(0.06, 0.08, 2.5, PAL.bamboo, x, 0.02, SA.bankZ - 0.35, {}, 7);
    P.box(0.06, 0.06, 0.5, PAL.bamboo, x, 2.5, SA.bankZ - 0.1, { jitter: false });
    paperLantern(x, 2.24, SA.bankZ + 0.15, 0.2, PAL.lantern, 0.75);
  }
}

/* ---------- 乌篷船：船体、乌篷、桨、篙，一条一个网格 ---------- */
/* 局部坐标：x 是船长（船头在 +x），z 是船宽，y = 0 就是水线 */
const BOAT_MOVES = [];
let boatSeq = 0;
function buildBoat(bucket, bx, bz, a, opt = {}) {
  const cos = Math.cos(a), sin = Math.sin(a);
  const at = (lx, lz) => [bx + lx * cos + lz * sin, bz - lx * sin + lz * cos];
  const put = (w, h, d, c, lx, ly, lz, o = {}) => {
    const [x, z] = at(lx, lz);
    const oy = o.ry || 0;
    P.box(w, h, d, c, x, ly, z, { ...o, ry: a + oy, bucket });
  };
  const cyl = (rt, rb, h, c, lx, ly, lz, o = {}, seg = 10) => {
    const [x, z] = at(lx, lz);
    const oy = o.ry || 0;
    P.cyl(rt, rb, h, c, x, ly, z, { ...o, ry: a + oy, bucket }, seg);
  };
  /* 船体：底深、舷浅，舷上压一条木沿，才不会看成一根黑棍 */
  put(3.3, 0.3, 1.06, 0x6b4a30, 0, -0.1, 0);
  put(3.3, 0.5, 0.1, PAL.wood, 0, 0.0, 0.5);
  put(3.3, 0.5, 0.1, PAL.wood, 0, 0.0, -0.5);
  put(3.36, 0.09, 0.15, PAL.woodLight, 0, 0.27, 0.5);
  put(3.36, 0.09, 0.15, PAL.woodLight, 0, 0.27, -0.5);
  put(2.9, 0.05, 0.86, PAL.woodLight, 0, 0.03, 0);
  put(1.2, 0.08, 0.86, PAL.woodLight, -0.5, 0.31, 0);
  /* 船头、船尾上翘 */
  put(1.0, 0.3, 0.92, PAL.wood, 1.7, 0.24, 0, { rz: 0.34 });
  put(0.8, 0.3, 0.82, PAL.wood, -1.68, 0.26, 0, { rz: -0.38 });
  put(0.3, 0.14, 0.86, PAL.woodLight, 2.05, 0.44, 0, { rz: 0.34 });
  /* 乌篷：4 道拱 × 每道 5 段，拼成一整片壳，别留缝 */
  for (let i = 0; i < 4; i++) {
    const rx0 = -0.75 + i * 0.5;
    for (let k = 0; k < 5; k++) {
      const th = 0.26 + ((k + 0.5) / 5) * (Math.PI - 0.52);
      put(0.56, 0.06, 0.46, 0x2b2622, rx0, 0.3 + 0.62 * Math.sin(th), 0.62 * Math.cos(th), { rx: th + Math.PI / 2 });
    }
  }
  put(0.07, 0.6, 0.8, 0x2b2622, -1.02, 0.5, 0);
  put(0.07, 0.56, 0.76, 0x2b2622, 1.02, 0.48, 0);
  /* 一支桨、一根竹篙，都放低 */
  put(0.1, 0.05, 1.15, PAL.wood, 0.72, 0.3, 0.62, { rx: 0.18 });
  put(2.5, 0.05, 0.05, PAL.bamboo, 0.35, 0.46, 0.28, { rz: 0.04 });
  /* 船头小灯笼 */
  cyl(0.1, 0.1, 0.2, PAL.lantern, 1.62, 0.62, 0);
  cyl(0.11, 0.11, 0.04, PAL.brass, 1.62, 0.74, 0);
  cyl(0.02, 0.02, 0.26, PAL.woodDark, 1.62, 0.86, 0);
  /* 缆绳：系在岸上的那两条才有 */
  if (opt.moor) {
    const [bx1, bz1] = at(1.95, 0.35);
    const [mx, mz] = opt.moor;
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const x = bx1 + (mx - bx1) * t, z = bz1 + (mz - bz1) * t;
      const y = 0.42 - Math.sin(Math.PI * t) * 0.34;
      P.box(0.05, 0.05, 0.16, 0x7a6a52, x, y, z, { ry: Math.atan2(mx - bx1, mz - bz1), jitter: false, bucket });
    }
  }
  return { at, put, cyl };
}

/* 卷棚大船：比乌篷船大一圈，卷棚能坐人，戏台前最气派的那种 */
function buildBigBoat(bucket, bx, bz, a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  const at = (lx, lz) => [bx + lx * cos + lz * sin, bz - lx * sin + lz * cos];
  const put = (w, h, d, c, lx, ly, lz, o = {}) => {
    const [x, z] = at(lx, lz);
    P.box(w, h, d, c, x, ly, z, { ...o, ry: a + (o.ry || 0), bucket });
  };
  const cyl = (rt, rb, h, c, lx, ly, lz, o = {}, seg = 10) => {
    const [x, z] = at(lx, lz);
    P.cyl(rt, rb, h, c, x, ly, z, { ...o, ry: a + (o.ry || 0), bucket }, seg);
  };
  /* 船体：长 5 米、宽 1.9 米 */
  put(5.0, 0.36, 1.9, 0x6b4a30, 0, -0.12, 0);
  put(5.0, 0.62, 0.14, PAL.wood, 0, 0.06, 0.9);
  put(5.0, 0.62, 0.14, PAL.wood, 0, 0.06, -0.9);
  put(5.06, 0.09, 0.16, PAL.wood, 0, 0.42, 0.9);
  put(5.06, 0.09, 0.16, PAL.wood, 0, 0.42, -0.9);
  put(4.4, 0.06, 1.6, PAL.woodLight, 0, 0.08, 0);
  put(1.3, 0.4, 1.7, PAL.wood, 2.6, 0.3, 0, { rz: 0.3 });
  put(1.0, 0.4, 1.5, PAL.wood, -2.6, 0.32, 0, { rz: -0.34 });
  /* 乌篷大顶：拱底抬到舷口以上，暗篷要看得见；和乌篷船同一套做法，只是大一圈 */
  for (let i = 0; i < 5; i++) {
    const rx0 = -1.6 + i * 0.8;
    for (let k = 0; k < 6; k++) {
      const th = 0.24 + ((k + 0.5) / 6) * (Math.PI - 0.48);
      put(0.9, 0.07, 0.64, 0x2b2622, rx0, 0.54 + 1.08 * Math.sin(th), 1.06 * Math.cos(th), { rx: th + Math.PI / 2 });
    }
  }
  put(4.6, 0.06, 0.1, PAL.bambooDark, 0, 1.58, 0);                 // 篷顶压一道细竹条
  /* 棚下四根立柱、侧面的蓝布帘、船尾一支橹、船头一盏灯 */
  for (const lz of [-0.85, 0.85]) {
    for (const lx of [-1.5, 1.5]) {
      put(0.09, 0.9, 0.09, PAL.woodDark, lx, 0.95, lz);
    }
  }
  put(2.6, 0.9, 0.05, 0x2f4f70, 1.5, 0.95, 0.88);
  put(0.12, 0.12, 2.0, PAL.wood, -2.9, 0.7, 0.7, { rx: 0.2 });
  cyl(0.13, 0.13, 0.26, PAL.lantern, 2.3, 0.85, 0);
  cyl(0.14, 0.14, 0.05, PAL.brass, 2.3, 1.0, 0);
  put(0.5, 0.5, 0.5, 0x8a5a3a, -1.9, 0.9, 0);
}

layer(0.3);
/* 会晃的六条：戏台前的两排正位，船头都朝着台口 */
const BOAT_ROWS = [
  [0.4, 0.6, Math.PI / 2, 0.0], [3.4, 0.6, Math.PI / 2 + 0.09, 1.1], [6.6, 0.6, Math.PI / 2 - 0.09, 2.2],
  [1.7, 3.5, Math.PI / 2 + 0.13, 3.3], [5.1, 3.5, Math.PI / 2 - 0.13, 4.4], [8.7, 3.5, Math.PI / 2 + 0.05, 5.5],
];
for (const [x, z, a, ph] of BOAT_ROWS) {
  const name = 'boatMove' + boatSeq++;
  buildBoat(name, 0, 0, 0);
  BOAT_MOVES.push({ name, x, z, a, phase: ph });
}
/* 不动的：沿岸系着的一排、桥洞底下、对岸脚下、东头，加一条卷棚大船 —— 全部合并成一份 */
{
  for (const x of [-19.4, -14.8, -10.2, 11.6, 16.2]) {
    buildBoat('boatsStatic', x, -1.4, 0, { moor: [x + 1.6, SA.bankZ - 0.4] });
  }
  /* 第三排：贴对岸那一侧，船头还是朝台口 */
  for (const [x, a] of [[-12.6, Math.PI / 2 + 0.1], [-2.4, Math.PI / 2 - 0.08], [7.2, Math.PI / 2 + 0.06]]) {
    buildBoat('boatsStatic', x, 6.8, a);
  }
  buildBoat('boatsStatic', -14.6, 3.2, Math.PI);
  buildBoat('boatsStatic', -8.0, 8.2, -0.2);
  buildBoat('boatsStatic', 17.6, 7.6, 0.16);
  buildBoat('boatsStatic', 12.4, 2.2, 0.05);
  buildBigBoat('boatsStatic', 0.6, 7.8, 0.22);
}

/* ---------- 看戏的人：低模、无脸、剪影式，跟场景同一套描边 ---------- */
function person(x, z, o = {}) {
  const boat = o.boat || null;
  const a = boat ? boat.a : o.ry || 0;
  const BX = boat ? boat.bx : x, BZ = boat ? boat.bz : z;
  const cos = Math.cos(a), sin = Math.sin(a);
  const at = (lx, lz) => [BX + lx * cos + lz * sin, BZ - lx * sin + lz * cos];
  const bucket = boat ? boat.bucket : undefined;
  let s = (o.s || 1) * 1.09;
  const sit = !!o.sit;
  const baseY = o.baseY != null ? o.baseY : 0.03;
  const coat = o.coat || pick([0x3f5f80, 0x2f4f70, 0x7a2a22, 0x4f6a4a, 0x8a6a3a, 0x2f3a44, 0x6a4a5a]);
  const pants = o.pants || pick([0x2a2a30, 0x3a3228, 0x4a4a52, 0x2f3a44]);
  const skin = pick([0xe8c9a8, 0xdcb894, 0xf0d6b8]);
  const hat = o.hat !== undefined ? o.hat : pick([null, null, 0xd9b46a, 0x3a3a3a, 0xc7a46c]);
  const put = (w, h, d, c, lx, ly, lz, rz = 0) => {
    const [px, pz] = at(lx * s, lz * s);
    P.box(w * s, h * s, d * s, c, px, baseY + ly * s, pz, { ry: a, rz, jitter: false, bucket });
  };
  const sph = (r, c, lx, ly, lz, extra = {}) => {
    const [px, pz] = at(lx * s, lz * s);
    P.sph(r * s, c, px, baseY + ly * s, pz, { ry: a, jitter: false, bucket, ...extra }, 9, 6);
  };
  if (!sit) {
    put(0.13, 0.6, 0.16, pants, -0.1, 0.3, 0);
    put(0.13, 0.6, 0.16, pants, 0.1, 0.3, 0);
  } else {
    for (const side of [-1, 1]) {
      put(0.13, 0.14, 0.42, pants, side * 0.1, 0.44, 0.2);
      put(0.12, 0.44, 0.13, pants, side * 0.1, 0.22, 0.42);
    }
  }
  put(0.42, 0.6, 0.26, coat, 0, sit ? 0.78 : 0.92, 0);
  put(0.44, 0.08, 0.28, coat === 0x7a2a22 ? 0xb8322a : 0xd9b777, 0, sit ? 0.55 : 0.72, 0);
  for (const side of [-1, 1]) {
    put(0.11, 0.48, 0.13, coat, side * 0.26, sit ? 0.88 : 0.94, 0.02, side * 0.06);
    put(0.1, 0.12, 0.12, skin, side * 0.27, sit ? 0.62 : 0.68, 0.05);
  }
  sph(0.15, skin, 0, sit ? 1.26 : 1.4, 0);
  if (hat === null) {
    sph(0.155, 0x2a2420, 0, (sit ? 1.26 : 1.4) + 0.05, 0, { sy: 0.6 });
  } else {
    put(0.04, 0.09, 0.04, hat, 0, (sit ? 1.26 : 1.4) + 0.12, 0);
    put(0.62, 0.05, 0.62, hat, 0, (sit ? 1.26 : 1.4) + 0.19, 0, 0);
  }
  if (o.basket) {
    const [bx, bz] = at(0.32 * s, 0.12 * s);
    P.cyl(0.12 * s, 0.1 * s, 0.16 * s, PAL.bamboo, bx, baseY + 0.62 * s, bz, { jitter: false, bucket }, 8);
    P.cyl(0.11 * s, 0.11 * s, 0.02 * s, PAL.bambooDark, bx, baseY + 0.71 * s, bz, { jitter: false, bucket }, 8);
  }
  if (o.pole) put(0.04, 1.7, 0.04, PAL.bamboo, 0.3, 0.9, 0.2, 0.12);
}

layer(0.34);
{
  /* 台上：两个站着的、一个坐着操鼓的 */
  person(SA.stageX - 0.5, SA.stageZ - 1.2, { ry: 0.1, baseY: SA.stageY + 0.16, s: 1.0, coat: 0x2f4f70, pants: 0xd9c39a, hat: null });
  person(SA.stageX + 0.9, SA.stageZ - 0.7, { ry: -0.2, baseY: SA.stageY + 0.16, s: 1.02, coat: 0x8e2620, pants: 0x3a3228, hat: 0x3a3a3a });
  person(SA.stageX + 2.9, SA.stageZ - 1.6, { ry: 0.5, sit: true, baseY: SA.stageY + 0.16, s: 0.98, coat: 0x4a4a52 });
  /* 北岸两侧站着看的：面朝台口（站在岸上，不进河） */
  for (const [x, z, ry] of [[-2.4, -3.6, -1.2], [-3.6, -4.2, -1.5], [9.7, -3.6, 1.3], [10.9, -4.2, 1.6], [8.9, -4.9, 1.0]]) {
    person(x, z, { ry, s: rnd(0.94, 1.04), basket: rand() < 0.2 });
  }
  /* 广场：摊前挑货与走动的 */
  for (const [x, z, ry] of [[-8.4, -6.1, Math.PI], [-7.6, -6.3, Math.PI + 0.3], [-4.2, -6.1, Math.PI], [12.6, -6.3, Math.PI], [13.4, -6.1, Math.PI - 0.2]]) {
    person(x, z, { ry, s: rnd(0.94, 1.02), basket: rand() < 0.35 });
  }
  for (const [x, z, ry] of [[-1.2, -5.0, 1.4], [1.8, -4.6, -1.2], [6.0, -6.2, 3.0], [-11.8, -5.6, -0.3], [17.0, -5.4, 2.2], [5.2, -4.4, -2.0]]) {
    person(x, z, { ry, s: rnd(0.94, 1.04), pole: rand() < 0.25, basket: rand() < 0.2 });
  }
  /* 社庙前上香的 */
  for (const [x, z] of [[SA.templeX - 0.6, SA.templeZ + 2.0], [SA.templeX + 0.8, SA.templeZ + 2.2]]) {
    person(x, z, { ry: Math.PI, s: 1.0 });
  }
  /* 埠头：洗衣、取水的 */
  person(SA.landingX - 1.9, SA.bankZ + 1.4, { ry: 0.4, sit: true, baseY: -0.14, s: 1.0, coat: 0x2f4f70 });
  person(SA.landingX + 0.4, SA.bankZ + 0.5, { ry: 0.2, s: 0.98, basket: true, coat: 0x4f6a4a });
  /* 桥上两个人：一来看戏，一来看水 */
  person(SA.bridgeX - 0.6, 2.2, { ry: Math.PI, s: 1.0 });
  person(SA.bridgeX + 0.7, 3.6, { ry: 0.0, s: 0.98, hat: null });
  /* 对岸：坐长凳的、站着的一排、几个小孩 */
  for (const bx of [-6.4, -1.6, 3.6, 8.8, -11.0, 13.0]) {
    for (const dx of [-0.5, 0.55]) {
      person(bx + dx, SA.farBankZ + 1.05, { ry: Math.PI, sit: true, baseY: 0.45, s: rnd(0.94, 1.02), hat: rand() < 0.3 ? null : 0xc7a46c });
    }
  }
  const stand = [
    [-17.6, 11.1], [-15.0, 11.6], [-9.4, 11.2], [-7.2, 11.7], [-3.4, 11.3], [-0.6, 11.8],
    [1.6, 11.1], [5.4, 11.4], [7.0, 11.8], [10.2, 11.2], [12.0, 11.7], [15.6, 11.3],
    [17.8, 11.6], [19.4, 11.1],
  ];
  for (const [x, z] of stand) {
    person(x, z, { ry: Math.PI + rnd(-0.4, 0.4), s: rnd(0.94, 1.04), basket: rand() < 0.2, hat: rand() < 0.4 ? null : 0xc7a46c });
  }
  for (const [x, z] of [[-4.6, 11.9], [2.8, 12.0], [11.2, 11.9]]) {
    person(x, z, { ry: Math.PI, s: 0.62, hat: null });
  }
  /* 不动的船上坐一个人：船头一个，船尾一个 */
  person(0, 0, { boat: { bx: -13.65, bz: -1.4, a: 0, bucket: 'boatsStatic' }, sit: true, baseY: SA.waterY + 0.4, ry: 0.2, s: 0.95, coat: 0x3f5f80 });
  person(0, 0, { boat: { bx: -18.25, bz: -1.4, a: 0, bucket: 'boatsStatic' }, sit: true, baseY: SA.waterY + 0.4, ry: -0.2, s: 0.95, coat: 0x8a6a3a });
  person(0, 0, { boat: { bx: 12.75, bz: -1.4, a: 0, bucket: 'boatsStatic' }, sit: true, baseY: SA.waterY + 0.4, ry: -0.3, s: 0.95, coat: 0x6a4a5a });
  person(0, 0, { boat: { bx: -6.87, bz: 8.43, a: -0.2, bucket: 'boatsStatic' }, sit: true, baseY: SA.waterY + 0.4, ry: 0.4, s: 0.95, coat: 0x4f6a4a });
  person(0, 0, { boat: { bx: -2.31, bz: 5.65, a: Math.PI / 2 - 0.08, bucket: 'boatsStatic' }, sit: true, baseY: SA.waterY + 0.4, ry: 0.5, s: 0.95, coat: 0x2f4f70 });
  /* 乌篷大船的船头上站一个撑篙的 */
  person(0, 0, { boat: { bx: 2.94, bz: 7.28, a: 0.22, bucket: 'boatsStatic' }, baseY: 0.5, s: 0.98, coat: 0x7a2a22, hat: 0xc7a46c });
  /* 会晃的船上：船尾一位撑篙的船夫（和船一起晃，所以画进船自己的网格里） */
  for (const mv of BOAT_MOVES) {
    person(0, 0, { boat: { bx: -1.6, bz: 0.05, a: 0, bucket: mv.name }, baseY: 0.28, s: 0.98, coat: 0x4a4a52, pants: 0x2f3a44, hat: 0xc7a46c });
    P.box(0.05, 2.4, 0.05, PAL.bamboo, -1.15, 2.2, 0.25, { rz: 0.16, jitter: false, bucket: mv.name });
  }
}
/* ---------- 50 · 光、水面的流动、会动的船与幡、交互与主循环 ---------- */

finishBucket('solid', toonMat, true);
finishBucket('fine', toonMat, false);
finishBucket('glow', glowMat, false);
finishBucket('glass', glassMat, false);
finishBucket('sign', signMat, false);
finishBucket('boatsStatic', toonMat, true);

/* ---------- 光：白天的水乡，太阳偏西南，台口正被照着 ---------- */
scene.add(new THREE.HemisphereLight(0xd2e8f4, 0xa8a490, 1.2));
scene.add(new THREE.AmbientLight(0xe6eef1, 0.32));

const sun = new THREE.DirectionalLight(0xfff3dc, 2.65);
sun.position.set(-14, 17, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -24;
sun.shadow.camera.right = 24;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.camera.updateProjectionMatrix();
sun.target.position.set(0, 0.6, 0);
scene.add(sun);
scene.add(sun.target);

/* 北侧冷补光：铺面背光的一面从死黑里拉回来 */
const fill = new THREE.DirectionalLight(0xbcd6ec, 0.5);
fill.position.set(8, 9, -15);
scene.add(fill);

/* 台口一盏暖光，把台面从屋檐阴影里提出来 */
const stageLight = new THREE.PointLight(0xffd9a0, 15, 10, 2);
stageLight.position.set(SA.stageX, 3.2, SA.stageZ + 2.0);
scene.add(stageLight);

/* 每间铺子内部一盏暖光 */
for (const [x, y, z, i] of [[10.8, 2.2, -7.2, 10], [14.4, 2.2, -7.2, 9], [18.0, 2.2, -7.2, 9], [SA.westShopX - 0.7, 1.6, -8.0, 8]]) {
  const l = new THREE.PointLight(0xfff0d2, i, 7, 2);
  l.position.set(x, y, z);
  scene.add(l);
}

/* ---------- 光晕与接触阴影 ---------- */
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
const glowTexture = radialTexture();

{
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0x33474f, transparent: true, opacity: 0.45,
    depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(48, 34), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.87;
  scene.add(m);
}

const glowSprites = [];
for (const [x, y, z, size, color, op] of glowPts) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color, transparent: true, opacity: op,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  }));
  s.position.set(x, y, z);
  s.scale.set(size, size, 1);
  s.userData.base = op;
  s.userData.phase = rnd(0, 6.28);
  s.userData.speed = rnd(0.6, 1.4);
  scene.add(s);
  glowSprites.push(s);
}

/* ---------- 水面的流动：两层会滚的波纹贴图 ---------- */
function rippleTexture(n, len0, len1, hi) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  for (let i = 0; i < n; i++) {
    const y = rand() * 512;
    const x = rand() * 512;
    const len = rnd(len0, len1);
    const w = rnd(1.1, 3.4);
    const a = rnd(0.08, hi);
    g.strokeStyle = `rgba(226,246,252,${a.toFixed(2)})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + len * 0.3, y + rnd(-4, 4), x + len * 0.7, y + rnd(-4, 4), x + len, y + rnd(-3, 3));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const waterZc = (SA.bankZ + SA.farBankZ) / 2;
const waterW = SA.farBankZ - SA.bankZ - 0.1;
const ripples = [];
for (const [tex, rep, speed, y, op] of [
  [rippleTexture(120, 40, 150, 0.4), 3.2, -0.026, SA.waterY + 0.026, 0.62],
  [rippleTexture(46, 90, 260, 0.5), 1.3, 0.018, SA.waterY + 0.038, 0.34],
]) {
  tex.repeat.set(rep, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: op, depthWrite: false, fog: true, blending: THREE.NormalBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(41.7, waterW), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, y, waterZc);
  m.renderOrder = 2;
  scene.add(m);
  ripples.push({ m, tex, speed });
}

/* ---------- 空气里的浮尘、灶上的炊烟、庙前的香火 ---------- */
function driftPoints(spec) {
  const n = spec.n;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = spec.spawn();
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
    seed[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: spec.tex, color: spec.color, size: spec.size, sizeAttenuation: true,
    transparent: true, opacity: spec.opacity, depthWrite: false,
    blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  return { pos, seed, geo, spec };
}
const drifts = [
  driftPoints({
    n: 340, tex: glowTexture, color: 0xfff6e2, size: 0.12, opacity: 0.42, additive: true,
    rise: 0.06, sway: 0.16, top: 7.0,
    spawn: () => [rnd(-20, 20), rnd(0.4, 6.6), rnd(-12.5, 12.5)],
  }),
  driftPoints({
    n: 34, tex: radialTexture(64), color: 0xf2f0ea, size: 0.55, opacity: 0.3,
    rise: 0.5, sway: 0.12, top: 4.4,
    spawn: () => [SA.westShopX - 1.2 + rnd(-0.16, 0.16), rnd(1.7, 2.0), -8.5 + rnd(-0.16, 0.16)],
  }),
  driftPoints({
    n: 26, tex: radialTexture(64), color: 0xf6ead2, size: 0.4, opacity: 0.26,
    rise: 0.34, sway: 0.1, top: 3.6,
    spawn: () => [SA.templeX + rnd(-0.12, 0.12), rnd(1.6, 1.9), SA.templeZ + 2.9 + rnd(-0.12, 0.12)],
  }),
];
function stepDrift(d, dt, now) {
  const a = d.pos;
  const { rise, sway, top } = d.spec;
  for (let i = 0; i < d.seed.length; i++) {
    a[i * 3 + 1] += dt * rise;
    a[i * 3] += Math.sin(now * 0.7 + d.seed[i] * 6.28) * dt * sway;
    if (a[i * 3 + 1] > top) {
      const p = d.spec.spawn();
      a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = p[2];
    }
  }
  d.geo.attributes.position.needsUpdate = true;
}

/* ---------- 会晃的三条船 ---------- */
function makeSeparate(name, outline = false) {
  const b = BUCKETS.get(name);
  if (!b || !b.pos.length) return null;
  const geo = toGeometry(b);
  BUCKETS.delete(name);
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, toonMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depthMat;
  g.add(mesh);
  if (outline) g.add(new THREE.Mesh(geo, outlineMat));
  scene.add(g);
  return g;
}
const boats = [];
for (const mv of BOAT_MOVES) {
  const g = makeSeparate(mv.name, true);
  if (!g) continue;
  g.position.set(mv.x, SA.waterY, mv.z);
  g.rotation.y = mv.a;
  g.userData = { x: mv.x, z: mv.z, a: mv.a, phase: mv.phase };
  boats.push(g);
}

/* ---------- 河台两侧的幡旗：挂在杆头，风一吹轻轻摆 ---------- */
layer(0.32);
for (const sx of [-1, 1]) {
  P.cyl0(0.08, 0.1, 4.3, PAL.woodDark, SA.stageX + sx * 6.1, 0, SA.bankZ - 0.8, {}, 8);
  P.box(0.5, 0.1, 0.5, WAC.stoneDark, SA.stageX + sx * 6.1, 0.05, SA.bankZ - 0.8, { jitter: false });
}
{
  let n = 0;
  for (const sx of [-1, 1]) {
    const name = 'flag' + n++;
    P.box(0.62, 2.1, 0.05, 0xb8322a, 0, -1.05, 0, { jitter: false, bucket: name });
    P.box(0.5, 0.55, 0.05, 0xc23a2c, 0, -2.35, 0, { jitter: false, bucket: name });
    P.box(0.66, 0.09, 0.07, PAL.brass, 0, -0.05, 0, { jitter: false, bucket: name });
    P.box(0.2, 0.3, 0.06, 0xd9a24a, 0, -0.6, 0.03, { jitter: false, bucket: name });
  }
}
const flags = [makeSeparate('flag0'), makeSeparate('flag1')];
flags.forEach((f, i) => {
  if (!f) return;
  const sx = i === 0 ? -1 : 1;
  f.position.set(SA.stageX + sx * 6.1, 4.2, SA.bankZ - 0.8);
  f.userData.phase = i * 1.9;
});

/* ---------- 相机与交互：拖动旋转 / 滚轮缩放 / 双指捏合 / 平移 ---------- */
const cam = {
  az: 0.9, pol: 0.6, dist: 145,
  goalAz: 0.42, goalPol: 1.02, goalDist: 58,
  target: new THREE.Vector3(2.6, 1.8, 0.4),
};
if (window.innerWidth < window.innerHeight) {
  cam.goalAz = 0.34;
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
  cam.target.x = THREE.MathUtils.clamp(cam.target.x, -21, 21);
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
    if (pinchDist > 0) cam.goalDist = THREE.MathUtils.clamp(cam.goalDist * (pinchDist / Math.max(d, 1)), 10, 140);
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
  cam.goalDist = THREE.MathUtils.clamp(cam.goalDist * Math.exp(e.deltaY * 0.0011), 10, 140);
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
    const k = 1 - Math.pow(1, Math.min(1, intro.t / intro.dur), 3);
    cam.az = THREE.MathUtils.lerp(0.9, cam.goalAz, k);
    cam.pol = THREE.MathUtils.lerp(0.6, cam.goalPol, k);
    cam.dist = THREE.MathUtils.lerp(120, cam.goalDist, k);
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
    U.assemble.value = HOLD;              // ?hold=1 冻结组装进度（截图用）
  } else if (U.assemble.value < 1) {
    clockAssemble.t += dt;
    U.assemble.value = Math.min(1, clockAssemble.t / 3.6);
  }
  U.time.value = now;

  /* 水面的波纹往东流 */
  for (const r of ripples) r.tex.offset.x = (r.tex.offset.x + r.speed * dt) % 1;

  /* 三条船随水轻轻起伏，方向也一点点偏 */
  for (const b of boats) {
    const u = b.userData;
    b.position.y = SA.waterY + Math.sin(now * 0.9 + u.phase) * 0.035;
    b.position.x = u.x + Math.sin(now * 0.42 + u.phase) * 0.07;
    b.rotation.z = Math.sin(now * 0.7 + u.phase) * 0.028;
    b.rotation.y = u.a + Math.sin(now * 0.33 + u.phase) * 0.05;
  }

  /* 幡布摆、光晕呼吸 */
  for (const f of flags) {
    if (!f) continue;
    const u = f.userData;
    f.rotation.z = Math.sin(now * 1.15 + u.phase) * 0.13;
    f.rotation.y = Math.sin(now * 0.62 + u.phase) * 0.22;
  }
  for (const s of glowSprites) {
    s.material.opacity = s.userData.base * (0.9 + 0.1 * Math.sin(now * s.userData.speed + s.userData.phase));
  }

  for (const d of drifts) stepDrift(d, dt, now);

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

window.__MINS_DIAG = () => ({
  assemble: +U.assemble.value.toFixed(3),
  drawCalls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
  camera: [cam.az, cam.pol, cam.dist].map((v) => +v.toFixed(2)),
});
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
};
/* ---------- 60 · 场景导览配置（水乡社戏） ----------
 * 逻辑全在 tools/shared/tour.js；这里只描述「这个场景要讲什么」。
 * 口径：底座 42 × 26（halfX 21 / halfZ 13），北岸到 z = −2.2，河面 z −2.2…9.8，
 *       水面 y = −0.285，河台台面 y = 1.18（stageY），檐口 eaveY = 4.42。
 */

const shexiTour = createSceneTour(THREE, {
  scene,
  canvas,
  camera,
  /* 组装没走完就先别显示金环：热点不受顶点着色器的「长出来」变形影响，
     否则前 3.6 秒金环会浮在还没成形的模型上方 */
  ready: () => U.assemble.value >= 0.999 || SHOT,

  ui: {
    masthead: '水乡社戏',
    mastheadIndex: '酬神演剧 · 河台',
    kicker: '水乡社戏 · 微缩沙盘',
    title: '台搭在水上，船就是看池',
    lead: '一条河占掉十二米：北岸三间临水铺面，中间一座河台一半落岸、一半挑在水上，台口朝河。戏开演时，台前两排船就是最好的座位。',
    legend: [
      { color: '#a8352c', label: '河台', note: '一半落岸、一半挑在水上' },
      { color: '#4f7a6a', label: '水面', note: '占底座十二米，船停在水上' },
      { color: '#c7a46c', label: '看客', note: '岸上坐长凳，对岸站成一排' },
      { color: '#8a6a44', label: '铺面', note: '门脸一律朝河' },
    ],
    tip: '点亮金环，镜头会飞过去并展开说明；共 11 处。本模型为原创示意，不是建筑、服饰或船只比例的复原。',
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
      id: 'stage', name: '河台', en: 'RIVER STAGE',
      marker: [3.4, 3.0, 0.55],
      view: { az: 0.14, pol: 1.14, dist: 29, tx: 3.6, ty: 2.0, tz: -0.6 },
      text: '社戏的河台：9.2 × 5.0 的台子一半落在北岸、一半挑在水上，水侧两根石柱加斜撑托着。台口朝河——正面挂匾额「社戏台」，两侧楹联「戏台小天地 / 天地大戏台」。',
    },
    {
      id: 'boats', name: '看戏的船', en: 'AUDIENCE BOATS',
      marker: [3.4, 0.9, 3.3],
      view: { az: 0.08, pol: 1.16, dist: 20, tx: 4.0, ty: 0.6, tz: 2.4 },
      text: '台前两排船，就是社戏的「看池」。水面没有座位，谁把船撑到台口谁就占了好位置；船会随水轻轻晃，船尾各有一位撑篙的船夫。',
    },
    {
      id: 'crowd', name: '对岸看客', en: 'FAR-BANK CROWD',
      marker: [1.0, 1.5, 10.85],
      view: { az: 3.05, pol: 1.08, dist: 20, tx: 1.0, ty: 1.2, tz: 10.85 },
      text: '对岸也全是人：前排坐在长凳上，后面站成一排，还有几个站在最前面看热闹的孩子。看社戏不用买票，占得到地方就行。',
    },
    {
      id: 'temple', name: '社庙', en: 'VILLAGE SHRINE',
      marker: [-12.6, 4.3, -7.3],
      view: { az: 0.12, pol: 1.15, dist: 15, tx: -12.6, ty: 1.9, tz: -6.6 },
      text: '社庙就在北岸，匾额「社庙」。社戏本是酬神而演——先敬社神，再唱给人听，所以戏台从来离庙不远。',
    },
    {
      id: 'teahouse', name: '茶楼', en: 'TEAHOUSE',
      marker: [10.8, 5.4, -8.3],
      view: { az: 0.30, pol: 1.15, dist: 14, tx: 10.8, ty: 3.0, tz: -7.6 },
      text: '临水三间铺面的头一间：两层茶楼，二层带挑台。门脸一律朝河——坐在楼上就能把戏台看个正着。',
    },
    {
      id: 'gaotuan', name: '糕团铺', en: 'RICE-CAKE SHOP',
      marker: [14.4, 3.9, -8.3],
      view: { az: 0.28, pol: 1.18, dist: 11, tx: 14.4, ty: 1.7, tz: -7.8 },
      text: '糕团铺，幌子写「糕团 · 水磨」。看戏的零嘴多半从这儿买——水磨粉做出来的糕团，是这一带最日常的点心。',
    },
    {
      id: 'bamboo', name: '竹器铺', en: 'BAMBOO WARES',
      marker: [18.0, 3.9, -8.3],
      view: { az: 0.22, pol: 1.18, dist: 11, tx: 18.0, ty: 1.7, tz: -7.8 },
      text: '竹器铺，幌子写「竹器 · 篾匠」。水乡的筐、篮、席、笼都出自篾匠手里，铺面临水，编好的器物直接堆在河边。',
    },
    {
      id: 'noodle', name: '临水面棚', en: 'NOODLE SHED',
      marker: [-19.6, 3.0, -7.6],
      view: { az: -0.16, pol: 1.16, dist: 13, tx: -19.6, ty: 1.8, tz: -7.0 },
      text: '西头一间只有四根柱子和一片布棚的面棚，灶上一直冒着气。棚子最简陋，却是街上最早开火的一家。',
    },
    {
      id: 'bridge', name: '缓拱石桥', en: 'ARCH BRIDGE',
      marker: [-16.0, 2.0, 3.8],
      view: { az: 1.25, pol: 1.20, dist: 18, tx: -16.0, ty: 1.2, tz: 3.8 },
      text: '西头一座跨十二米河面的缓拱石桥。桥面平缓，好走挑担；桥上也是看戏的位置——有来看戏的，也有只是来看水的。',
    },
    {
      id: 'landing', name: '埠头', en: 'LANDING',
      marker: [-4.6, 0.35, -1.7],
      view: { az: 0.40, pol: 1.22, dist: 12, tx: -4.8, ty: -0.1, tz: -1.2 },
      text: '北岸的埠头，六级石阶直接下到水里：洗衣的、取水的、上船下船的都在这儿。三级在水上、三级没在水下。',
    },
    {
      id: 'bigboat', name: '乌篷大船', en: 'CANOPIED BOAT',
      marker: [0.6, 1.3, 7.8],
      view: { az: 1.30, pol: 1.26, dist: 12, tx: 0.6, ty: 0.8, tz: 7.8 },
      text: '卷棚乌篷大船，比一般乌篷船大一圈，篷下能坐人——是戏台前最气派的一种船。船头上站着撑篙的。',
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

window.__TOUR = shexiTour;