const THEME_KEY = 'miniMeetingTheme.v2';
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 18 * 60;
const BUFFER_MINUTES = 15;
const SLOT_INTERVAL = 15;
const ALLOWED_DURATIONS = [30, 60, 90];

const $ = (id) => document.getElementById(id);
const els = {
  form: $('bookingForm'), name: $('name'), start: $('startTime'), duration: $('duration'), list: $('bookingList'), empty: $('emptyState'),
  count: $('bookingCount'), timeline: $('timeline'), timelineHours: $('timelineHours'), availability: $('availabilityBox'), message: $('formMessage'),
  nameError: $('nameError'), timeError: $('timeError'), durationError: $('durationError'), cancelDialog: $('cancelDialog'), cancelText: $('cancelDialogText'),
  confirmCancel: $('confirmCancel'), clearDialog: $('clearDialog'), confirmClear: $('confirmClear'), clearAll: $('clearAllBtn'), search: $('searchInput'),
  quickSlots: $('quickSlots'), toast: $('toast'), toastText: $('toastText'), theme: $('themeToggle'), statBookings: $('statBookings'), statMinutes: $('statMinutes'),
  statNext: $('statNext'), statFree: $('statFree'), installBtn: $('installBtn'), installBtnLarge: $('installBtnLarge'), mobileInstall: $('mobileInstall'), heroBook: $('heroBookBtn')
};

function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
let selectedDate = localDate();
let pendingCancelId = null;
let toastTimer;
let deferredInstallPrompt = null;

