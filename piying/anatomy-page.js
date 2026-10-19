const museum='https://www.metmuseum.org/art/collection/search/60991';
const china='https://www.cnmuseum.com/cn/category/2509/0317-1.htm';
const conservation='https://cool.culturalheritage.org/jaic/articles/jaic40-01-001.html';
const beijing='https://www.bjdch.gov.cn/mldc/bglj/fwzwhyc/ctxj/202401/t20240123_3543098.html';
const materials='https://lyzz.visitbeijing.com.cn/news/detail?id=24191';
const svg=content=>`<svg viewBox="0 0 320 240" role="img" aria-label="连接方式分层图"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#b25335"/></marker></defs>${content}</svg>`;
const diagrams={
  head:svg(`<path class="part" d="M121 29Q160 13 200 29L192 83H174L171 130H149L146 83H126Z"/><path class="guide" d="M160 101V150" marker-end="url(#arrow)"/><path class="soft" d="M80 159Q159 141 241 159L241 212H80Z"/><path d="M137 153V186H183V153" fill="#f9edd5" stroke="#7f4d30" stroke-width="4"/><text x="205" y="68">头茬下端</text><text x="206" y="90">插片 / 楔口</text><text x="28" y="145">领口卡槽</text><text x="106" y="231">胸片承托</text>`),
  shoulder:svg(`<path class="part" d="M33 76Q94 54 164 76L169 168Q104 188 32 165Z"/><path class="soft" d="M147 82Q218 62 295 96L278 161Q219 177 150 160Z"/><circle cx="157" cy="123" r="29" fill="#f5e0b6" stroke="#7b3d2b" stroke-width="3"/><circle cx="157" cy="123" r="9" fill="#f4e1bc" stroke="#804b32" stroke-width="3"/><path d="M146 118Q157 95 169 119Q176 146 157 147Q139 146 146 118Z" fill="none" stroke="#51463d" stroke-width="4"/><path class="guide" d="M228 52Q278 58 285 111" marker-end="url(#arrow)"/><text x="34" y="56">躯干皮片</text><text x="212" y="202">袖片</text><text x="93" y="220">穿孔 + 线缀</text>`),
  elbow:svg(`<path class="part" d="M28 92L121 76L137 128L47 151Z"/><path class="soft" d="M137 93L231 72L240 123L153 144Z"/><path class="part" d="M235 89L292 104L301 126L238 126Z"/><circle cx="139" cy="116" r="21" fill="#eed4a7" stroke="#7d462f" stroke-width="3"/><circle cx="235" cy="104" r="14" fill="#eed4a7" stroke="#7d462f" stroke-width="3"/><path d="M139 99V132M122 116H155M235 93V115M225 104H246" stroke="#a4603b" stroke-width="3"/><path class="guide" d="M74 53Q124 34 153 70M173 170Q229 181 252 147" marker-end="url(#arrow)"/><text x="34" y="190">上臂</text><text x="146" y="199">下臂</text><text x="252" y="194">手</text><text x="48" y="222">放射形镂孔减少叠片暗斑</text>`),
  hand:svg(`<path class="part" d="M31 69Q90 48 168 76L164 134Q89 148 31 127Z"/><path class="soft" d="M163 87L223 78L260 103L219 125L163 120Z"/><circle cx="221" cy="103" r="10" fill="#f9edce" stroke="#814e36" stroke-width="3"/><path class="metal" d="M221 113Q248 151 238 181"/><path d="M238 181L258 229" fill="none" stroke="#9c683e" stroke-width="13" stroke-linecap="round"/><path class="guide" d="M95 186Q140 160 183 145" marker-end="url(#arrow)"/><text x="29" y="201">牵引方向</text><text x="35" y="47">袖 / 手</text><text x="252" y="153">金属丝</text><text x="228" y="218">竹柄</text>`),
  main:svg(`<path class="part" d="M80 53Q159 30 237 55L252 187Q163 207 65 189Z"/><path d="M125 58V100H190V57" fill="#f9edcf" stroke="#713d2b" stroke-width="4"/><path d="M206 56Q249 91 267 139" fill="none" stroke="#4a504b" stroke-width="6"/><path d="M267 139L284 227" fill="none" stroke="#9d6b42" stroke-width="11" stroke-linecap="round"/><path class="guide" d="M221 214Q181 187 143 185" marker-end="url(#arrow)"/><text x="30" y="42">领口</text><text x="62" y="224">胸片</text><text x="241" y="71">金属连接</text><text x="265" y="204">身杆</text>`),
  material:svg(`<rect x="36" y="53" width="235" height="120" rx="10" fill="#c07945" stroke="#763d29" stroke-width="4"/><path d="M49 68Q75 81 71 104M109 78Q135 102 118 145M190 69Q161 101 204 139M234 88Q224 122 246 151" fill="none" stroke="#fae3ac" stroke-width="8"/><circle cx="99" cy="126" r="14" fill="#fbf2df"/><circle cx="225" cy="109" r="10" fill="#fbf2df"/><path d="M289 49L246 91M289 127L242 128" stroke="#e0a84d" stroke-width="6" marker-end="url(#arrow)"/><text x="31" y="35">彩绘、镂刻的半透明兽皮</text><text x="44" y="203">透光部位与镂空孔</text>`)
};
const data=[
  {id:'head',n:'01',tab:'头茬卡口',title:'可换的头茬',summary:'头部与身段并非一整片。相近类型的影人将头下端插入胸片的领口，使角色头茬可以替换。',focus:[210,100,195,190],hot:[307,253],crop:'头与领口',badges:['馆藏正面可见','内部插槽不可见'],observed:'照片显示头、冠、颈和胸片的界线；大都会记录列有麻、棉铰接与金属固定材料，但未注明它们分别位于哪处。',analog:'中国民族博物馆的罗山影人资料具体描述“头下端楔子—胸上部卡口”；美国自然历史博物馆的北京东城类型研究也记载可换头。',scope:'上图是头茬插接的机理示意，不能把罗山影人的卡口形制直接归给这件大都会藏品。',sources:[['大都会：本件材料清单',museum],['中国民族博物馆：罗山影人分件',china],['馆藏保护研究：可换头',conservation]]},
  {id:'shoulder',n:'02',tab:'肩部叠片',title:'叠片转动的肩',summary:'躯干片与袖片相叠，在穿孔处连接。手杆牵引袖片时，肩部成为转动中心。',focus:[218,275,205,187],hot:[260,347],crop:'躯干与左袖交界',badges:['照片可见叠片边界','缝接位置推定'],observed:'馆藏照片能辨认宽袖与上身的交叠；其记录列有 wire fastenings 与 hemp/cotton hingings，未提供这处肩点的微观照片。',analog:'中国民族博物馆记载胸、臂可在同点钉结，使用棉线连缀；馆藏保护研究还记录丝线、棉线、皮瓣及偶见金属丝等连接材料。',scope:'图中的线圈代表可活动的穿孔连接方式，不表示此件影人的肩部一定使用图示材料或绕法。',sources:[['大都会：本件材质与连接材料',museum],['中国民族博物馆：手臂连缀',china],['馆藏保护研究：关节材料',conservation]]},
  {id:'elbow',n:'03',tab:'肘与手',title:'上臂、前臂、手',summary:'复杂影人可把手臂做成多段，让袖口和手势分开活动；交叠处可能出现放射形透光镂孔。',focus:[76,319,192,180],hot:[150,391],crop:'左袖内的分段',badges:['本件分段边界不清','同类藏品比较'],observed:'原照显示宽袖和伸出的手，无法清楚分辨袖内是否另有一个独立肘部枢轴。',analog:'中国民族博物馆的罗山影人分上臂、前臂与手；美国自然历史博物馆的北京东城类型研究描述“轮辐状”关节镂孔，可减轻皮片重叠造成的暗斑。',scope:'这里呈现“可分段的同类工艺”，并未给本件藏品补造可确认的肘关节。',sources:[['中国民族博物馆：上臂、前臂与手',china],['馆藏保护研究：轮辐状关节镂孔',conservation]]},
  {id:'hand',n:'04',tab:'手杆接口',title:'手杆如何牵动袖',summary:'从手部附近发力，力经金属丝或连接件传到手，再传到袖片，最终绕肩部转动。',focus:[0,336,171,163],hot:[50,383],crop:'左手与可见手杆',badges:['左手杆在原照可见','接头细节推定'],observed:'本件左侧照片可见伸出的手与细长操纵杆；大都会材质栏列竹杆、金属丝固定件和金属杆。',analog:'美国自然历史博物馆的同类馆藏研究记载“金属丝配竹柄”的操纵方式；北京东城资料也说明常在颈与双手安三杆。',scope:'分层图说明传力顺序。原照没有清晰显示手杆末端的固定构造，故孔位和金属丝形状均为推定。',sources:[['大都会：竹杆与金属连接材料',museum],['馆藏保护研究：金属丝和竹柄',conservation],['北京东城：三杆位置',beijing]]},
  {id:'main',n:'05',tab:'身杆支撑',title:'身杆托住胸片',summary:'身杆负责定位影人在影窗中的位置；另外两根手杆负责动作，三点协作才能同时移动和挥袖。',focus:[253,248,185,220],hot:[314,407],crop:'胸片与领口',badges:['馆藏杆材有记录','本件具体固定点不明'],observed:'大都会记录含竹杆和金属杆；正面照的躯干花纹繁密，不能直接看清身杆与胸片的固定点。',analog:'中国民族博物馆记载胸片上端卡口可作为身杆连接点；北京东城资料称传统影人常在脖子和双手安三杆，特殊动作可另加脚杆。',scope:'图示让杆在胸片后方连接，属机理说明。真实杆端形状、方向、杆长仍需背面照片或馆藏测绘。',sources:[['大都会：本件材料清单',museum],['中国民族博物馆：胸片与三杆',china],['北京东城：普通与特殊操纵杆',beijing]]},
  {id:'material',n:'06',tab:'皮材与镂孔',title:'为什么关节要透光',summary:'皮片重叠会让影窗上的局部变暗。轮辐状镂孔、较薄的皮料和彩绘共同决定影像的明暗层次。',focus:[231,424,206,221],hot:[317,548],crop:'袍服镂刻与透光纹样',badges:['本件牛皮和彩绘有记录','透光机理来自同类研究'],observed:'大都会记录这件影人为“绘制并刻划的牛皮”，照片显示密集的镂刻纹样。',analog:'美国自然历史博物馆的北京东城类型研究指出，关节附近的放射形切口可避免两层皮叠合形成大块暗影；较薄皮料更透光。',scope:'示意图没有推断本件使用桐油或具体皮料厚度。孝义艺人关于不同部位选皮的说明可供理解，但不等于本件检测结果。',sources:[['大都会：牛皮、彩绘、刻划',museum],['馆藏保护研究：皮材与镂孔',conservation],['孝义皮影制作者访谈：部位选皮',materials]]}
];
const $=s=>document.querySelector(s),tabs=$('#tabs'),hotspots=$('#hotspots');
for(const [i,item] of data.entries()){
  const tab=document.createElement('button');tab.className='tab';tab.textContent=`${item.n} ${item.tab}`;tab.type='button';tab.onclick=()=>render(i);tabs.append(tab);
  const hot=document.createElement('button');hot.className='hotspot';hot.type='button';hot.textContent=item.n;hot.style.left=`${item.hot[0]/606*100}%`;hot.style.top=`${item.hot[1]/894*100}%`;hot.setAttribute('aria-label',item.tab);hot.onclick=()=>render(i);hotspots.append(hot);
}
let active=0;
function drawCrop(){const item=data[active],view=$('#crop-view'),img=view.querySelector('img');
  const [x,y,w,h]=item.focus,scale=Math.max(view.clientWidth/w,view.clientHeight/h);
  img.style.width=`${606*scale}px`;img.style.height=`${894*scale}px`;
  img.style.left=`${(view.clientWidth-w*scale)/2-x*scale}px`;
  img.style.top=`${(view.clientHeight-h*scale)/2-y*scale}px`;
}
function render(i){active=i;const item=data[i];
  [...tabs.children].forEach((node,n)=>node.setAttribute('aria-pressed',String(n===i)));
  [...hotspots.children].forEach((node,n)=>node.setAttribute('aria-pressed',String(n===i)));
  const [x,y,w,h]=item.focus,focus=$('#focus');
  Object.assign(focus.style,{left:`${x/606*100}%`,top:`${y/894*100}%`,width:`${w/606*100}%`,height:`${h/894*100}%`});
  $('#index').textContent=`OBSERVATION ${item.n} / 06`;$('#title').textContent=item.title;$('#summary').textContent=item.summary;
  $('#crop-name').textContent=item.crop;$('#observed').textContent=item.observed;$('#analog').textContent=item.analog;$('#scope').textContent=item.scope;
  $('#badges').replaceChildren(...item.badges.map((label,n)=>{const span=document.createElement('span');span.className=`badge ${n?'inferred':'observed'}`;span.textContent=label;return span;}));
  $('#mechanic').innerHTML=diagrams[item.id];
  $('#sources').replaceChildren(...item.sources.map(([label,url])=>{const li=document.createElement('li'),a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=`${label} ↗`;li.append(a);return li;}));
  requestAnimationFrame(drawCrop);
}
addEventListener('resize',drawCrop);
addEventListener('keydown',event=>{if(event.key==='ArrowRight')render((active+1)%data.length);if(event.key==='ArrowLeft')render((active+data.length-1)%data.length);});
render(0);
