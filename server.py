"""Small same-origin account API and static web server. Run: python3 server.py."""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import deque
from datetime import date
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
SESSION_AGE = 30 * 86400
MAX_BODY = 2_000_000


def valid_workouts(data):
    if not isinstance(data, dict) or len(data) > 10000:
        return False
    for key, w in data.items():
        try:
            if date.fromisoformat(key).isoformat() != key:
                return False
        except (ValueError, TypeError):
            return False
        if not isinstance(w, dict) or not isinstance(w.get('name'), str) or len(w['name']) > 80 or not isinstance(w.get('notes'), str) or len(w['notes']) > 2000 or type(w.get('completed')) is not bool:
            return False
        exercises = w.get('exercises')
        if not isinstance(exercises, list) or not 1 <= len(exercises) <= 100:
            return False
        for e in exercises:
            if not isinstance(e, dict):
                return False
            if any(not isinstance(e.get(k), str) or not 1 <= len(e[k]) <= 120 for k in ('muscle', 'exercise')):
                return False
            for key, maximum in [('sets', 100), ('reps', 1000)]:
                if type(e.get(key)) is not int or not 1 <= e[key] <= maximum:
                    return False
            weight = e.get('weight')
            if type(weight) not in (int, float) or not math.isfinite(weight) or not 0 <= weight <= 2000:
                return False
    return True


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


