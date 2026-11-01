const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('cloud.js','utf8');
const config = {supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_test'};
function adapter(client) {
  const context = {location:{href:'https://tatatib.github.io/pet1/index.html'},URL,atob,setTimeout};
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
test('signup without a session asks for confirmation and keeps project subpath',async()=>{
  const mock=client();let request;
  mock.auth.signUp=async input=>{request=input;return {data:{user:{email:'a@example.com'},session:null},error:null};};
  const result=await adapter(mock)('register','POST',{login:' a@example.com ',password:'password123'});
  assert.equal(result.user,null);assert.match(result.message,/подтверждения/);
  assert.equal(request.email,'a@example.com');assert.equal(request.options.emailRedirectTo,'https://tatatib.github.io/pet1/');
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
test('recovery and signout use supported Supabase operations',async()=>{
  const mock=client();let reset,changed,scope;
  mock.auth.resetPasswordForEmail=async(email,options)=>{reset={email,options};return {};};
  mock.auth.updateUser=async(data)=>{changed=data;return {};};
  mock.auth.signOut=async(data)=>{scope=data.scope;return {};};
  const api=adapter(mock);await api('reset-password','POST',{email:'a@example.com'});await api('update-password','POST',{password:'a-new-password'});await api('logout','POST');
  assert.equal(reset.options.redirectTo,'https://tatatib.github.io/pet1/');assert.equal(changed.password,'a-new-password');assert.equal(scope,'local');
});