const TOKEN_KEY = 'meetflowCancellationTokens.v1';
let bookingCache = [];
let databaseReady = false;
function dbConfig() {
  const cfg=window.MEETFLOW_SUPABASE||{};
  const ready=(cfg.url||'').startsWith('https://') && cfg.key && !cfg.key.startsWith('PASTE_');
  return {...cfg,ready};
}
function tokenMap(){try{return JSON.parse(localStorage.getItem(TOKEN_KEY)||'{}')}catch{return {}}}
function saveToken(id,token){const tokens=tokenMap();tokens[id]=token;localStorage.setItem(TOKEN_KEY,JSON.stringify(tokens));}
function removeToken(id){const tokens=tokenMap();delete tokens[id];localStorage.setItem(TOKEN_KEY,JSON.stringify(tokens));}
function loadBookings(){return bookingCache.filter(b=>b.date===selectedDate)}
function isBookingShapeValid(b) { return b && typeof b.id === 'string' && typeof b.name === 'string' && b.name.trim().length >= 2 && Number.isInteger(b.start) && b.start >= OPEN_MINUTES && b.start % SLOT_INTERVAL === 0 && b.end === b.start + b.duration && b.end <= CLOSE_MINUTES && ALLOWED_DURATIONS.includes(b.duration); }
function mapRow(row){return {id:row.id,date:row.booking_date,name:row.name,start:row.start_minute,end:row.end_minute,duration:row.duration,createdAt:row.created_at}}
async function api(path,{method='GET',body}={}){
  const cfg=dbConfig(); if(!cfg.ready) throw new Error('Database is not configured yet. Add your Supabase URL and publishable key to supabase-config.js.');
  const response=await fetch(cfg.url+'/rest/v1/'+path,{method,headers:{apikey:cfg.key,'Content-Type':'application/json',Accept:'application/json'},body:body?JSON.stringify(body):undefined});
  let data=null;try{data=await response.json()}catch{}
  if(!response.ok) throw new Error(data?.message||data?.hint||`Database request failed (${response.status}).`);
  return data;
}
async function refreshBookings({quiet=false}={}){
  try{
    const rows=await api(`bookings?select=id,booking_date,name,start_minute,duration,end_minute,created_at&booking_date=eq.${selectedDate}&order=start_minute.asc`);
    bookingCache=bookingCache.filter(b=>b.date!==selectedDate).concat(rows.map(mapRow));databaseReady=true;updateConnection();renderBookings();updateAvailabilityPreview();
  }catch(error){databaseReady=false;updateConnection();if(!quiet)setFormMessage(error.message,'error');}
}
function toMinutes(time) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN; const [h,m] = time.split(':').map(Number); return h * 60 + m; }
function toTimeString(minutes) { const h24=Math.floor(minutes/60), m=minutes%60, suffix=h24>=12?'PM':'AM', h=h24%12||12; return `${h}:${String(m).padStart(2,'0')} ${suffix}`; }
function toInputTime(minutes) { return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`; }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }

function validateBooking({ name, startTime, duration }) {
  const start = toMinutes(startTime); const end = start + duration; const errors = {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) errors.name = 'Enter at least 2 characters.';
  if (Number.isNaN(start)) errors.time = 'Choose a valid start time.';
  else if (start < OPEN_MINUTES || start >= CLOSE_MINUTES) errors.time = 'Choose a time between 9:00 AM and 6:00 PM.';
  else if (start % SLOT_INTERVAL !== 0) errors.time = 'Use a 15-minute interval.';
  if (!ALLOWED_DURATIONS.includes(duration)) errors.duration = 'Choose 30, 60, or 90 minutes.';
  if (!Number.isNaN(start) && ALLOWED_DURATIONS.includes(duration) && end > CLOSE_MINUTES) errors.time = `Meeting would end at ${toTimeString(end)}, after closing.`;
  if (!Number.isNaN(start) && isPastStart(start)) errors.time='Choose a future start time or another date.';
  return { valid:Object.keys(errors).length===0, errors, start, end };
}

function findConflict(start, end, bookings) {
  return bookings.find(b => start < b.end + BUFFER_MINUTES && end + BUFFER_MINUTES > b.start);
}
function checkAvailability(start, end, bookings) {
  const conflict = findConflict(start,end,bookings);
  if (!conflict) return { available:true, title:'Perfect — this slot is open', message:`${toTimeString(start)} – ${toTimeString(end)} is available with the 15-minute buffer protected.` };
  const next = Math.min(conflict.end + BUFFER_MINUTES, CLOSE_MINUTES);
  return { available:false, title:'This time is already protected', message:`It conflicts with ${toTimeString(conflict.start)} – ${toTimeString(conflict.end)} and its buffer. Choose another available start.` };
}

function isPastStart(minutes) {
  const now=new Date(); const today=localDate(now);
  return selectedDate < today || (selectedDate === today && minutes <= now.getHours()*60+now.getMinutes());
}
function getCandidateTimes(duration) {
  if (!ALLOWED_DURATIONS.includes(duration)) return [];
  const latestStart = CLOSE_MINUTES - duration;
  const times = [];
  for (let m = OPEN_MINUTES; m <= latestStart; m += SLOT_INTERVAL) if (!isPastStart(m)) times.push(m);
  return times;
}

function populateStartTimes({ preserve = true } = {}) {
  const duration = Number(els.duration.value);
  const previous = preserve ? els.start.value : '';
  const bookings = loadBookings();
  els.start.replaceChildren();
  const placeholder = new Option('Choose time', '');
  els.start.add(placeholder);

  for (const minute of getCandidateTimes(duration)) {
    const end = minute + duration;
    const option = new Option(toTimeString(minute), toInputTime(minute));
    const conflict = findConflict(minute, end, bookings);
    if (conflict) continue;
    els.start.add(option);
  }
  if (previous && [...els.start.options].some(o => o.value === previous && !o.disabled)) els.start.value = previous;
}

function setErrors(errors={}) { els.nameError.textContent=errors.name||''; els.timeError.textContent=errors.time||''; els.durationError.textContent=errors.duration||''; }
function setFormMessage(text='',type='') { els.message.textContent=text; els.message.className=`form-message ${type}`.trim(); }
function setAvailability(state,title,message) { els.availability.className=`availability-card ${state||''}`.trim(); els.availability.querySelector('.availability-icon').textContent=state==='available'?'✓':state==='unavailable'?'!':'i'; els.availability.querySelector('strong').textContent=title; els.availability.querySelector('p').textContent=message; }
function showToast(text) { clearTimeout(toastTimer); els.toastText.textContent=text; els.toast.classList.add('show'); toastTimer=setTimeout(()=>els.toast.classList.remove('show'),2800); }

function updateAvailabilityPreview() {
  setFormMessage(); const startTime=els.start.value, duration=Number(els.duration.value);
  if (!startTime) { setAvailability('', 'Choose a time', 'Select a start time and duration to check availability.'); return; }
  const v=validateBooking({name:els.name.value.trim()||'Preview',startTime,duration});
  if (v.errors.time||v.errors.duration) { setAvailability('unavailable','Invalid time',v.errors.time||v.errors.duration); return; }
  const a=checkAvailability(v.start,v.end,loadBookings()); setAvailability(a.available?'available':'unavailable',a.title,a.message);
}

function renderQuickSlots(bookings) {
  els.quickSlots.replaceChildren();
  const duration = Number(els.duration.value);
  const candidates = getCandidateTimes(duration);
  const preferred = candidates.filter(m => !findConflict(m, m + duration, bookings));
  for (const minute of preferred) {
    const btn=document.createElement('button'); btn.type='button'; btn.className='quick-slot'; btn.textContent=toTimeString(minute);
    const end=minute+duration; const invalid=!!findConflict(minute,end,bookings);
    btn.disabled=invalid; if (els.start.value===toInputTime(minute)) btn.classList.add('active');
    btn.addEventListener('click',()=>{ els.start.value=toInputTime(minute); updateAvailabilityPreview(); renderQuickSlots(loadBookings()); });
    btn.setAttribute('aria-pressed', String(els.start.value===toInputTime(minute))); els.quickSlots.appendChild(btn);
  }
  if (!preferred.length) els.quickSlots.textContent = 'No slots fit this duration. Try a shorter meeting or another day.';
}

function createBookingItem(booking, index) {
  const item=document.createElement('article'); item.className='booking-item'; item.dataset.name=booking.name.toLowerCase(); item.style.setProperty('--delay', `${Math.min(index,8)*45}ms`);
  const [time,period]=toTimeString(booking.start).split(' ');
  item.innerHTML=`<div class="time-block"><strong>${time}</strong><span>${period}</span></div><div class="booking-main"><div class="booking-title-row"><h3>${escapeHtml(booking.name)}</h3><span class="live-tag"><i></i>Confirmed</span></div><div class="booking-sub"><span class="booking-chip">${toTimeString(booking.start)} – ${toTimeString(booking.end)}</span><span class="booking-chip">${booking.duration} min</span><span class="booking-chip buffer-chip">Buffer until ${toTimeString(Math.min(booking.end+BUFFER_MINUTES,CLOSE_MINUTES))}</span></div></div>`;
  const cancel=document.createElement('button'); cancel.type='button'; cancel.className='cancel-btn'; cancel.title='Cancel booking'; cancel.setAttribute('aria-label',`Cancel ${booking.name}'s booking`); cancel.innerHTML='<span>×</span>'; cancel.addEventListener('click',()=>requestCancel(booking)); const actions=document.createElement('div'); actions.className='booking-actions'; const calendar=document.createElement('button'); calendar.type='button'; calendar.className='calendar-btn'; calendar.textContent='↓'; calendar.title='Add to calendar'; calendar.setAttribute('aria-label', `Download calendar event for ${booking.name}`); calendar.addEventListener('click',()=>exportCalendar(booking)); actions.append(calendar,cancel); item.appendChild(actions); return item;
}