class App(ThreadingHTTPServer):
    def __init__(self, address, db_path, origin=None, secure=False):
        super().__init__(address, Handler)
        self.db_path = str(db_path)
        self.origin = origin or f'http://localhost:{self.server_port}'
        self.secure = secure
        self.attempts = {}
        self.rate_lock = threading.Lock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE,
                    salt TEXT NOT NULL, password TEXT NOT NULL,
                    workouts TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
            ''')
        os.chmod(db_path, 0o600)

    def db(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def rate_allowed(self, ip):
        now = time.time()
        with self.rate_lock:
            self.attempts = {k: v for k, v in self.attempts.items() if v and now-v[-1] < 600}
            queue = self.attempts.setdefault(ip, deque())
            while queue and now-queue[0] >= 600:
                queue.popleft()
            if len(queue) >= 20:
                return False
            queue.append(now)
            return True


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, fmt, *args):
        # Do not log credentials, request bodies or cookies.
        pass

    def respond(self, status, data, cookie=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.security_headers()
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def security_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

    def session_token(self):
        try:
            cookie = SimpleCookie(self.headers.get('Cookie', ''))
            return cookie['podhod_session'].value if 'podhod_session' in cookie else ''
        except CookieError:
            return ''

    def user(self, db):
        token = hashlib.sha256(self.session_token().encode()).hexdigest()
        return db.execute('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?', (token, int(time.time()))).fetchone()

    def cookie(self, token, age=SESSION_AGE):
        return f'podhod_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}' + ('; Secure' if self.server.secure else '')

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/'):
            with self.server.db() as db:
                user = self.user(db)
                if path == '/api/me':
                    return self.respond(200, {'user': {'login': user['login']} if user else None})
                if path == '/api/workouts':
                    if not user:
                        return self.respond(401, {'error': 'Войди в аккаунт.'})
                    return self.respond(200, {'workouts': json.loads(user['workouts']), 'revision': user['revision']})
                return self.respond(404, {'error': 'Не найдено.'})
        allowed = {'/': ('index.html', 'text/html'), '/index.html': ('index.html', 'text/html'), '/style.css': ('style.css', 'text/css'), '/app.js': ('app.js', 'text/javascript'), '/cloud.js': ('cloud.js', 'text/javascript'), '/config.js': ('config.js', 'text/javascript'), '/vendor/supabase.js': ('vendor/supabase.js', 'text/javascript')}
        if path not in allowed:
            return self.respond(404, {'error': 'Не найдено.'})
        filename, content_type = allowed[path]
        body = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', content_type + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.security_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.mutate()

    def do_PUT(self):
        self.mutate()

    def mutate(self):
        if self.headers.get('X-Podhod') != '1' or self.headers.get('Origin') != self.server.origin:
            return self.respond(403, {'error': 'Запрос с другого сайта запрещён.'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.respond(415, {'error': 'Ожидается JSON.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= MAX_BODY:
                return self.respond(413, {'error': 'Слишком большой запрос.'})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, UnicodeDecodeError):
            return self.respond(400, {'error': 'Некорректные данные.'})
        path = urlsplit(self.path).path
        with self.server.db() as db:
            if path in ('/api/register', '/api/login') and self.command == 'POST':
                if not self.server.rate_allowed(self.client_address[0]):
                    return self.respond(429, {'error': 'Слишком много попыток. Попробуй через 10 минут.'})
                login, password = data.get('login'), data.get('password')
                if not isinstance(login, str) or not re.fullmatch(r'[a-zA-Z0-9_.-]{3,32}', login) or not isinstance(password, str) or not 10 <= len(password) <= 128:
                    return self.respond(400, {'error': 'Логин: 3–32 латинские буквы, цифры, точка, дефис или _. Пароль: 10–128 символов.'})
                login = login.lower()
                user = db.execute('SELECT * FROM users WHERE login=?', (login,)).fetchone()
                if path == '/api/register':
                    salt = secrets.token_hex(16)
                    digest = password_hash(password, salt)
                    try:
                        cursor = db.execute('INSERT INTO users (login,salt,password) VALUES (?,?,?)', (login, salt, digest))
                    except sqlite3.IntegrityError:
                        return self.respond(409, {'error': 'Этот логин уже занят.'})
                    user_id = cursor.lastrowid
                else:
                    # Perform the expensive hash even for an unknown login.
                    digest = password_hash(password, user['salt'] if user else '0'*32)
                    if not user or not hmac.compare_digest(digest, user['password']):
                        return self.respond(401, {'error': 'Неверный логин или пароль.'})
                    user_id = user['id']
                db.execute('DELETE FROM sessions WHERE expires<=?', (int(time.time()),))
                old = hashlib.sha256(self.session_token().encode()).hexdigest()
                db.execute('DELETE FROM sessions WHERE token=?', (old,))
                token = secrets.token_urlsafe(32)
                db.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time())+SESSION_AGE))
                db.commit()
                return self.respond(200, {'user': {'login': login}}, self.cookie(token))
            user = self.user(db)
            if path == '/api/logout' and self.command == 'POST':
                token = hashlib.sha256(self.session_token().encode()).hexdigest()
                db.execute('DELETE FROM sessions WHERE token=?', (token,))
                db.commit()
                return self.respond(200, {'ok': True}, self.cookie('', 0))
            if not user:
                return self.respond(401, {'error': 'Сессия завершилась. Скачай историю и обнови страницу, чтобы войти снова.'})
            if path == '/api/workouts' and self.command == 'PUT':
                if not valid_workouts(data.get('workouts')) or type(data.get('revision')) is not int:
                    return self.respond(400, {'error': 'Некорректная тренировка.'})
                result = db.execute('UPDATE users SET workouts=?, revision=revision+1 WHERE id=? AND revision=?', (json.dumps(data['workouts'], ensure_ascii=False), user['id'], data['revision']))
                if result.rowcount != 1:
                    return self.respond(409, {'error': 'История изменена в другой вкладке или на другом устройстве. Скачай свою копию и обнови страницу перед повторным сохранением.'})
                db.commit()
                return self.respond(200, {'revision': data['revision']+1})
            return self.respond(404, {'error': 'Не найдено.'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    origin = os.environ.get('APP_ORIGIN', f'http://localhost:{port}').rstrip('/')
    app = App((os.environ.get('HOST', '127.0.0.1'), port), os.environ.get('DATABASE_PATH', str(ROOT / 'data' / 'podhod.sqlite3')), origin, origin.startswith('https://'))
    print(f'ПОДХОД: {origin}', flush=True)
    app.serve_forever()
