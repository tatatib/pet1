'use strict';
// Fixed illustrations only: users cannot upload images or inject SVG markup.
const ANIMAL_AVATARS = [
  {id:'fox',name:'Лиса',color:'#ff9258',art:'<path d="M18 43 16 9 39 28M62 43 64 9 41 28" fill="#ff9258"/><path d="m22 24 1-8 9 12m26-4-1-8-9 12" stroke="#4d281d" stroke-width="5"/><path d="M15 41 25 25h30l10 16-8 22-17 9-17-9Z" fill="#ff9258"/><path d="m16 43 23 11 25-11-8 20-16 8-16-8Z" fill="#fff0d9"/>'},
  {id:'cat',name:'Кот',color:'#d1f866',art:'<path d="M17 43 16 11 36 27h8l20-16-1 32Z" fill="#d1f866"/><circle cx="40" cy="46" r="27" fill="#d1f866"/><path d="m20 20 2 13 9-5m29-8-2 13-9-5" fill="#8aa640"/><path d="m9 49 18 3m-16 6 16-2m44-7-18 3m16 6-16-2" stroke="#454f2a" stroke-width="2" stroke-linecap="round"/>'},
  {id:'bear',name:'Медведь',color:'#c79a72',art:'<circle cx="20" cy="23" r="13" fill="#c79a72"/><circle cx="60" cy="23" r="13" fill="#c79a72"/><circle cx="20" cy="23" r="6" fill="#6e4a38"/><circle cx="60" cy="23" r="6" fill="#6e4a38"/><rect x="13" y="22" width="54" height="50" rx="24" fill="#c79a72"/><ellipse cx="40" cy="55" rx="16" ry="13" fill="#f4d7ac"/>'},
  {id:'wolf',name:'Волк',color:'#b5c4d4',art:'<path d="M15 43 21 8 38 28h4L59 8l6 35-9 20-16 9-16-9Z" fill="#b5c4d4"/><path d="m23 20 3 15 8-6m23-9-3 15-8-6" fill="#637181"/><path d="m17 45 16 6 7-9 7 9 16-6-8 18-15 9-15-9Z" fill="#f0f3ed"/>'},
  {id:'rabbit',name:'Заяц',color:'#c7b6f4',art:'<ellipse cx="27" cy="23" rx="10" ry="23" transform="rotate(-12 27 23)" fill="#c7b6f4"/><ellipse cx="53" cy="23" rx="10" ry="23" transform="rotate(12 53 23)" fill="#c7b6f4"/><path d="m25 10 4 23m26-23-4 23" stroke="#8b70bb" stroke-width="6" stroke-linecap="round"/><ellipse cx="40" cy="49" rx="26" ry="24" fill="#c7b6f4"/><ellipse cx="40" cy="56" rx="14" ry="12" fill="#f4ebff"/>'},
  {id:'tiger',name:'Тигр',color:'#ffb052',art:'<circle cx="20" cy="23" r="11" fill="#ffb052"/><circle cx="60" cy="23" r="11" fill="#ffb052"/><rect x="13" y="22" width="54" height="50" rx="24" fill="#ffb052"/><path d="m31 23 3 11m15-11-3 11m-31 6 10 5m-11 5 10 4m41-14-10 5m11 5-10 4" stroke="#503324" stroke-width="4" stroke-linecap="round"/><ellipse cx="40" cy="57" rx="17" ry="12" fill="#fff0da"/>'},
  {id:'panda',name:'Панда',color:'#f4f2df',art:'<circle cx="20" cy="23" r="13" fill="#343b3a"/><circle cx="60" cy="23" r="13" fill="#343b3a"/><rect x="13" y="22" width="54" height="50" rx="24" fill="#f4f2df"/><ellipse cx="28" cy="44" rx="10" ry="12" transform="rotate(25 28 44)" fill="#343b3a"/><ellipse cx="52" cy="44" rx="10" ry="12" transform="rotate(-25 52 44)" fill="#343b3a"/>'}
];
function animalAvatar(id) { return ANIMAL_AVATARS.find(avatar=>avatar.id===id) || ANIMAL_AVATARS[0]; }
function avatarSvg(id) {
  const animal=animalAvatar(id);
  const eyes=animal.id==='panda'?'#fff':'#212823';
  return `<svg viewBox="0 0 80 80" fill="none" aria-hidden="true" focusable="false">${animal.art}<circle cx="29" cy="43" r="3" fill="${eyes}"/><circle cx="51" cy="43" r="3" fill="${eyes}"/><path d="m36 53 4 4 4-4Z" fill="#212823" stroke="#212823" stroke-linejoin="round"/><path d="M40 57v4m0 0c-3 3-6 1-7 0m7 0c3 3 6 1 7 0" stroke="#212823" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}
