import * as THREE from "three";
async function createKiteModel(design) {
  const root = new THREE.Group();
  root.name = "root";
  const parts = /* @__PURE__ */ new Map();
  const sockets = /* @__PURE__ */ new Map();
  const texture = await new THREE.TextureLoader().loadAsync("./paint.png");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const painted = new THREE.MeshStandardMaterial({ color: 16777215, map: texture, roughness: 0.91, metalness: 0, alphaTest: 0.18, transparent: false, side: THREE.FrontSide });
  const paintReveal = { value: 1 };
  painted.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintReveal = paintReveal;
    shader.fragmentShader = "uniform float uPaintReveal;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\nfloat reveal = smoothstep(1.0-uPaintReveal-.06,1.0-uPaintReveal+.02,vMapUv.y);\ndiffuseColor.rgb=mix(vec3(.81,.73,.57),diffuseColor.rgb,reveal);");
  };
  const paper = new THREE.MeshStandardMaterial({ color: 15325624, roughness: 0.94, metalness: 0, side: THREE.FrontSide });
  function microMap(seed, roughness2 = false) {
    const size = 256, data = new Uint8Array(size * size * 4);
    let n = seed;
    for (let i = 0; i < size * size; i++) {
      n = 1664525 * n + 1013904223 >>> 0;
      const v = roughness2 ? 222 + n % 24 : 118 + n % 20;
      data.set([v, v, v, 255], i * 4);
    }
    const t = new THREE.DataTexture(data, size, size);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 6);
    t.needsUpdate = true;
    return t;
  }
  const fibre = microMap(41), roughness = microMap(79, true);
  for (const m of [painted, paper]) {
    m.bumpMap = fibre;
    m.bumpScale = 45e-5;
    m.roughnessMap = roughness;
  }
  for (const [id, outline] of Object.entries(design.panels)) {
    let subdivide = function(a, b, c, n, matIndex) {
      if (!n) {
        for (const v of [a, b, c]) positions.push(v.x, v.y, v.z - 0.028 * (v.x / 2.658) ** 2);
        materialIndices.push(matIndex);
        return;
      }
      const ab = a.clone().add(b).multiplyScalar(0.5), bc = b.clone().add(c).multiplyScalar(0.5), ca = c.clone().add(a).multiplyScalar(0.5);
      subdivide(a, ab, ca, n - 1, matIndex);
      subdivide(ab, b, bc, n - 1, matIndex);
      subdivide(ca, bc, c, n - 1, matIndex);
      subdivide(ab, bc, ca, n - 1, matIndex);
    };
    const pivot = new THREE.Group();
    pivot.name = id;
    root.add(pivot);
    parts.set(id, pivot);
    const shape = new THREE.Shape(), points = outline.map(([x, y]) => new THREE.Vector2((x - 886) * 3e-3, (750 - y) * 3e-3));
    const first = points[0].clone().lerp(points[1], 0.5);
    shape.moveTo(first.x, first.y);
    for (let i = 1; i <= points.length; i++) {
      const a = points[i % points.length], b = points[(i + 1) % points.length], mid = a.clone().lerp(b, 0.5);
      shape.quadraticCurveTo(a.x, a.y, mid.x, mid.y);
    }
    shape.closePath();
    const source = new THREE.ExtrudeGeometry(shape, { depth: 4e-3, bevelEnabled: false, curveSegments: 5 });
    const sourcePositions = source.getAttribute("position"), positions = [], materialIndices = [];
    for (let i = 0; i < sourcePositions.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(sourcePositions, i), b = new THREE.Vector3().fromBufferAttribute(sourcePositions, i + 1), c = new THREE.Vector3().fromBufferAttribute(sourcePositions, i + 2);
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      subdivide(a, b, c, 1, normal.z > 0 ? 0 : 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const uvs = [];
    for (let i = 0; i < positions.length; i += 3) uvs.push((positions[i] / 3e-3 + 886) / 1772, 1 - (750 - positions[i + 1] / 3e-3) / 1329);
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    source.dispose();
    let start = 0;
    for (let i = 1; i <= materialIndices.length; i++) if (materialIndices[i] !== materialIndices[start]) {
      geometry.addGroup(start * 3, (i - start) * 3, materialIndices[start]);
      start = i;
    }
    const mesh = new THREE.Mesh(geometry, [painted, paper]);
    mesh.name = id + "-shell";
    pivot.add(mesh);
    if (id === "centre") pivot.position.z = 8e-3;
  }
  const bamboo = new THREE.MeshStandardMaterial({ color: 11897936, roughness: 0.72 });
  const cord = new THREE.MeshStandardMaterial({ color: 10188357, roughness: 0.96 });
  bamboo.bumpMap = microMap(159);
  bamboo.bumpScale = 7e-4;
  bamboo.roughnessMap = microMap(160, true);
  const vec = ([x, y, z]) => new THREE.Vector3((x - 886) * 3e-3, (750 - y) * 3e-3, z ?? -0.022 - 0.028 * ((x - 886) / 886) ** 2);
  function tube(id, name, points, r = 0.012, mat = bamboo) {
    const g = new THREE.Group();
    g.name = name;
    g.userData.partId = id;
    root.add(g);
    parts.set(id, g);
    const curve = new THREE.CatmullRomCurve3(points.map(vec));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r, 8, false), mat);
    m.name = id + "-bamboo";
    g.add(m);
    const socket2 = new THREE.Object3D();
    socket2.position.copy(vec(points[0]));
    socket2.name = id + "-join";
    root.add(socket2);
    sockets.set(socket2.name, socket2);
    return g;
  }
  tube("spine", "\u4E2D\u592E\u7AF9\u810A", [[885, 390], [879, 700], [890, 1140]], 0.014);
  tube("crossSpar", "\u5F13\u5F62\u6A2A\u7AF9", [[8, 650], [360, 498], [740, 499], [1e3, 500], [1400, 502], [1764, 650]], 0.013);
  tube("lowerSpar", "\u4E0B\u7F18\u627F\u529B\u7AF9", [[15, 737], [350, 944], [735, 824], [1020, 824], [1400, 944], [1757, 737]], 0.011);
  const ribs = [[[740, 500], [610, 690], [370, 946]], [[740, 500], [440, 622], [80, 680]], [[740, 824], [410, 770], [12, 710]], [[1e3, 500], [1160, 690], [1400, 946]], [[1e3, 500], [1340, 622], [1692, 680]], [[1020, 824], [1390, 770], [1760, 710]]];
  ribs.forEach((pts, i) => tube("rib" + i, "\u7FFC\u9762\u7AF9\u9AA8 " + (i + 1), pts, 9e-3));
  const anchorPoints = [[742, 502], [1e3, 502], [880, 824], [885, 665], [370, 946], [1400, 946], [80, 680], [1692, 680]];
  anchorPoints.forEach(([x, y], i) => {
    const g = new THREE.Group();
    g.name = "\u7ED1\u624E\u7EBF\u7ED3 " + (i + 1);
    g.position.copy(vec([x, y]));
    g.userData.partId = "knot" + i;
    root.add(g);
    parts.set("knot" + i, g);
    for (let n = 0; n < 4; n++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.019, 28e-4, 5, 12), cord);
      m.rotation.y = Math.PI / 2;
      m.position.x = (n - 1.5) * 6e-3;
      m.name = "knot" + i + "-wrap" + n;
      g.add(m);
    }
  });
  const bridle = new THREE.Group();
  bridle.name = "\u4E09\u70B9\u63D0\u7EBF";
  bridle.userData.partId = "bridle";
  root.add(bridle);
  parts.set("bridle", bridle);
  const junction = new THREE.Vector3(0, -0.05, 0.6);
  for (const p of [[745, 650, 0.015], [1020, 650, 0.015], [880, 1e3, 0.015]]) {
    const curve = new THREE.LineCurve3(vec(p), junction);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 35e-4, 6, false), cord);
    m.name = "\u63D0\u7EBF\u652F\u7D22";
    bridle.add(m);
  }
  const socket = new THREE.Object3D();
  socket.name = "tether";
  socket.position.copy(junction);
  bridle.add(socket);
  sockets.set("tether", socket);
  for (const y of [505, 680, 855, 1030]) {
    const node = new THREE.Mesh(new THREE.TorusGeometry(0.0148, 18e-4, 4, 12), bamboo);
    node.rotation.x = Math.PI / 2;
    node.position.copy(vec([884, y]));
    node.name = "\u7AF9\u8282\u7EC6\u73AF";
    node.userData.explodeWithParent = true;
    parts.get("spine").add(node);
  }
  root.userData.sculptRuntime = { parts, pivots: parts, sockets, colliders: [{ type: "box", size: [5.3, 2.4, 0.1] }], specId: "weifang-bird-kite", pass: "surface-pass" };
  const basePositions = /* @__PURE__ */ new Map();
  for (const [id, g] of parts) {
    basePositions.set(id, g.position.clone());
    g.userData.partId = id;
  }
  const constructionOrder = [...parts.keys()].filter((k) => !Object.hasOwn(design.panels, k) && k !== "bridle");
  const panelNames = { wingLeft: "\u5DE6\u4FA7\u5F69\u7ED8\u7FFC\u9762", wingRight: "\u53F3\u4FA7\u5F69\u7ED8\u7FFC\u9762", centre: "\u4EBA\u7269\u4E0E\u9E64\u9E1F\u4E2D\u592E\u7EB8\u9762" };
  for (const [id, g] of parts) if (panelNames[id]) g.name = panelNames[id];
  const plain = paper.clone();
  plain.side = THREE.FrontSide;
  let separation = 0;
  function update(time, stage = 3, progress = 1) {
    const build = Math.min(1, Math.max(0, progress));
    for (const [id, g] of parts) {
      const isPanel = Object.hasOwn(design.panels, id), isBridle = id === "bridle";
      g.visible = isPanel ? stage > 0 : isBridle ? stage >= 2 : true;
      const base = basePositions.get(id);
      g.position.copy(base);
      g.scale.setScalar(1);
      if (stage === 0) {
        const order = constructionOrder.indexOf(id);
        g.visible = !isPanel && !isBridle && order >= 0 && order < Math.ceil(build * 18);
      }
      if (isPanel) {
        const m = g.children[0];
        m.material = [stage === 1 ? plain : painted, paper];
        const index = ["wingLeft", "wingRight", "centre"].indexOf(id);
        g.scale.setScalar(stage === 1 ? Math.max(1e-3, Math.min(1, build * 3 - index)) : 1);
        g.position.z += separation * (id === "centre" ? 0.7 : 0.52);
      } else if (!isBridle) {
        g.position.x = base.x * (1 + separation * 0.08);
        g.position.z -= separation * 0.32;
      } else g.position.z += separation * 0.95;
    }
    for (const id of ["wingLeft", "wingRight"]) {
      const g = parts.get(id);
      g.rotation.y = stage === 3 ? Math.sin(time * 1.2) * 9e-3 : 0;
    }
    paintReveal.value = stage === 2 ? build * 1.2 : 1;
    painted.color.setScalar(1);
  }
  return { root, parts, update, explode: (value) => {
    separation = value;
  }, materials: { painted, paper }, sockets };
}
export {
  createKiteModel
};
