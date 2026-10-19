// Museum-image projection for The Met 1982.472.4, Emperor shadow puppet.
// The one available front photograph records outline and incision, not original pigment.
// Each visible component is an independently movable, very thin plane. Its UVs retain
// the component's source-image coordinates; unseen surfaces remain unprojected.
const PHOTO_WIDTH=606, PHOTO_HEIGHT=894, SCALE=.00124;
const toX=x=>(x-303)*SCALE, toY=y=>(450-y)*SCALE;

export function createEmperorPuppet(THREE){
  const root=new THREE.Group();
  root.name='馆藏帝王影人 · 照片纹样投射';
  const photo=new THREE.TextureLoader().load('./reference-delit.png');
  photo.colorSpace=THREE.SRGBColorSpace;
  photo.anisotropy=8;
  photo.wrapS=photo.wrapT=THREE.ClampToEdgeWrapping;
  const material=new THREE.ShaderMaterial({
    uniforms:{photo:{value:photo},ink:{value:new THREE.Color(0xe6bd83)},opacity:{value:1}},
    vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform sampler2D photo; uniform vec3 ink; uniform float opacity; varying vec2 vUv;
      void main(){vec3 rgb=texture2D(photo,vUv).rgb;float l=dot(rgb,vec3(.299,.587,.114));
      float cut=1.0-smoothstep(.60,.84,l); if(cut<.025)discard;
      vec3 parchment=mix(vec3(.12,.071,.043),ink,smoothstep(.02,.87,l));
      gl_FragColor=vec4(parchment,cut*opacity);}`,
    transparent:true,side:THREE.DoubleSide,depthWrite:false
  });
  // Image region is an actual mapped plane, with fine openings supplied by the
  // photographed engraving. Separate broad pieces permit shoulder and neck motion.
  function piece(name,outline,pivot,parent=root,z=0){
    const [px,py]=pivot;
    const group=new THREE.Group();group.name=name+'关节';group.position.set(toX(px),toY(py),z);parent.add(group);
    const shape=new THREE.Shape();
    outline.forEach(([x,y],i)=>i?shape.lineTo((x-px)*SCALE,(py-y)*SCALE):shape.moveTo((x-px)*SCALE,(py-y)*SCALE));
    shape.closePath();
    const geometry=new THREE.ShapeGeometry(shape);
    const uv=geometry.attributes.uv;
    const position=geometry.attributes.position;
    for(let i=0;i<position.count;i++){
      const x=px+position.getX(i)/SCALE,y=py-position.getY(i)/SCALE;
      uv.setXY(i,x/PHOTO_WIDTH,1-y/PHOTO_HEIGHT);
    }
    uv.needsUpdate=true;
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=name;
    mesh.renderOrder=Math.round(z*1000);
    group.add(mesh);
    return group;
  }
  piece('左足',[[125,807],[173,805],[211,836],[244,858],[196,873],[140,863]], [181,807],root,.012);
  piece('右足',[[393,814],[439,806],[489,830],[513,850],[462,887],[414,878],[386,842]], [447,794],root,.012);
  piece('左袍片',[[263,467],[311,474],[313,562],[308,676],[299,835],[236,833],[122,811],[129,784],[203,684],[244,606]], [303,490],root,.021);
  piece('右袍片',[[312,475],[398,478],[415,570],[442,652],[537,790],[538,810],[329,841],[321,786],[314,678]], [303,490],root,.023);
  piece('上身龙纹',[[284,250],[325,258],[352,288],[362,323],[358,379],[417,393],[436,443],[420,505],[394,529],[256,524],[240,503],[261,438],[248,363],[259,313]], [310,330],root,.03);
  const left=piece('左袖与手',[[263,326],[278,354],[259,392],[226,438],[175,457],[93,470],[91,422],[59,419],[7,386],[71,369],[94,347],[137,349],[197,361]], [261,345],root,.045);
  const right=piece('右袖与手',[[353,317],[407,311],[491,291],[544,281],[545,324],[524,373],[548,390],[594,438],[561,429],[528,409],[495,416],[426,394],[361,369]], [361,319],root,.046);
  const head=piece('侧脸与冠饰',[[305,12],[324,15],[329,47],[358,54],[384,49],[386,16],[411,13],[422,43],[438,50],[466,117],[464,151],[447,172],[394,195],[426,221],[443,270],[412,287],[376,224],[348,201],[335,250],[292,260],[250,230],[231,193],[226,174],[250,157],[242,137],[252,110],[295,98]], [307,253],root,.055);
  const rodMat=new THREE.MeshBasicMaterial({color:0x684b30,transparent:true,opacity:.7});
  function rod(name){const group=new THREE.Group();group.name=name;root.add(group);
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.0015,.0015,1,6),rodMat);group.add(shaft);return {group,shaft};}
  const rods={left:rod('左手竹扦'),right:rod('右手竹扦'),main:rod('身部竹扦')};
  const axis=new THREE.Vector3(0,1,0);
  function connect(item,a,b){const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),delta=vb.clone().sub(va);
    item.shaft.position.copy(va.add(vb).multiplyScalar(.5));item.shaft.scale.set(1,delta.length(),1);
    item.shaft.quaternion.setFromUnitVectors(axis,delta.normalize());}
  function pose({left:leftAngle=0,right:rightAngle=0,nod=0,travel=0}={}){
    left.rotation.z=leftAngle;right.rotation.z=rightAngle;head.rotation.z=nod;root.position.x=travel;
    root.updateWorldMatrix(true,true);
    const leftEnd=left.localToWorld(new THREE.Vector3(toX(48)-toX(261),toY(381)-toY(345),0));
    const rightEnd=right.localToWorld(new THREE.Vector3(toX(548)-toX(361),toY(398)-toY(319),0));
    root.worldToLocal(leftEnd);root.worldToLocal(rightEnd);
    connect(rods.left,[leftEnd.x,leftEnd.y,.07],[leftEnd.x-.04,-.55,.1]);
    connect(rods.right,[rightEnd.x,rightEnd.y,.07],[rightEnd.x+.04,-.55,.1]);
    connect(rods.main,[toX(313),toY(330),.01],[toX(315)+.035,-.54,.09]);
  }
  root.userData={source:'The Met 1982.472.4',actualHeightMetres:.686,projection:'single frontal monochrome photograph',unseenSurfaces:'not reconstructed'};
  pose();
  return {root,arms:{left,right},head,rods,pose};
}
