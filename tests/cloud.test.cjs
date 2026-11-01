const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('cloud.js','utf8');
const config = {supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_test'};
function adapter(client, autoconfirm=true) {
  const context = {location:{href:'https://tatatib.github.io/pet1/index.html'},URL,atob,setTimeout,fetch:async()=>({ok:true,json:async()=>({mailer_autoconfirm:autoconfirm})})};
  vm.createContext(context);vm.runInContext(code,context);
  return context.createCloudBackend(config,{createClient:()=>client},()=>{});
}
function client() {
  return {auth:{onAuthStateChange() {},getSession:async()=>({data:{session:null}})},from:()=>({select:()=>({maybeSingle:async()=>({data:null,error:null})})})};
}
test('unconfigured sites and privileged keys are rejected',()=>{
  const context={atob};vm.createContext(context);vm.runInContext(code,context);
  assert.throws(()=>context.createCloudBackend({},null,()=>{}),/настраивается/);
  assert.throws(()=>context.createCloudBackend({...config,supabasePublishableKey:'sb_secret_never-use-in-browser'},null,()=>{}),/публичный/);
  const token='eyJ.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x';
  assert.throws(()=>context.createCloudBackend({...config,supabasePublishableKey:token},null,()=>{}),/публичный/);
});
test('empty sessions and missing workout rows are normal',async()=>{
  const api=adapter(client());assert.equal((await api('me')).user,null);
  assert.deepEqual(JSON.parse(JSON.stringify(await api('workouts'))),{workouts:{},revision:0});
});
test('registration is immediate and does not request email redirects',async()=>{
  const mock=client();let request;
  mock.auth.signUp=async input=>{request=input;return {data:{user:{email:'a@example.com'},session:{}},error:null};};
  const result=await adapter(mock)('register','POST',{login:' a@example.com ',password:'password123'});
  assert.equal(result.user.login,'a@example.com');assert.equal(request.email,'a@example.com');
  assert.equal('options' in request,false);
});
test('signup is never called when confirmation emails are enabled or settings are unknown',async()=>{
  const mock=client();let called=false;
  mock.auth.signUp=async()=>{called=true;throw new Error('Unexpected signup');};
  for(const setting of [false,null]) await assert.rejects(adapter(mock,setting)('register','POST',{login:'a@example.com',password:'password123'}),/выключить Confirm email/);
  assert.equal(called,false);
});
test('password login and optimistic saves pass identity only via Supabase session',async()=>{
  const mock=client();let request;
  mock.auth.signInWithPassword=async()=>({data:{user:{email:'a@example.com'},session:{}},error:null});
  mock.rpc=async(name,params)=>{request={name,params};return {data:{revision:3},error:null};};
  const api=adapter(mock);assert.equal((await api('login','POST',{login:'a@example.com',password:'pass'})).user.login,'a@example.com');
  assert.equal((await api('workouts','PUT',{workouts:{},revision:2})).revision,3);
  assert.equal(request.name,'save_workouts');assert.equal(request.params.p_expected_revision,2);assert.equal('user_id' in request.params,false);
  mock.rpc=async()=>({error:{code:'PT409'}});
  await assert.rejects(api('workouts','PUT',{workouts:{},revision:2}),/другой вкладке/);
});
test('signout remains available but email recovery endpoints are removed',async()=>{
  const mock=client();let scope;
  mock.auth.signOut=async(data)=>{scope=data.scope;return {};};
  const api=adapter(mock);await api('logout','POST');assert.equal(scope,'local');
  await assert.rejects(api('reset-password','POST',{email:'a@example.com'}),/Неизвестный запрос/);
  await assert.rejects(api('update-password','POST',{password:'a-new-password'}),/Неизвестный запрос/);
});

test('avatars use authenticated user metadata and reject arbitrary uploads',async()=>{
  const mock=client();let request;
  mock.auth.updateUser=async(data)=>{request=data;return {data:{user:{email:'a@example.com',user_metadata:{avatar:data.data.avatar}}},error:null};};
  const api=adapter(mock);const result=await api('profile','PUT',{avatar:'panda'});
  assert.equal(request.data.avatar,'panda');assert.equal(result.user.avatar,'panda');
  await assert.rejects(api('profile','PUT',{avatar:'https://untrusted.example/avatar.svg'}),/из списка/);
});

test('sign-in errors identify the failed operation without exposing raw responses',async()=>{
  const mock=client();
  mock.auth.signInWithPassword=async()=>({error:{code:'deployment_unavailable',status:400,message:'PRIVATE_RESPONSE_DO_NOT_SHOW'},data:{}});
  await assert.rejects(adapter(mock)('login','POST',{login:'a@example.com',password:'password123'}),error=>{
    assert.match(error.message,/Вход · deployment_unavailable · HTTP 400/);
    assert.doesNotMatch(error.message,/PRIVATE_RESPONSE/);return true;
  });
  mock.auth.signInWithPassword=async()=>({error:{name:'AuthRetryableFetchError',message:'Failed to fetch',status:0},data:{}});
  await assert.rejects(adapter(mock)('login','POST',{login:'a@example.com',password:'password123'}),/Вход · NETWORK/);
});
test('session and database errors are distinct from invalid credentials',async()=>{
  const mock=client();
  mock.auth.getSession=async()=>({error:{code:'refresh_token_not_found',status:400},data:{}});
  await assert.rejects(adapter(mock)('me'),/Восстановление сессии · refresh_token_not_found/);
  mock.from=()=>({select:()=>({maybeSingle:async()=>({error:{code:'42501',message:'PRIVATE_DATABASE_RESPONSE'},status:403,data:null})})});
  await assert.rejects(adapter(mock)('workouts'),error=>{
    assert.match(error.message,/База отклонила доступ/);assert.match(error.message,/Загрузка тренировок · 42501 · HTTP 403/);
    assert.doesNotMatch(error.message,/PRIVATE_DATABASE_RESPONSE/);return true;
  });
});

test('legacy Auth responses without an error code still explain wrong credentials',async()=>{
  const mock=client();
  mock.auth.signInWithPassword=async()=>({error:{status:400,message:'Invalid login credentials'},data:{}});
  await assert.rejects(adapter(mock)('login','POST',{login:'a@example.com',password:'password123'}),/Неверная почта или пароль.*Вход · invalid_credentials · HTTP 400/);
});
