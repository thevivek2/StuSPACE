window.$=s=>document.querySelector(s);
window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.api=async(url,opt={})=>{const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||r.statusText),{data:d,status:r.status});return d};
window.post=(u,b)=>api(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});
window.put=(u,b)=>api(u,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});
window.show=(el,t,ok)=>{el.innerHTML=`<div class="msg ${ok?'ok':'err'}">${esc(t)}</div>`};
window.fmt=t=>new Date(t).toLocaleString();
window.initials=n=>n.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();

// generic action icons (monochrome, inherit text colour)
(()=>{const s=p=>'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>';
window.IC={save:s('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>')+'Save',
update:s('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>')+'Update',
del:s('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>')+'Delete',
cancel:s('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>')+'Cancel'};
window.ICON={
menu:s('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>'),
dash:s('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'),
video:s('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
coin:s('<circle cx="12" cy="12" r="9"/><path d="M14.8 9a2.8 2.8 0 0 0-2.8-1.5c-1.6 0-2.8.9-2.8 2.1 0 3 5.6 1.5 5.6 4.4 0 1.2-1.2 2.1-2.8 2.1A2.9 2.9 0 0 1 9 14.5"/><line x1="12" y1="6" x2="12" y2="7.5"/><line x1="12" y1="16.5" x2="12" y2="18"/>'),
users:s('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>'),
send:s('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
shuffle:s('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>'),
lock:s('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
logout:s('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
inbox:s('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>'),
shield:s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
list:s('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
mail:s('<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/>'),
cfg:s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
pulse:s('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
tag:s('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
play:s('<polygon points="5 3 19 12 5 21 5 3"/>'),
rec:s('<circle cx="12" cy="12" r="8"/>'),
check:s('<polyline points="20 6 9 17 4 12"/>'),
dir:s('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-2 2-3 3.5-3s2.9 1 3.5 3"/><line x1="15" y1="9" x2="18" y2="9"/><line x1="15" y1="13" x2="18" y2="13"/>'),
space:s('<circle cx="12" cy="12" r="5"/><path d="M3.2 15.5C1.8 13.2 6.5 9.7 12 8.4s10.3-.9 9.8 1.6c-.5 2.3-5.2 5.8-10.7 7.1" transform="rotate(-12 12 12)"/><circle cx="20" cy="4.5" r="0.8"/><circle cx="4.5" cy="5" r="0.8"/>'),
info:s('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
refresh:s('<polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>')}})();

ICON.history='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></svg>';
const EMBED=window.parent!==window; // true when shown inside the home page panel / overlay
if(EMBED)document.documentElement.classList.add('embed');
const here=location.pathname.split('/').pop()||'index.html';
const link=(h,t,c='')=>`<a href="${h}" class="${c} ${here===h||(h==='/'&&here==='index.html')?'on':''}">${t}</a>`;
if(!document.querySelector('link[rel=icon]'))document.head.insertAdjacentHTML('beforeend','<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
window.ART={robot:`<svg viewBox="0 0 220 240" class="robot" role="img" aria-label="AI buddy"><defs><radialGradient id="rglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7c5cff" stop-opacity=".55"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
<linearGradient id="rh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d4c6ff"/></linearGradient>
<linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient></defs>
<circle cx="110" cy="125" r="108" fill="url(#rglow)"/>
<line x1="110" y1="30" x2="110" y2="50" stroke="#c9b8ff" stroke-width="4" stroke-linecap="round"/><circle class="pulse" cx="110" cy="24" r="8" fill="#ff6bb5"/>
<rect x="38" y="82" width="12" height="30" rx="6" fill="#7c5cff"/><rect x="170" y="82" width="12" height="30" rx="6" fill="#7c5cff"/>
<rect x="50" y="48" width="120" height="94" rx="30" fill="url(#rh)" stroke="#7c5cff" stroke-width="3"/>
<rect x="64" y="62" width="92" height="64" rx="20" fill="#14121f"/>
<g class="blink"><circle cx="90" cy="92" r="9" fill="#6ee7ff"/><circle cx="130" cy="92" r="9" fill="#6ee7ff"/><circle cx="93" cy="89" r="3" fill="#fff"/><circle cx="133" cy="89" r="3" fill="#fff"/></g>
<path d="M92 109 Q110 122 128 109" stroke="#ff6bb5" stroke-width="4" fill="none" stroke-linecap="round"/>
<rect x="98" y="142" width="24" height="10" fill="#b9a7ff"/>
<rect x="62" y="152" width="96" height="72" rx="26" fill="url(#rb)"/>
<circle cx="110" cy="188" r="15" fill="#fff" opacity=".92"/><path d="M110 178 L113.5 185.5 L121.5 186.3 L115.5 191.7 L117.3 199.5 L110 195.5 L102.7 199.5 L104.5 191.7 L98.5 186.3 L106.5 185.5 Z" fill="#ff4fa3"/>
<g class="wave"><rect x="30" y="160" width="38" height="15" rx="7.5" fill="#b9a7ff" transform="rotate(-40 66 168)"/><circle cx="36" cy="140" r="10" fill="#d4c6ff"/></g>
<rect x="152" y="168" width="38" height="15" rx="7.5" fill="#b9a7ff" transform="rotate(25 154 175)"/><circle cx="188" cy="190" r="10" fill="#d4c6ff"/>
<rect x="76" y="222" width="22" height="14" rx="7" fill="#b9a7ff"/><rect x="122" y="222" width="22" height="14" rx="7" fill="#b9a7ff"/></svg>`,girl:`<svg viewBox="0 0 96 96" class="girlogo" role="img" aria-label="Student writing"><defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient></defs>
<circle cx="48" cy="48" r="46" fill="url(#gl)"/><circle cx="48" cy="48" r="46" fill="none" stroke="#ffffff55" stroke-width="2"/>
<circle cx="60" cy="22" r="7" fill="#2a1b3d"/><path d="M30 78 C30 62 38 56 48 56 C58 56 66 62 66 78 Z" fill="#fff" opacity=".95"/>
<ellipse cx="48" cy="40" rx="15" ry="17" fill="#f6c3a0"/><path d="M33 41 C31 24 41 20 48 20 C57 20 65 26 63 41 C62 32 57 27 48 27 C40 27 35 32 33 41 Z" fill="#2a1b3d"/>
<g fill="none" stroke="#14121f" stroke-width="1.8"><circle cx="42" cy="42" r="5"/><circle cx="54" cy="42" r="5"/><line x1="47" y1="42" x2="49" y2="42"/></g>
<path d="M44 50 Q48 53 52 50" stroke="#b5503a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
<polygon points="26,86 70,86 76,92 20,92" fill="#fff"/><polygon points="29,80 67,80 70,86 26,86" fill="#e3dbff"/><g stroke="#b9a7ff" stroke-width="1.4" stroke-linecap="round"><line x1="31" y1="83" x2="62" y2="83"/></g>
<line x1="56" y1="76" x2="46" y2="88" stroke="#ffc83d" stroke-width="3" stroke-linecap="round"/></svg>`,laptop:`<svg viewBox="0 0 96 80" class="lapt" role="img" aria-label="Laptop"><defs><linearGradient id="lpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient><linearGradient id="lpb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d3f5"/><stop offset="1" stop-color="#9d93cf"/></linearGradient></defs>
<rect x="14" y="6" width="68" height="46" rx="6" fill="#1b1638" stroke="#d9d3f5" stroke-width="3"/><rect x="19" y="11" width="58" height="36" rx="3" fill="url(#lpg)"/>
<path d="M48 17 L52.5 27 L63 28.2 L55.2 35.2 L57.4 45.5 L48 40.2 L38.6 45.5 L40.8 35.2 L33 28.2 L43.5 27 Z" fill="#fff"/>
<path d="M4 58 H92 L86 70 Q85 73 82 73 H14 Q11 73 10 70 Z" fill="url(#lpb)"/><rect x="38" y="58" width="20" height="4" rx="2" fill="#7b72b0"/></svg>`,earth:`<svg viewBox="0 0 96 96" class="earth" role="img" aria-label="Earth"><defs><radialGradient id="eg" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#7fd3ff"/><stop offset=".6" stop-color="#2a7fe0"/><stop offset="1" stop-color="#1a3d9c"/></radialGradient><clipPath id="ec"><circle cx="48" cy="48" r="40"/></clipPath></defs>
<circle cx="48" cy="48" r="44" fill="#7c5cff" opacity=".25"/><circle cx="48" cy="48" r="40" fill="url(#eg)"/>
<g clip-path="url(#ec)" fill="#3fbf6a"><path d="M20 30 C28 20 42 22 46 30 C48 38 40 42 36 48 C30 54 22 48 18 42 C14 38 16 34 20 30 Z"/><path d="M54 52 C62 46 76 50 78 60 C80 70 68 80 60 76 C54 72 50 58 54 52 Z"/><path d="M58 22 C64 18 74 22 72 28 C68 32 60 30 58 22 Z"/></g>
<ellipse cx="38" cy="30" rx="14" ry="8" fill="#fff" opacity=".18" transform="rotate(-30 38 30)"/><circle cx="48" cy="48" r="40" fill="none" stroke="#ffffff55" stroke-width="2"/></svg>`,flag:`<svg viewBox="0 0 64 84" class="npflag" role="img" aria-label="Flag of Nepal"><path d="M6 6 L54 40 L28 40 L54 78 L6 78 Z" fill="#dc143c" stroke="#003893" stroke-width="5" stroke-linejoin="round"/>
<g fill="#fff"><path d="M13 36 A8 8 0 1 0 13 20 A6 6 0 1 1 13 36 Z"/><circle cx="16" cy="25" r="1.4" fill="#dc143c"/></g>
<g transform="translate(16 62)" fill="#fff"><circle r="5"/><g stroke="#fff" stroke-width="1.6" stroke-linecap="round"><line x1="0" y1="-9" x2="0" y2="-6.5"/><line x1="0" y1="9" x2="0" y2="6.5"/><line x1="-9" y1="0" x2="-6.5" y2="0"/><line x1="9" y1="0" x2="6.5" y2="0"/><line x1="-6.4" y1="-6.4" x2="-4.6" y2="-4.6"/><line x1="6.4" y1="6.4" x2="4.6" y2="4.6"/><line x1="-6.4" y1="6.4" x2="-4.6" y2="4.6"/><line x1="6.4" y1="-6.4" x2="4.6" y2="-4.6"/></g></g></svg>`};
if(!EMBED)document.body.insertAdjacentHTML('afterbegin',`<header><a class="logo" href="/"><img src="/logo.svg" alt="StuSPACE"></a>
<div class="hicons" aria-hidden="true">${ART.robot}${ART.girl}${ART.laptop}${ART.earth}${ART.flag}</div>
<nav>${link('/','Home')}${link('/insights.html','Insights')}${link('/register.html','Register')}</nav></header>`);
if(!EMBED)document.body.insertAdjacentHTML('beforeend',`<footer><div class="fgrid">
<div><div class="fbrand"><img src="/logo.svg" alt="StuSPACE"></div><p class="who"></p></div>
<div><h4>Program</h4><a href="/principals.html">Directory</a><a href="/insights.html">Insights</a><a href="/register.html">Register</a></div>
<div><h4>Schools</h4><a href="/login.html?next=/interview.html">Give Insights</a><a href="/principals.html">Directory</a></div>
<div><h4>Contact</h4><span class="cinfo"></span></div></div>
<div class="fbottom"><span class="copy">© ${new Date().getFullYear()} StuSPACE · Giving Big Opportunity to Shine</span><span class="flinks"><a href="/principals.html" data-p="directory" title="Directory" aria-label="Directory">${ICON.dir}</a><a href="#" data-who title="Who we are" aria-label="Who we are">${ICON.info}</a><a href="#" data-privacy title="Privacy: everything is confidential and fair" aria-label="Privacy">${ICON.shield}</a><a href="/admin-login.html" data-p="admin" title="Admin" aria-label="Admin">${ICON.lock}</a><a href="#" class="flogout" title="Logout" aria-label="Logout" hidden>${ICON.logout}</a></span></div></footer>
<dialog id="privDlg" class="ovl small legal"><button class="alt ovx" data-close aria-label="Close">✕</button><h2>Privacy</h2><div id="privBody"></div></dialog>
<dialog id="whoDlg" class="ovl small"><button class="alt ovx" data-close aria-label="Close">✕</button><h2>Who we are</h2><p class="who"></p><div class="cinfo"></div></dialog>`);

// site config (texts + contact come from the DB config)
window.SITE=null;
window.refreshSite=()=>api('/api/site').then(s=>{SITE=s;document.querySelectorAll('.who').forEach(e=>e.textContent=s.whoWeAre);
 document.querySelectorAll('.cinfo').forEach(e=>e.innerHTML=[s.contact.email&&`<a href="mailto:${esc(s.contact.email)}">${esc(s.contact.email)}</a>`,s.contact.phone&&`<span>${esc(s.contact.phone)}</span>`,s.contact.address&&`<span>${esc(s.contact.address)}</span>`].filter(Boolean).join(''));return s}).catch(()=>null);
window.refreshStats=()=>api('/api/stats').then(s=>{const v={registrations:s.registrations,insights:s.insights,funding:'NRS '+s.funding,fundActive:s.fundActive+' / '+s.fundTotal};
 document.querySelectorAll('[data-stat]').forEach(e=>e.textContent=v[e.dataset.stat]);return s}).catch(()=>null);
document.addEventListener('click',e=>{const w=e.target.closest('[data-who]');if(w){e.preventDefault();const d=document.getElementById('whoDlg');d&&d.showModal();return}
 const pv=e.target.closest('[data-privacy]');if(pv){e.preventDefault();const t=(SITE&&SITE.privacy)||'';const L=String(t).split('\n').filter(Boolean);document.getElementById('privBody').innerHTML=L.map((l,i)=>l.startsWith('# ')?'<h3>'+esc(l.slice(2))+'</h3>':'<p'+(i===0?' class="privnote"':'')+'>'+(i===0?'🔒 ':'')+esc(l)+'</p>').join('');document.getElementById('privDlg').showModal();return}
 const c=e.target.closest('dialog [data-close]');if(c)c.closest('dialog').close()});
if(!EMBED){refreshSite();refreshStats()}

// shared insight card (no upvotes, no titles)
window.insightCard=(i,rank)=>`<a class="icard" data-ins="${i.id}" href="/insight.html?id=${i.id}">${rank?`<span class="rank">${rank}</span>`:''}<span class="play">▶ Watch</span>
<video preload="metadata" muted src="${esc(i.video)}#t=0.5"></video><div class="body"><h3>${esc(i.principal.school.name)}</h3><div class="small">${esc(i.principal.name)}</div>
<div class="small">${fmt(i.at)}</div></div></a>`;
// toast + flash (message that survives a redirect)
window.toast=(t,ok=true)=>{const d=document.createElement('div');d.className='toast '+(ok?'ok':'err');d.textContent=(ok?'✔ ':'✖ ')+t;document.body.appendChild(d);
 const lg=document.querySelector('header .logo'),r=lg&&lg.getBoundingClientRect(),vis=r&&r.bottom>0;
 const left=vis?r.right+12:12;d.style.left=left+'px';const n=document.querySelectorAll('.toast').length-1;d.style.top=((vis?r.top+r.height/2-d.offsetHeight/2:8)+n*(d.offsetHeight+4))+'px';d.style.maxWidth='calc(100vw - '+(left+12)+'px)';
 setTimeout(()=>d.remove(),6000)};
window.flash=(t,ok=true)=>sessionStorage.setItem('flash',JSON.stringify({t,ok}));
try{const f=JSON.parse(sessionStorage.getItem('flash')||'null');if(f){sessionStorage.removeItem('flash');toast(f.t,f.ok)}}catch(e){}

// leave an embedded page: close the overlay / flip to Home in the home page, or go to / when standalone
window.goHome=(msg,ok=true,reset)=>{if(EMBED){if(reset&&parent.resetFace)parent.resetFace(reset);parent.toast(msg,ok);parent.refreshStats&&parent.refreshStats();parent.closeOverlay?parent.closeOverlay():parent.openPanel('home')}else{flash(msg,ok);location.href='/'}};
// embedded mode: toasts go to the parent page
if(EMBED){window.toast=(t,ok)=>parent.toast(t,ok)}

// Logout lives in the footer (icon only) and shows only while an admin is logged in
window.refreshAdmin=()=>api('/api/admin/me').then(a=>{window.IS_ADMIN=!!a.admin;document.querySelectorAll('.flogout').forEach(x=>x.hidden=!a.admin);return a}).catch(()=>{});
document.addEventListener('click',async e=>{const l=e.target.closest('.flogout');if(!l)return;e.preventDefault();await post('/api/admin/logout');
 flash('Logged out');location.href='/'});
if(!EMBED)refreshAdmin();

// Recorded WebM files report an infinite duration, which breaks seeking and the progress bar. Fix it for every player.
window.fixDuration=v=>{if(v.dataset.fd)return;v.dataset.fd=1;v.addEventListener('loadedmetadata',()=>{if(v.duration===Infinity){const t=v.currentTime;v.currentTime=1e101;v.addEventListener('timeupdate',function f(){v.removeEventListener('timeupdate',f);v.currentTime=t||0},{once:true})}});
 v.addEventListener('error',()=>{});};
new MutationObserver(()=>document.querySelectorAll('video').forEach(fixDuration)).observe(document.documentElement,{childList:true,subtree:true});
document.querySelectorAll('video').forEach(fixDuration);

// Camera + microphone for recording. Tries the default devices, then each camera the browser lists explicitly,
// then video-only; every failure is explained in plain words (with what the browser can see).
// Camera and microphone are on only while a recording runs. If they drop mid-recording, onLost(message) is called.
window.watchStream=(stream,onLost)=>stream.getTracks().forEach(t=>t.addEventListener('ended',()=>onLost('The camera or microphone stopped working. Please restart your browser and record again.')));
window.getMediaStream=async()=>{
 const md=navigator.mediaDevices;
 if(!window.isSecureContext||!md||!md.getUserMedia)throw new Error('This page cannot use the camera: the browser only allows it on https or on localhost. Open the site as http://localhost:3000 (not by IP address) or serve it over https.');
 let devs=[];try{devs=await md.enumerateDevices()}catch(e){}
 const cams=()=>devs.filter(d=>d.kind==='videoinput'),mics=()=>devs.filter(d=>d.kind==='audioinput');
 const friendly=e=>{const n=e&&e.name;
  if(n==='NotAllowedError'||n==='SecurityError')return new Error('Camera access is blocked. Allow camera and microphone for this site (lock icon in the address bar). On a Mac also check System Settings > Privacy & Security > Camera and Microphone, switch your browser on, then quit and reopen the browser.');
  if(n==='NotReadableError'||n==='AbortError')return new Error('The camera is busy or not responding. Close other apps using it (for example QuickTime or video calls), then restart your browser and press Record again.');
  if(n==='NotFoundError'||n==='OverconstrainedError')return new Error('Your browser cannot find a camera ('+cams().length+' camera, '+mics().length+' microphone seen by the browser). If QuickTime works, check System Settings > Privacy & Security > Camera and switch this browser on, then quit and reopen the browser. You can also test it at /camtest.html.');
  return new Error((e&&e.message?e.message:'Could not start the camera.')+' Please restart your browser and try again.')};
 const attempt=async(c,note='')=>({stream:await md.getUserMedia(c),note});
 let last;
 try{return await attempt({video:true,audio:true})}catch(e){last=e}
 if(last&&last.name!=='NotFoundError'&&last.name!=='OverconstrainedError')throw friendly(last);
 // default device missing or stale: try audio-less, then each listed camera by id
 try{return await attempt({video:true,audio:false},'No microphone was found, so this video will be recorded without sound.')}catch(e){last=e}
 try{devs=await md.enumerateDevices()}catch(e){}
 for(const cam of cams()){
  if(!cam.deviceId)continue;
  try{return await attempt({video:{deviceId:{exact:cam.deviceId}},audio:mics().length?true:false},mics().length?'':'No microphone was found, so this video will be recorded without sound.')}catch(e){last=e}
  try{return await attempt({video:{deviceId:{exact:cam.deviceId}},audio:false},'Recording without sound.')}catch(e){last=e}
 }
 throw friendly(last)};
