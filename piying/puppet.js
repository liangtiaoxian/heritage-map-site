// img2threejs reconstruction target: The Met 1982.472.4, Emperor shadow puppet.
// Procedural front-view interpretation from one monochrome photograph. Units: meters.
// The original height is 0.686 m. Reverse, true colors, and exact pivot layout are unknown.
const U=.686;
export function createEmperorPuppet(THREE){
  const root=new THREE.Group();root.name='馆藏皮影影人：帝王';
  const colors={leather:0x8e3028,amber:0xd88637,dark:0x2b1715,incision:0xffd88b,rod:0x8e6037};
  const mat=(hex,opacity=.92)=>new THREE.MeshPhysicalMaterial({color:hex,side:THREE.DoubleSide,roughness:.68,metalness:0,transparent:opacity<1,opacity,depthWrite:true,clearcoat:.05});
  const red=mat(colors.leather,.83),gold=mat(colors.amber,.84),dark=mat(colors.dark,.9),lineMat=new THREE.MeshBasicMaterial({color:colors.incision,side:THREE.DoubleSide,transparent:true,opacity:.9,depthWrite:false});
  const segment=(points,material,name,parent=root,holes=[])=>{
    const shape=new THREE.Shape();points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
    for(const [x,y,rx,ry] of holes){const p=new THREE.Path();p.absellipse(x,y,rx,ry,0,Math.PI*2,true);shape.holes.push(p);}
    const mesh=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.004,bevelEnabled:true,bevelThickness:.001,bevelSize:.001,bevelSegments:1}),material);
    mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const stroke=(points,width=.0025,parent=root,material=lineMat,z=.008)=>{
    const curve=new THREE.CatmullRomCurve3(points.map(([x,y])=>new THREE.Vector3(x,y,z)));
    const m=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(8,points.length*6),width,4,false),material);m.castShadow=false;parent.add(m);return m;
  };
  const ring=(x,y,r,parent=root,material=lineMat)=>{const m=new THREE.Mesh(new THREE.TorusGeometry(r,.0017,4,18),material);m.position.set(x,y,.009);parent.add(m);return m;};
  const pin=(x,y,parent)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.008,14),new THREE.MeshStandardMaterial({color:0x5c3021,metalness:.2,roughness:.45}));m.rotation.x=Math.PI/2;m.position.set(x,y,.012);parent.add(m);ring(x,y,.0045,parent);};
  const torso=segment([[-.105,.31],[.075,.31],[.12,.18],[.103,.035],[-.11,.035],[-.14,.19]],red,'雕花躯干');
  const collar=segment([[-.106,.31],[.073,.31],[.05,.263],[-.08,.262]],dark,'领部');
  for(let i=0;i<6;i++)stroke([[-.075+i*.023,.302],[-.063+i*.023,.278],[-.053+i*.023,.262]],.002);
  const waist=segment([[-.116,.052],[.107,.052],[.121,-.003],[-.119,-.003]],gold,'束带');
  const skirtLeft=segment([[-.12,-.002],[-.01,-.002],[.005,-.24],[-.045,-.31],[-.225,-.285],[-.19,-.205]],red,'左袍片');
  const skirtRight=segment([[.01,-.002],[.118,-.002],[.208,-.28],[.04,-.31],[-.012,-.245]],red,'右袍片');
  segment([[-.22,-.28],[-.08,-.302],[-.07,-.34],[-.19,-.348]],dark,'左履');
  segment([[.045,-.301],[.191,-.281],[.205,-.337],[.07,-.348]],dark,'右履');
  const head=new THREE.Group();head.name='侧脸与冠饰';head.position.set(-.042,.313,.014);root.add(head);
  segment([[-.055,.025],[-.06,.095],[-.099,.122],[-.105,.162],[-.083,.2],[-.022,.21],[.055,.185],[.077,.135],[.045,.044],[-.006,.005]],gold,'侧脸',head);
  // Reference shows a hooked nose pointing toward the left and a hanging beard.
  segment([[-.098,.141],[-.143,.119],[-.133,.107],[-.092,.111],[-.073,.135]],gold,'钩鼻',head);
  segment([[-.068,.018],[-.022,-.004],[.014,-.115],[-.016,-.13],[-.061,-.034]],dark,'长须',head);
  segment([[-.08,.196],[.024,.227],[.07,.205],[.059,.184],[-.08,.17]],dark,'额冠',head);
  segment([[-.01,.204],[.125,.24],[.172,.312],[.125,.39],[.063,.355],[.038,.30]],gold,'高冠',head);
  stroke([[-.074,.09],[-.055,.114],[-.02,.105]],.003,head);ring(-.052,.119,.008,head);
  for(let i=0;i<5;i++){const xx=.061+i*.021;ring(xx,.267+Math.sin(i)*.012,.008,head);}
  for(let i=0;i<4;i++)stroke([[.04+i*.025,.224],[.064+i*.025,.27],[.073+i*.025,.337]],.0017,head);
  const arms={};
  for(const [side,sign] of [['left',-1],['right',1]]){
    const pivot=new THREE.Group();pivot.name=side==='left'?'左袖铰接':'右袖铰接';pivot.position.set(sign*.103,.247,.019);root.add(pivot);arms[side]=pivot;
    const pts=[[0,.043],[sign*.096,.045],[sign*.245,.084],[sign*.26,-.075],[sign*.133,-.089],[sign*.04,-.016]];
    segment(pts,side==='left'?gold:red,side==='left'?'左宽袖':'右宽袖',pivot,
      [[sign*.16,-.024,.009,.008],[sign*.21,-.028,.006,.007]]);
    segment([[sign*.22,-.036],[sign*.296,-.038],[sign*.318,-.063],[sign*.255,-.067]],gold,side==='left'?'左手':'右手',pivot);
    pin(0,0,pivot);
    stroke([[sign*.045,.013],[sign*.115,.02],[sign*.205,.04]],.0022,pivot);
    for(let i=0;i<4;i++)stroke([[sign*(.088+i*.029),-.06],[sign*(.103+i*.029),-.031],[sign*(.09+i*.029),.008]],.0018,pivot);
    for(const x of [.09,.14,.19])ring(sign*x,-.032,.011,pivot);
  }
  // Dense incised ornament follows the broad robe mass; true pigments are not visible in the source.
  for(let i=0;i<10;i++){
    const y=-.035-i*.025,spread=.08+i*.010;
    stroke([[-spread,y],[-spread*.55,y+.01],[0,y-.003],[spread*.55,y+.01],[spread,y]],.0016);
  }
  for(let i=0;i<13;i++){
    const x=-.18+i*.03;stroke([[x,-.245],[x+.01,-.264],[x,-.283]],.00145);
  }
  for(let i=0;i<4;i++){
    const x=-.075+i*.045;ring(x,.13,.018);stroke([[x-.019,.13],[x,.158],[x+.019,.13]],.0015);
  }
  for(const x of [-.08,-.038,.005,.047,.09])ring(x,.023,.008);
  const rodMaterial=new THREE.MeshStandardMaterial({color:colors.rod,roughness:.75});
  function makeRod(name){const g=new THREE.Group();g.name=name;root.add(g);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.003,.003,1,8),rodMaterial);mesh.castShadow=true;g.add(mesh);return {g,mesh};}
  const rods={main:makeRod('身部操纵杆'),left:makeRod('左手操纵杆'),right:makeRod('右手操纵杆')};
  const v=new THREE.Vector3(),q=new THREE.Vector3();
  function updateRod(rod,a,b){v.set(...a);q.set(...b);const mid=v.clone().add(q).multiplyScalar(.5),len=v.distanceTo(q);rod.mesh.position.copy(mid);rod.mesh.scale.set(1,len,1);rod.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),q.sub(v).normalize());}
  function pose({left=0,right=0,nod=0,travel=0}={}){
    arms.left.rotation.z=left;arms.right.rotation.z=right;head.rotation.z=nod;root.position.x=travel;
    const lp=new THREE.Vector3(-.395,.19,.03).applyMatrix4(arms.left.matrixWorld),rp=new THREE.Vector3(.395,.19,.03).applyMatrix4(arms.right.matrixWorld);
    root.updateWorldMatrix(true,true);
    const a=arms.left.localToWorld(new THREE.Vector3(-.296,-.055,0));const b=arms.right.localToWorld(new THREE.Vector3(.296,-.055,0));
    root.worldToLocal(a);root.worldToLocal(b);
    updateRod(rods.left,[a.x,a.y,.018],[a.x-.06,-.47,.07]);
    updateRod(rods.right,[b.x,b.y,.018],[b.x+.06,-.47,.07]);
    updateRod(rods.main,[0,.12,-.005],[.05,-.48,.04]);
  }
  root.scale.setScalar(U);root.userData={source:'The Met 1982.472.4',actualHeightMetres:.686,illustrativePalette:true};
  pose();
  return {root,arms,head,rods,pose};
}
