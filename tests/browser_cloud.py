import base64, functools, json, secrets, shutil, tempfile, threading, time
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

def jwt(uid):
 def b64(value):return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
 return b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':uid,'role':'authenticated','aud':'authenticated','exp':int(time.time())+3600})+'.fake-signature'

PROJECT = Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);site=root/'pet1';site.mkdir();(site/'vendor').mkdir()
 for name in ['index.html','style.css','app.js','cloud.js','vendor/supabase.js']:
  shutil.copy(PROJECT/name,site/name)
 (site/'config.js').write_text("window.PODHOD_CONFIG={backend:'supabase',supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_test',emailRecoveryEnabled:true};")
 class Quiet(SimpleHTTPRequestHandler):
  def log_message(self,*args):pass
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=directory));threading.Thread(target=server.serve_forever,daemon=True).start()
 base=f'http://localhost:{server.server_port}/pet1/'
 users={};tokens={};histories={};confirmation=False
 def route_api(route):
  global confirmation
  request=route.request;path=request.url.split('.co')[1];data=request.post_data_json if request.post_data else {}
  headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Content-Type':'application/json'}
  def respond(body,status=200):route.fulfill(status=status,headers=headers,body=json.dumps(body))
  if request.method=='OPTIONS':return respond({})
  token=request.headers.get('authorization','').removeprefix('Bearer ');uid=tokens.get(token)
  if path.startswith('/auth/v1/signup') or path.startswith('/auth/v1/token'):
   email=data['email']
   if path.startswith('/auth/v1/signup'):
    if email in users:return respond({'code':'user_already_exists','msg':'Already registered'},422)
    users[email]={'id':secrets.token_hex(8),'email':email,'aud':'authenticated','role':'authenticated'}
   if email not in users:return respond({'code':'invalid_credentials','msg':'Invalid'},400)
   user=users[email]
   if confirmation and path.startswith('/auth/v1/signup'):return respond({'id':user['id'],'email':email})
   token=jwt(user['id']);tokens[token]=user['id']
   return respond({'access_token':token,'token_type':'bearer','expires_in':3600,'refresh_token':'refresh-'+user['id'],'user':user})
  if path.startswith('/auth/v1/user'):
   if request.method=='PUT':return respond(next(u for u in users.values() if u['id']==uid))
   return respond(next((u for u in users.values() if u['id']==uid),{}))
  if path.startswith('/auth/v1/logout'):return respond({})
  if path.startswith('/auth/v1/recover'):return respond({})
  if not uid:return respond({'code':'42501','message':'Not authenticated'},401)
  if path.startswith('/rest/v1/workout_state'):
   return respond([histories[uid]] if uid in histories else [])
  if path.startswith('/rest/v1/rpc/save_workouts'):
   state=histories.get(uid,{'workouts':{},'revision':0})
   if data['p_expected_revision']!=state['revision']:return respond({'code':'PT409','message':'conflict'},409)
   histories[uid]={'workouts':data['p_workouts'],'revision':state['revision']+1}
   return respond({'revision':state['revision']+1})
  raise AssertionError(request.url)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
   errors=[]
   def context():
    c=browser.new_context();c.route('https://example.supabase.co/**',route_api);return c
   c=context();page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base)
   page.locator('#register-tab').click();page.locator('#login').fill('alice@example.com');page.locator('#password').fill('password-12345');page.locator('#auth-submit').click()
   page.locator('#workout-name').fill('В облаке');page.locator('#completed').check();page.locator('button[type=submit]').filter(has_text='Сохранить').click()
   page.wait_for_function("() => document.querySelector('#status').textContent.includes('сохранена')")
   page.reload();page.locator('#workout-name').wait_for(state='visible');assert page.locator('#workout-name').input_value()=='В облаке'
   second_context=context();other=second_context.new_page();other.goto(base);other.locator('#login').fill('alice@example.com');other.locator('#password').fill('password-12345');other.locator('#auth-submit').click();other.locator('#workout-name').wait_for(state='visible');assert other.locator('#workout-name').input_value()=='В облаке'
   other.locator('#workout-name').fill('Другая вкладка');other.locator('button[type=submit]').filter(has_text='Сохранить').click();other.wait_for_function("() => document.querySelector('#status').textContent.includes('сохранена')")
   page.locator('#workout-name').fill('Конфликт');page.locator('button[type=submit]').filter(has_text='Сохранить').click();page.wait_for_function("() => document.querySelector('#status').textContent.includes('другой вкладке')")
   page.on('dialog',lambda d:d.accept());page.locator('#logout').click();page.locator('#auth-screen').wait_for(state='visible')
   page.locator('#register-tab').click();page.locator('#login').fill('bob@example.com');page.locator('#password').fill('password-12345');page.locator('#auth-submit').click();page.locator('#workout-name').wait_for(state='visible');assert page.locator('.history-card').count()==0
   old={'2026-10-01':{'name':'Старый Mac','notes':'','completed':True,'exercises':[{'muscle':'Грудь','exercise':'Жим штанги лёжа','sets':3,'reps':10,'weight':40}]}}
   page.locator('#import-file').set_input_files({'name':'history.json','mimeType':'application/json','buffer':json.dumps(old).encode()});page.locator('.history-card').wait_for(state='visible');assert 'Старый Mac' in page.locator('.history-card').inner_text()
   page.reload();page.locator('.history-card').wait_for(state='visible');assert 'Старый Mac' in page.locator('.history-card').inner_text()
   page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.locator('#logout').click();page.locator('#auth-screen').wait_for(state='visible');confirmation=True
   page.locator('#register-tab').click();page.locator('#login').fill('confirm@example.com');page.locator('#password').fill('password-12345');page.locator('#auth-submit').click();page.wait_for_function("() => document.querySelector('#auth-status').textContent.includes('подтверждения')");assert not page.locator('main').is_visible()
   assert not errors,errors
   browser.close()
  print('PASS: actual Supabase SDK against mocked Auth/PostgREST; Pages subpath, signup, email confirmation, session reload, two browsers, conflict, isolated account UI, JSON import, mobile, logout')
 finally:server.shutdown();server.server_close()
