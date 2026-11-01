'use strict';
// Supabase handles sessions/refresh tokens; database access is protected by SQL RLS.
function createCloudBackend(config, sdk, onAuthEvent) {
  const url = (config.supabaseUrl || '').replace(/\/$/, '');
  const key = config.supabasePublishableKey || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key) {
    throw new Error('Сайт ещё настраивается. Нужно подключить проект Supabase в config.js.');
  }
  let publicKey = key.startsWith('sb_publishable_');
  if (key.startsWith('eyJ')) {
    try { publicKey = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch { /* reject invalid keys */ }
  }
  if (!publicKey) throw new Error('В config.js нужен публичный Publishable или anon ключ. Секретные ключи здесь использовать нельзя.');
  if (!sdk) throw new Error('Не удалось загрузить модуль аккаунтов. Обнови страницу.');
  const client = sdk.createClient(url, key, {auth: {flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  client.auth.onAuthStateChange((event) => { setTimeout(() => onAuthEvent(event), 0); });
  const callbackUrl = new URL('./', location.href).href;
  const fail = error => {
    if (!error) return;
    const messages = {
      invalid_credentials: 'Неверная почта или пароль.',
      email_not_confirmed: 'Сначала подтверди почту по ссылке из письма.',
      user_already_exists: 'Такой аккаунт уже зарегистрирован.',
      over_email_send_rate_limit: 'Превышен лимит писем. Попробуй позже.',
      over_request_rate_limit: 'Слишком много попыток. Попробуй позже.',
      signup_disabled: 'Регистрация временно отключена.',
      weak_password: 'Пароль слишком простой. Используй более длинный и сложный пароль.',
      session_not_found: 'Сессия завершилась. Войди снова.',
      'PT409': 'История изменена в другой вкладке или на другом устройстве. Обнови страницу перед сохранением.',
      'PT400': 'Проверь данные тренировки.',
      '42P01': 'База ещё не настроена. Выполни supabase/schema.sql в SQL Editor проекта.',
      'PGRST205': 'База ещё не настроена. Выполни supabase/schema.sql в SQL Editor проекта.',
      'PGRST202': 'Сохранение ещё не настроено. Выполни supabase/schema.sql в SQL Editor проекта.'
    };
    throw new Error(messages[error.code] || 'Не удалось выполнить запрос к Supabase. Проверь соединение и настройки проекта.');
  };
  const userInfo = user => user ? {login:user.email,avatar:user.user_metadata?.avatar || 'fox'} : null;
  return async function cloudApi(path, method='GET', body={}) {
    if (path === 'me') {
      const session = await client.auth.getSession(); fail(session.error);
      if (!session.data.session) return {user:null};
      const result = await client.auth.getUser(); fail(result.error);
      return {user:userInfo(result.data.user)};
    }
    if (path === 'register' || path === 'login') {
      const credentials = {email:body.login.trim(),password:body.password};
      const result = path === 'register'
        ? await client.auth.signUp({...credentials,options:{emailRedirectTo:callbackUrl}})
        : await client.auth.signInWithPassword(credentials);
      fail(result.error);
      return {user:result.data.session ? userInfo(result.data.user) : null, message:'Проверь почту: если регистрация доступна, придёт ссылка подтверждения. После подтверждения войди в аккаунт.'};
    }
    if (path === 'profile' && method === 'PUT') {
      if (!['fox','cat','bear','wolf','rabbit','tiger','panda'].includes(body.avatar)) throw new Error('Выбери животное из списка.');
      const result=await client.auth.updateUser({data:{avatar:body.avatar}});fail(result.error);
      return {user:userInfo(result.data.user)};
    }
    if (path === 'logout') { const result=await client.auth.signOut({scope:'local'}); fail(result.error); return {ok:true}; }
    if (path === 'reset-password') {
      const result=await client.auth.resetPasswordForEmail(body.email,{redirectTo:callbackUrl});fail(result.error);return {ok:true};
    }
    if (path === 'update-password') {
      const result=await client.auth.updateUser({password:body.password});fail(result.error);return {ok:true};
    }
    if (path === 'workouts' && method === 'GET') {
      const result=await client.from('workout_state').select('workouts,revision').maybeSingle();fail(result.error);
      return result.data || {workouts:{},revision:0};
    }
    if (path === 'workouts' && method === 'PUT') {
      const result=await client.rpc('save_workouts',{p_workouts:body.workouts,p_expected_revision:body.revision});fail(result.error);
      return result.data;
    }
    throw new Error('Неизвестный запрос.');
  };
}
