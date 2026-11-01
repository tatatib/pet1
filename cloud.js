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
  const fail = (error, operation, responseStatus) => {
    if (!error) return;
    const messages = {
      invalid_credentials: 'Неверная почта или пароль.',
      invalid_api_key: 'Публичный ключ проекта отклонён. Владельцу сайта нужно проверить ключ в Supabase.',
      email_not_confirmed: 'Сначала подтверди почту по ссылке из письма.',
      user_already_exists: 'Такой аккаунт уже зарегистрирован.',
      over_email_send_rate_limit: 'Превышен лимит писем. Попробуй позже.',
      over_request_rate_limit: 'Слишком много попыток. Попробуй позже.',
      signup_disabled: 'Регистрация временно отключена.',
      weak_password: 'Пароль слишком простой. Используй более длинный и сложный пароль.',
      session_not_found: 'Сессия завершилась. Войди снова.',
      refresh_token_not_found: 'Сессия завершилась. Введи почту и пароль заново.',
      refresh_token_already_used: 'Сессия устарела. Введи почту и пароль заново.',
      bad_jwt: 'Сессия недействительна. Введи почту и пароль заново.',
      user_not_found: 'Аккаунт больше недоступен. Войди заново или зарегистрируйся.',
      email_address_invalid: 'Проверь адрес электронной почты.',
      email_address_not_authorized: 'Отправка писем на этот адрес пока не настроена владельцем сайта.',
      provider_disabled: 'Вход по почте отключён в настройках проекта.',
      email_provider_disabled: 'Вход по почте отключён в настройках проекта.',
      captcha_failed: 'Проверка CAPTCHA не пройдена. Проверь настройки защиты регистрации.',
      unexpected_failure: 'Сервис аккаунтов вернул внутреннюю ошибку. Попробуй позже.',
      request_timeout: 'Сервис аккаунтов не ответил вовремя. Попробуй ещё раз.',
      '42501': 'База отклонила доступ к истории. Владельцу сайта нужно проверить права таблицы и функции в Supabase.',
      'PGRST116': 'База вернула неоднозначную историю. Владельцу сайта нужно проверить правила доступа к тренировкам.',
      'PGRST301': 'Сессия устарела. Введи почту и пароль заново.',
      'PGRST303': 'Сессия устарела. Введи почту и пароль заново.',
      'PT409': 'История изменена в другой вкладке или на другом устройстве. Обнови страницу перед сохранением.',
      'PT400': 'Проверь данные тренировки.',
      '42P01': 'База ещё не настроена. Выполни supabase/schema.sql в SQL Editor проекта.',
      'PGRST205': 'База ещё не настроена. Выполни supabase/schema.sql в SQL Editor проекта.',
      'PGRST202': 'Сохранение ещё не настроено. Выполни supabase/schema.sql в SQL Editor проекта.'
    };
    const httpStatus = Number(error.status || responseStatus) || 0;
    let code = typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code) ? error.code : '';
    // Older Auth responses may omit the version header and machine-readable code.
    // Recognize only fixed known messages; never display an arbitrary server body.
    const legacyCodes = {
      'invalid login credentials': 'invalid_credentials',
      'email not confirmed': 'email_not_confirmed',
      'invalid api key': 'invalid_api_key',
      'user already registered': 'user_already_exists',
      'invalid refresh token: refresh token not found': 'refresh_token_not_found'
    };
    if (!code) code = legacyCodes[String(error.message || '').trim().toLowerCase()] || '';
    const network = !httpStatus && (error.name === 'AuthRetryableFetchError' || /fetch|network|timeout|abort/i.test(error.message || ''));
    let message = messages[code];
    if (!message && network) message = 'Браузер не смог связаться с Supabase. Проверь доступ к сервису, подключение к Интернету и блокировщики запросов.';
    if (!message && error.name === 'AuthSessionMissingError') message = 'Сессия завершилась. Введи почту и пароль заново.';
    if (!message && httpStatus === 401) message = 'Сервис отклонил авторизацию. Проверь почту и пароль; если ошибка повторяется, владельцу сайта нужно проверить публичный ключ проекта.';
    if (!message && httpStatus === 403) message = 'Сервис запретил это действие. Владельцу сайта нужно проверить настройки доступа.';
    if (!message && httpStatus === 429) message = 'Слишком много запросов. Подожди несколько минут и попробуй снова.';
    if (!message && httpStatus >= 500) message = 'Supabase временно недоступен. Попробуй позже; проект также может быть приостановлен.';
    message ||= 'Сервис вернул неизвестную ошибку. Передай владельцу сайта код ниже.';
    // Share only bounded codes/status, never raw response bodies, emails or tokens.
    const diagnostic = [operation, code || (network ? 'NETWORK' : 'UNKNOWN'), httpStatus ? `HTTP ${httpStatus}` : ''].filter(Boolean).join(' · ');
    const result = new Error(`${message} (${diagnostic})`);
    result.code = code;
    result.operation = operation;
    throw result;
  };
  const userInfo = user => user ? {login:user.email,avatar:user.user_metadata?.avatar || 'fox'} : null;
  return async function cloudApi(path, method='GET', body={}) {
    if (path === 'me') {
      const session = await client.auth.getSession(); fail(session.error,'Восстановление сессии');
      if (!session.data.session) return {user:null};
      const result = await client.auth.getUser(); fail(result.error,'Проверка аккаунта');
      return {user:userInfo(result.data.user)};
    }
    if (path === 'register' || path === 'login') {
      const credentials = {email:body.login.trim(),password:body.password};
      const result = path === 'register'
        ? await client.auth.signUp({...credentials,options:{emailRedirectTo:callbackUrl}})
        : await client.auth.signInWithPassword(credentials);
      fail(result.error,path === 'register' ? 'Регистрация' : 'Вход');
      return {user:result.data.session ? userInfo(result.data.user) : null, message:'Проверь почту: если регистрация доступна, придёт ссылка подтверждения. После подтверждения войди в аккаунт.'};
    }
    if (path === 'profile' && method === 'PUT') {
      if (!['fox','cat','bear','wolf','rabbit','tiger','panda'].includes(body.avatar)) throw new Error('Выбери животное из списка.');
      const result=await client.auth.updateUser({data:{avatar:body.avatar}});fail(result.error,'Сохранение аватарки');
      return {user:userInfo(result.data.user)};
    }
    if (path === 'logout') { const result=await client.auth.signOut({scope:'local'}); fail(result.error,'Выход'); return {ok:true}; }
    if (path === 'reset-password') {
      const result=await client.auth.resetPasswordForEmail(body.email,{redirectTo:callbackUrl});fail(result.error,'Письмо для смены пароля');return {ok:true};
    }
    if (path === 'update-password') {
      const result=await client.auth.updateUser({password:body.password});fail(result.error,'Смена пароля');return {ok:true};
    }
    if (path === 'workouts' && method === 'GET') {
      const result=await client.from('workout_state').select('workouts,revision').maybeSingle();fail(result.error,'Загрузка тренировок',result.status);
      return result.data || {workouts:{},revision:0};
    }
    if (path === 'workouts' && method === 'PUT') {
      const result=await client.rpc('save_workouts',{p_workouts:body.workouts,p_expected_revision:body.revision});fail(result.error,'Сохранение тренировки',result.status);
      return result.data;
    }
    throw new Error('Неизвестный запрос.');
  };
}
