'use strict';
const EXERCISES = {
  'Грудь': ['Жим штанги лёжа', 'Жим гантелей лёжа', 'Жим на наклонной скамье', 'Разведение гантелей', 'Отжимания'],
  'Спина': ['Подтягивания', 'Тяга верхнего блока', 'Тяга горизонтального блока', 'Тяга штанги в наклоне', 'Тяга гантели в наклоне'],
  'Ноги': ['Приседания со штангой', 'Жим ногами', 'Выпады с гантелями', 'Румынская тяга', 'Разгибание ног', 'Сгибание ног', 'Подъёмы на носки'],
  'Ягодицы': ['Ягодичный мост', 'Болгарские выпады', 'Отведение ноги в блоке'],
  'Плечи': ['Жим гантелей сидя', 'Жим штанги стоя', 'Махи гантелей в стороны', 'Обратные разведения'],
  'Бицепс': ['Подъём штанги на бицепс', 'Сгибание рук с гантелями', 'Молотковые сгибания'],
  'Трицепс': ['Разгибание рук в блоке', 'Французский жим', 'Отжимания на брусьях'],
  'Пресс': ['Скручивания', 'Подъём ног в висе', 'Скручивания в блоке']
};
const STORAGE_KEY = 'podhod.workouts.v1';
const $ = id => document.getElementById(id);
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const fromKey = key => new Date(`${key}T12:00:00`);
const todayKey = dateKey(new Date());
let selected = todayKey;
let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let workouts = {};
let dirty = false;
let storageOK = true;
function validWorkouts(data) {
  return data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length <= 10000 && Object.entries(data).every(([key,w]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(fromKey(key).getTime()) && dateKey(fromKey(key)) === key && w &&
    typeof w.name === 'string' && w.name.length <= 80 && typeof w.notes === 'string' && w.notes.length <= 2000 && typeof w.completed === 'boolean' &&
    Array.isArray(w.exercises) && w.exercises.length > 0 && w.exercises.length <= 100 && w.exercises.every(e => e && EXERCISES[e.muscle]?.includes(e.exercise) &&
      Number.isInteger(e.sets) && e.sets >= 1 && e.sets <= 100 && Number.isInteger(e.reps) && e.reps >= 1 && e.reps <= 1000 &&
      Number.isFinite(e.weight) && e.weight >= 0 && e.weight <= 2000));
}
let revision = 0;
let currentUser = null;
let busy = false;
let authMode = 'login';
const config = window.PODHOD_CONFIG || {};
const cloudMode = config.backend !== 'local';
let cloudApi;
let localWorkouts = {};
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== null) {
    const data = JSON.parse(raw);
    if (!validWorkouts(data)) throw new Error('Invalid history');
    localWorkouts = data;
  }
} catch { storageOK = false; }
function status(text, error=false) { $('status').textContent=text; $('status').style.color=error?'#ff9b7a':'var(--lime)'; }
async function api(path, method='GET', body) {
  if(cloudMode) return cloudApi(path,method,body);
  const response = await fetch(`/api/${path}`, {method, credentials:'same-origin', headers:{'Content-Type':'application/json','X-Podhod':'1'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const data = await response.json().catch(()=>{throw new Error('Не удалось подключиться к серверу. Открой сайт через python3 server.py.');});
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
async function persist(next) {
  if (busy || !currentUser) return false;
  busy=true; document.querySelector('main').inert=true;
  status('Сохраняем на сервере…');
  try {
    const result=await api('workouts','PUT',{workouts:next,revision});
    revision=result.revision;workouts=next;return true;
  } catch(error) { status(error.message+' Изменения не сохранены.',true);return false; }
  finally {busy=false;document.querySelector('main').inert=false;}
}
function refresh() {loadForm();renderCalendar();renderStats();renderHistory();}
async function enterAccount(user) {
  const data=await api('workouts');
  if(!validWorkouts(data.workouts)) throw new Error('Не удалось прочитать историю аккаунта.');
  currentUser=user; workouts=data.workouts;revision=data.revision;dirty=false;
  $('password').value='';$('auth-screen').hidden=true;document.querySelector('main').hidden=false;
  $('logout').hidden=false;$('account-label').textContent=user.login;
  renderAccountAvatar();
  const main=document.querySelector('main');main.classList.remove('dashboard-enter');
  requestAnimationFrame(()=>main.classList.add('dashboard-enter'));
  $('import-banner').hidden=!Object.keys(localWorkouts).length;
  refresh();
  if(!storageOK) status('Старую историю браузера прочитать не удалось. Она не была изменена.',true);
}
for (const mode of ['login','register']) $(`${mode}-tab`).addEventListener('click',()=>{
  authMode=mode;
  $('login-tab').setAttribute('aria-pressed',String(mode==='login'));
  $('register-tab').setAttribute('aria-pressed',String(mode==='register'));
  $('password').autocomplete=mode==='login'?'current-password':'new-password';
  $('auth-submit').textContent=mode==='login'?'Войти':'Создать аккаунт';
  $('auth-hint').textContent=cloudMode ? (mode==='login'?'Войди с почтой и паролем своего аккаунта.':'Используй почту как логин и пароль от 10 символов. Писем не будет — сохрани пароль, восстановление по почте отключено.') : (mode==='login'?'Используй логин, указанный при регистрации.':'Логин: 3–32 латинские буквы, цифры, точка, дефис или _.');
  $('auth-status').textContent='';
});
$('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;$('auth-form').inert=true;
  $('auth-status').textContent='Подключаемся…';
  try {
    const result=await api(authMode,'POST',{login:$('login').value.trim(),password:$('password').value});
    if(result.user) {await enterAccount(result.user);$('auth-status').textContent='';}
    else {$('auth-status').textContent=result.message;$('password').value='';}
  } catch(error) {$('auth-status').textContent=error.message;}
  finally {busy=false;$('auth-form').inert=false;}
});
$('logout').addEventListener('click',async()=>{
  if(busy)return;
  if(dirty&&!confirm('Выйти без сохранения изменений?'))return;
  busy=true;
  try {
    await api('logout','POST',{}); currentUser=null;workouts={};dirty=false;revision=0;refresh();
    document.querySelector('main').hidden=true;$('auth-screen').hidden=false;$('logout').hidden=true;$('avatar-button').hidden=true;$('avatar-dialog').close();
    $('account-label').textContent='Войди в аккаунт';$('auth-status').textContent='Ты вышел из аккаунта.';
  } catch(error) {status(error.message,true);}
  finally {busy=false;}
});
$('import-local').addEventListener('click',async()=>{
  if(dirty&&!confirm('Перенести историю без сохранения текущих изменений?'))return;
  if(await persist({...localWorkouts,...workouts})) {refresh();$('import-banner').hidden=true;status('История из браузера добавлена в аккаунт.');}
});
async function bootstrap() {
  $('auth-form').inert=true;
  try {
    if(cloudMode) {
      $('login-label').textContent='Электронная почта';
      $('login').type='email';$('login').removeAttribute('pattern');$('login').removeAttribute('minlength');$('login').maxLength=254;
      $('login').placeholder='you@example.com';$('login').autocomplete='email';
      $('auth-hint').textContent='Войди с почтой и паролем своего аккаунта.';
      cloudApi=createCloudBackend(config,window.PodhodSupabase,event=>{
        if(event==='SIGNED_OUT' && currentUser && !busy) {
          currentUser=null;workouts={};revision=0;dirty=false;refresh();
          document.querySelector('main').hidden=true;$('auth-screen').hidden=false;$('logout').hidden=true;$('avatar-button').hidden=true;$('avatar-dialog').close();
          $('account-label').textContent='Войди в аккаунт';
          $('auth-status').textContent='Сессия завершилась. Войди снова.';
        }
      });
    }
  } catch(error) {
    $('auth-status').textContent=error.message;$('account-label').textContent='Настройка сайта';
    $('auth-form').inert=false;$('auth-submit').disabled=true;return;
  }
  try {
    const {user}=await api('me');
    if(user) await enterAccount(user);
    else {$('auth-status').textContent='';$('account-label').textContent='Войди в аккаунт';}
  } catch(error) {
    $('auth-status').textContent=location.protocol==='file:'?'Открой сайт через GitHub Pages или локальный веб-сервер.':error.message;
    $('account-label').textContent='Нет соединения';
  } finally {$('auth-form').inert=false;}
}
function option(value) { const node=document.createElement('option'); node.value=value; node.textContent=value; return node; }
function addRow(data) {
  const row=$('exercise-template').content.firstElementChild.cloneNode(true);
  const muscle=row.querySelector('.muscle'); const exercise=row.querySelector('.exercise');
  Object.keys(EXERCISES).forEach(name=>muscle.append(option(name)));
  if(data) muscle.value=data.muscle;
  function updateExercises() { exercise.replaceChildren(...EXERCISES[muscle.value].map(option)); }
  updateExercises();
  muscle.addEventListener('change',updateExercises);
  if(data) { exercise.value=data.exercise; ['sets','reps','weight'].forEach(key=>row.querySelector(`.${key}`).value=data[key]); }
  row.querySelector('.remove-row').addEventListener('click',()=>{row.remove(); renumber(); dirty=true;});
  $('exercise-rows').append(row); renumber();
}
function renumber() { document.querySelectorAll('.exercise-number').forEach((node,i)=>node.textContent=String(i+1).padStart(2,'0')); }
function renderCalendar() {
  $('month-title').textContent=month.toLocaleDateString('ru-RU',{month:'long',year:'numeric'}).replace(' г.','');
  const grid=$('calendar'); grid.replaceChildren();
  const offset=(month.getDay()+6)%7;
  for(let i=0;i<offset;i++) grid.append(document.createElement('span'));
  const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  for(let day=1;day<=days;day++) {
    const key=dateKey(new Date(month.getFullYear(),month.getMonth(),day));
    const button=document.createElement('button'); button.type='button'; button.textContent=day;
    button.classList.toggle('selected',key===selected);button.classList.toggle('today',key===todayKey);button.classList.toggle('has-workout',!!workouts[key]);
    button.setAttribute('aria-label',`${fromKey(key).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})}${workouts[key]?', есть тренировка':''}`);
    button.setAttribute('aria-pressed',String(key===selected));
    if(key===todayKey) button.setAttribute('aria-current','date');
    button.addEventListener('click',()=>selectDay(key));grid.append(button);
  }
}
function selectDay(key) {
  if (dirty && !confirm('Есть несохранённые изменения. Перейти к другой дате без сохранения?')) return false;
  selected=key; const date=fromKey(key); month=new Date(date.getFullYear(),date.getMonth(),1);
  loadForm();renderCalendar();renderStats();
  const panel=document.querySelector('.workout-panel');
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches) panel.animate([{opacity:.35,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:230,easing:'ease-out'});
  if(matchMedia('(max-width: 800px)').matches) document.querySelector('.training-column').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  return true;
}
function loadForm() {
  const date=fromKey(selected); const w=workouts[selected];
  $('selected-title').textContent=date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
  $('selected-subtitle').textContent=`${date.toLocaleDateString('ru-RU',{weekday:'long',year:'numeric'})} · ${w?(w.completed?'Тренировка выполнена':'Тренировка запланирована'):'Новый день — новые возможности'}`;
  $('day-chip').textContent=selected===todayKey?'СЕГОДНЯ':date.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
  $('workout-name').value=w?.name || ''; $('notes').value=w?.notes || ''; $('completed').checked=w?.completed || false;
  $('exercise-rows').replaceChildren(); if(w) w.exercises.forEach(addRow); else addRow();
  $('delete-workout').hidden=!w;dirty=false;status('');
  $('calendar-selection').textContent=`${date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})} · ${w?(w.completed?'Тренировка выполнена — запись открыта':'План тренировки открыт'):'Пока нет записи. Можно начать новую.'}`;
}
function renderStats() {
  const entries=Object.entries(workouts); const completed=entries.filter(([,w])=>w.completed);
  $('total-workouts').textContent=completed.length;
  const prefix=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
  $('month-workouts').textContent=completed.filter(([date])=>date.startsWith(prefix)).length;
  $('total-sets').textContent=completed.reduce((sum,[,w])=>sum+w.exercises.reduce((s,e)=>s+e.sets,0),0);
}
function renderHistory() {
  const history=$('history');history.replaceChildren();
  const entries=Object.entries(workouts).sort(([a],[b])=>b.localeCompare(a));
  if(!entries.length) { const empty=document.createElement('div');empty.className='empty-history';empty.textContent='Здесь начинается твой прогресс. Выбери день в календаре и сохрани первую тренировку.';history.append(empty);return; }
  entries.forEach(([key,w])=>{
    const card=document.createElement('button');card.type='button';card.className='history-card';
    const date=document.createElement('span');date.className='history-date';date.textContent=fromKey(key).toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'});
    const body=document.createElement('span');body.className='history-body';const name=document.createElement('strong');name.textContent=w.name||'Тренировка';
    const detail=document.createElement('small');detail.textContent=`${[...new Set(w.exercises.map(e=>e.muscle))].join(' / ')} · Упражнений: ${w.exercises.length} · Подходов: ${w.exercises.reduce((s,e)=>s+e.sets,0)}`;
    body.append(name,detail);const state=document.createElement('span');state.className='history-state';state.textContent=w.completed?'✓ Выполнена':'○ План';card.append(date,body,state);card.addEventListener('click',()=>{if(selectDay(key)) $('workout-form').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});});history.append(card);
  });
}
$('workout-form').addEventListener('input',()=>{dirty=true;});
$('workout-form').addEventListener('change',()=>{dirty=true;});
$('add-exercise').addEventListener('click',()=>{addRow();dirty=true;});
$('workout-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const rows=[...document.querySelectorAll('.exercise-row')];
  if(!rows.length) {status('Добавь хотя бы одно упражнение.',true);return;}
  const exercises=rows.map(row=>({muscle:row.querySelector('.muscle').value,exercise:row.querySelector('.exercise').value,...Object.fromEntries(['sets','reps','weight'].map(key=>[key,Number(row.querySelector(`.${key}`).value)]))}));
  const next={...workouts,[selected]:{name:$('workout-name').value.trim(),completed:$('completed').checked,notes:$('notes').value.trim(),exercises}};
  if(!validWorkouts(next)) {status('Проверь значения подходов, повторений и веса.',true);return;}
  if(await persist(next)) {loadForm();renderCalendar();renderStats();renderHistory();status('Тренировка сохранена. Ещё один шаг вперёд!');}
});
$('delete-workout').addEventListener('click',async()=>{
  if(busy)return;
  if(!confirm('Удалить тренировку за выбранный день? Это действие нельзя отменить.'))return;
  const next={...workouts};delete next[selected];
  if(await persist(next)){loadForm();renderCalendar();renderStats();renderHistory();status('Тренировка удалена.');}
});
for(const [id,delta] of [['prev-month',-1],['next-month',1]]) $(id).addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+delta,1);renderCalendar();renderStats();});
$('today').addEventListener('click',()=>selectDay(todayKey));
$('export').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(workouts,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`podhod-${todayKey}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
loadForm();renderCalendar();renderStats();renderHistory();
bootstrap();

$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file || busy)return;
  try {
    if(file.size>2000000) throw new Error('Файл слишком большой (максимум 2 МБ).');
    const data=JSON.parse(await file.text());
    if(!validWorkouts(data)) throw new Error('Файл не похож на экспорт истории ПОДХОД.');
    if(!confirm('Добавить тренировки из файла в аккаунт? При совпадении дат сохранятся записи аккаунта. Несохранённые изменения формы будут потеряны.'))return;
    if(await persist({...data,...workouts})) {refresh();status('История из файла добавлена в аккаунт.');}
  } catch(error) {status(error.message,true);}
  finally {event.target.value='';}
});
let chosenAvatar = 'fox';
function renderAccountAvatar() {
  const avatar=animalAvatar(currentUser?.avatar);
  $('avatar-button').innerHTML=avatarSvg(avatar.id);
  $('avatar-button').dataset.avatar=avatar.id;
  $('avatar-button').setAttribute('aria-label',`Аватарка: ${avatar.name}. Изменить`);
  $('avatar-button').hidden=!currentUser;
}
function updateAvatarPreview() {
  const avatar=animalAvatar(chosenAvatar);
  $('avatar-preview-image').innerHTML=avatarSvg(avatar.id);
  $('avatar-preview-name').textContent=avatar.name;
  document.querySelectorAll('.avatar-option').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.avatar===chosenAvatar)));
}
ANIMAL_AVATARS.forEach(avatar=>{
  const button=document.createElement('button');button.type='button';button.className='avatar-option';
  button.dataset.avatar=avatar.id;button.setAttribute('aria-pressed','false');
  button.innerHTML=avatarSvg(avatar.id);const label=document.createElement('span');label.textContent=avatar.name;button.append(label);
  button.addEventListener('click',()=>{chosenAvatar=avatar.id;updateAvatarPreview();$('avatar-status').textContent='';});
  $('avatar-options').append(button);
});
$('avatar-button').addEventListener('click',()=>{
  if(busy||!currentUser)return;
  chosenAvatar=animalAvatar(currentUser.avatar).id;updateAvatarPreview();$('avatar-status').textContent='';$('avatar-dialog').showModal();
});
$('close-avatar').addEventListener('click',()=>{if(!busy)$('avatar-dialog').close();});
$('avatar-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('save-avatar').addEventListener('click',async()=>{
  if(busy||!currentUser)return;
  busy=true;$('avatar-dialog').inert=true;$('avatar-status').textContent='Сохраняем…';
  try {
    const result=await api('profile','PUT',{avatar:chosenAvatar});
    currentUser={...currentUser,...result.user};renderAccountAvatar();$('avatar-dialog').close();
  } catch(error) {$('avatar-status').textContent=error.message+' Аватарка не изменена.';}
  finally {busy=false;$('avatar-dialog').inert=false;}
});
$('new-today').addEventListener('click',()=>selectDay(todayKey));