function renderBookings() {
  const bookings=loadBookings().sort((a,b)=>a.start-b.start); const query=els.search.value.trim().toLowerCase(); els.list.replaceChildren();
  $('emptyTitle').textContent=query?'No matching meetings':'Your day is wide open'; $('emptyDescription').textContent=query?'Try another name or clear your search.':'Choose an available time to reserve your first meeting.';
  const filtered=bookings.filter(b=>b.name.toLowerCase().includes(query)); filtered.forEach((b,i)=>els.list.appendChild(createBookingItem(b,i)));
  els.empty.hidden=filtered.length>0; els.list.hidden=filtered.length===0; els.count.textContent=`${bookings.length} ${bookings.length===1?'booking':'bookings'}`;
  populateStartTimes(); renderTimeline(bookings); renderQuickSlots(bookings); renderStats(bookings);
}

function renderStats(bookings) {
  const bookedMinutes=bookings.reduce((sum,b)=>sum+b.duration,0); const blockedSlots=new Set();
  bookings.forEach(b=>{ for(let m=b.start;m<Math.min(b.end+BUFFER_MINUTES,CLOSE_MINUTES);m+=SLOT_INTERVAL) blockedSlots.add(m); });
  const totalSlots=(CLOSE_MINUTES-OPEN_MINUTES)/SLOT_INTERVAL; const freePercent=Math.max(0,Math.round((1-blockedSlots.size/totalSlots)*100));
  const nextMinute=getCandidateTimes(Number(els.duration.value)).find(m=>!findConflict(m,m+Number(els.duration.value),bookings)); const next=nextMinute===undefined?'No slots':toTimeString(nextMinute);
  animateStat(els.statBookings, String(bookings.length));
  animateStat(els.statMinutes, bookedMinutes>=60?`${Math.floor(bookedMinutes/60)}h ${bookedMinutes%60?bookedMinutes%60+'m':''}`.trim():`${bookedMinutes} min`);
  animateStat(els.statNext, next);
  animateStat(els.statFree, `${freePercent}%`);
}
function animateStat(el, value) { if (el.textContent === value) return; el.classList.remove('stat-pop'); void el.offsetWidth; el.textContent=value; el.classList.add('stat-pop'); }

function renderTimeline(bookings) {
  els.timeline.replaceChildren(); els.timelineHours.replaceChildren();
  for(let minute=OPEN_MINUTES;minute<CLOSE_MINUTES;minute+=SLOT_INTERVAL){
    const hour=document.createElement('div'); hour.className='hour-label'; hour.textContent=minute%60===0?toTimeString(minute):''; els.timelineHours.appendChild(hour);
    let state='free';
    for(const b of bookings){ if(minute>=b.start && minute<b.end){state='booked';break;} if(minute>=b.end && minute<Math.min(b.end+BUFFER_MINUTES,CLOSE_MINUTES)){state='buffer';break;} }
    const slot=document.createElement('button'); slot.type='button'; slot.className=`timeline-slot ${state==='free'?'':state}`.trim(); slot.title=`${toTimeString(minute)} – ${toTimeString(minute+SLOT_INTERVAL)} · ${state==='free'?'Available':state==='booked'?'Booked':'15-minute buffer'}`;
    slot.disabled = isPastStart(minute) || state !== 'free' || minute + Number(els.duration.value) > CLOSE_MINUTES || !!findConflict(minute,minute+Number(els.duration.value),bookings);
    slot.setAttribute('aria-label', slot.title);
    if(state==='free') slot.addEventListener('click',()=>{ const duration=Number(els.duration.value); if(minute+duration<=CLOSE_MINUTES && !findConflict(minute,minute+duration,bookings)){els.start.value=toInputTime(minute); updateAvailabilityPreview(); renderQuickSlots(bookings); document.getElementById('bookingWorkspace').scrollIntoView({behavior:'smooth',block:'start'});} });
    els.timeline.appendChild(slot);
  }
}

function requestCancel(booking) { pendingCancelId=booking.id; els.cancelText.textContent=`${booking.name} · ${toTimeString(booking.start)} – ${toTimeString(booking.end)}. The slot will become available again.`; if(els.cancelDialog.showModal) els.cancelDialog.showModal(); }
async function cancelBooking(id) {
  const token=tokenMap()[id]; if(!token){showToast('Only the browser that created this booking can cancel it.');return;}
  try{const removed=await api('rpc/cancel_booking',{method:'POST',body:{p_id:id,p_cancel_token:token}});if(!removed)throw new Error('Cancellation was not authorized.');removeToken(id);pendingCancelId=null;await refreshBookings({quiet:true});showToast('Booking cancelled — slot released.');}catch(error){setFormMessage(error.message,'error');}
}
els.confirmCancel.addEventListener('click',async e=>{ if(!pendingCancelId)return; e.preventDefault(); els.cancelDialog.close(); await cancelBooking(pendingCancelId); });
els.clearAll.addEventListener('click',()=>{ const owned=loadBookings().filter(b=>tokenMap()[b.id]);if(!owned.length){showToast('You have no cancellable bookings on this day.');return;}els.clearDialog.showModal(); });
els.confirmClear.addEventListener('click',async e=>{e.preventDefault();els.clearDialog.close();const ids=loadBookings().filter(b=>tokenMap()[b.id]).map(b=>b.id);for(const id of ids)await cancelBooking(id);showToast('Your bookings for this day were cleared.');});

els.form.addEventListener('submit',async event=>{
  event.preventDefault(); setErrors(); setFormMessage();
  const input={name:els.name.value.trim(),startTime:els.start.value,duration:Number(els.duration.value)}; const v=validateBooking(input);
  if(!v.valid){setErrors(v.errors);setFormMessage('Please fix the booking details above.','error');return;}
  const a=checkAvailability(v.start,v.end,loadBookings());
  if(!a.available){setAvailability('unavailable',a.title,a.message);setFormMessage(a.message,'error');return;}
  const submit=els.form.querySelector('button[type="submit"]');submit.disabled=true;
  try{
    const bytes=crypto.getRandomValues(new Uint8Array(32));const token=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
    const rows=await api('rpc/create_booking',{method:'POST',body:{p_booking_date:selectedDate,p_name:input.name,p_start_minute:v.start,p_duration:input.duration,p_cancel_token:token}});
    const booking=mapRow(rows[0]);saveToken(booking.id,token);els.form.reset();els.duration.value='30';await refreshBookings({quiet:true});setErrors();updateAvailabilityPreview();showToast(`Booked ${toTimeString(booking.start)} – ${toTimeString(booking.end)}.`);setFormMessage('Booking confirmed and shared with every device.','success');
  }catch(error){await refreshBookings({quiet:true});setFormMessage(error.message.includes('conflict')?'Someone just reserved that time. Choose another available start.':error.message,'error');}
  finally{submit.disabled=false;}
});

els.duration.addEventListener('change',()=>{ populateStartTimes({preserve:false}); updateAvailabilityPreview(); renderQuickSlots(loadBookings()); renderStats(loadBookings()); renderTimeline(loadBookings()); });
els.start.addEventListener('change',()=>{ updateAvailabilityPreview(); renderQuickSlots(loadBookings()); });
els.name.addEventListener('input',()=>{if(els.nameError.textContent)els.nameError.textContent='';});
els.search.addEventListener('input',renderBookings);
els.heroBook.addEventListener('click',()=>document.getElementById('bookingWorkspace').scrollIntoView({behavior:'smooth',block:'start'}));

function initTheme(){let saved;try{saved=localStorage.getItem(THEME_KEY);}catch{}const dark=saved?saved==='dark':window.matchMedia?.('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=dark?'dark':'light';els.theme.querySelector('span').textContent=dark?'☀':'☾';}
els.theme.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem(THEME_KEY,next);els.theme.querySelector('span').textContent=next==='dark'?'☀':'☾';});

function initReveal() {
  const nodes=[...document.querySelectorAll('.reveal')];
  if (!('IntersectionObserver' in window)) { nodes.forEach(n=>n.classList.add('visible')); return; }
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}}),{threshold:.12});
  nodes.forEach(n=>observer.observe(n));
}

function showInstallButtons(show) { [els.installBtn,els.installBtnLarge].forEach(btn=>{ if(btn) btn.hidden=false; }); if(els.mobileInstall) els.mobileInstall.classList.toggle('install-ready',show); }
async function triggerInstall() { if(!deferredInstallPrompt){if(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone){showToast('You are already using the installed app.');return;} $('installDialog').showModal();return;} deferredInstallPrompt.prompt(); const choice=await deferredInstallPrompt.userChoice; if(choice.outcome==='accepted') showToast('MeetFlow installed successfully.'); deferredInstallPrompt=null; showInstallButtons(false); }
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;showInstallButtons(true);});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;showInstallButtons(false);showToast('MeetFlow is now installed.');});
[els.installBtn,els.installBtnLarge,els.mobileInstall].forEach(btn=>btn?.addEventListener('click',triggerInstall));

if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

function changeDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $('bookingDate').value=selectedDate; return; }
  selectedDate=date; $('bookingDate').value=date;
  $('dateHeading').textContent=new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  els.search.value=''; setErrors(); bookingCache=bookingCache.filter(b=>b.date!==date); populateStartTimes({preserve:false}); renderBookings(); updateAvailabilityPreview(); refreshBookings();
}
function exportCalendar(booking) {
  const stamp=m=>`${selectedDate.replaceAll('-','')}T${toInputTime(m).replace(':','')}00`;
  const escape=s=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/[,;]/g,'\\$&');
  const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MeetFlow//Schedule//EN','BEGIN:VEVENT',`UID:${booking.id}@meetflow.local`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART:${stamp(booking.start)}`,`DTEND:${stamp(booking.end)}`,`SUMMARY:${escape('Meeting with '+booking.name)}`,'DESCRIPTION:Scheduled with MeetFlow. Times are in your local timezone.','END:VEVENT','END:VCALENDAR'].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'})); const link=document.createElement('a'); link.href=url; link.download='meetflow-meeting.ics'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('bookingDate').addEventListener('change',e=>changeDay(e.target.value));
for (const [id,step] of [['previousDay',-1],['nextDay',1]]) $(id).addEventListener('click',()=>{const date=new Date(selectedDate+'T12:00:00');date.setDate(date.getDate()+step);changeDay(localDate(date));});
$('todayBtn').addEventListener('click',()=>changeDay(localDate()));
setInterval(()=>{refreshBookings({quiet:true});},30000);
window.addEventListener('focus',()=>refreshBookings({quiet:true}));
function updateConnection(){ $('connectionStatus').textContent=!navigator.onLine?'Offline':databaseReady?'Live · synced':'Database unavailable'; }
window.addEventListener('online',()=>refreshBookings({quiet:true})); window.addEventListener('offline',updateConnection);
document.querySelectorAll('.mobile-nav a').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.mobile-nav-item').forEach(n=>n.classList.remove('active'));link.classList.add('active');}));
window.addEventListener('error',()=>{setFormMessage('Something went wrong. If saving failed, check browser storage before retrying.','error');});
initTheme(); initReveal(); updateConnection(); changeDay(selectedDate);

if(typeof module!=='undefined') module.exports={toMinutes,toTimeString,toInputTime,validateBooking,findConflict,checkAvailability,getCandidateTimes,OPEN_MINUTES,CLOSE_MINUTES,BUFFER_MINUTES,SLOT_INTERVAL};
