import http.client
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import App


class AccountsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / 'test.sqlite3'
        self.app = App(('127.0.0.1', 0), self.db_path)
        self.thread = threading.Thread(target=self.app.serve_forever, daemon=True)
        self.thread.start()
        self.cookie = ''

    def tearDown(self):
        self.app.shutdown()
        self.app.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method='GET', data=None, cookie=None, origin=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.app.server_port)
        headers = {'Content-Type': 'application/json', 'X-Podhod': '1', 'Origin': origin or self.app.origin, 'Cookie': self.cookie if cookie is None else cookie}
        conn.request(method, path, json.dumps(data) if data is not None else None, headers)
        response = conn.getresponse()
        status, body, session = response.status, json.loads(response.read()), response.getheader('Set-Cookie')
        conn.close()
        return status, body, session

    def register(self, login='athlete'):
        status, data, cookie = self.request('/api/register', 'POST', {'login': login, 'password': 'a-good-password'})
        self.assertEqual(status, 200, data)
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        self.cookie = cookie.split(';')[0]
        return self.cookie

    def workout(self):
        return {'2026-11-02': {'name': 'День ног', 'notes': '', 'completed': True, 'exercises': [{'muscle': 'Ноги', 'exercise': 'Жим ногами', 'sets': 3, 'reps': 10, 'weight': 40}]}}

    def test_accounts_isolation_conflicts_logout_and_persistence(self):
        self.assertEqual(self.request('/api/workouts')[0], 401)
        first_cookie = self.register()
        self.assertEqual(self.request('/api/workouts', 'PUT', {'workouts': self.workout(), 'revision': 0})[0], 200)
        self.assertEqual(self.request('/api/workouts', 'PUT', {'workouts': {}, 'revision': 0})[0], 409)
        self.assertEqual(self.request('/api/workouts')[1]['workouts'], self.workout())
        self.cookie = ''
        self.register('another')
        self.assertEqual(self.request('/api/workouts')[1]['workouts'], {})
        self.assertEqual(self.request('/api/logout', 'POST', {})[0], 200)
        self.assertEqual(self.request('/api/workouts')[0], 401)
        self.assertEqual(self.request('/api/login', 'POST', {'login': 'athlete', 'password': 'wrong-password'})[0], 401)
        status, _, cookie = self.request('/api/login', 'POST', {'login': 'ATHLETE', 'password': 'a-good-password'})
        self.assertEqual(status, 200)
        self.cookie = cookie.split(';')[0]
        self.assertEqual(self.request('/api/workouts')[1]['workouts'], self.workout())
        with sqlite3.connect(self.db_path) as db:
            digest = db.execute('SELECT password FROM users LIMIT 1').fetchone()[0]
            self.assertNotEqual(digest, 'a-good-password')
        # Old session remains a valid independent session for the same account.
        self.assertEqual(self.request('/api/workouts', cookie=first_cookie)[0], 200)

    def test_validation_csrf_and_private_files(self):
        self.assertEqual(self.request('/api/register', 'POST', {'login': 'aa', 'password': 'short'})[0], 400)
        self.assertEqual(self.request('/api/register', 'POST', {}, origin='https://evil.example')[0], 403)
        self.register()
        self.assertEqual(self.request('/api/register', 'POST', {'login': 'athlete', 'password': 'another-password'})[0], 409)
        invalid = self.workout()
        invalid['2026-11-02']['exercises'][0]['sets'] = -1
        self.assertEqual(self.request('/api/workouts', 'PUT', {'workouts': invalid, 'revision': 0})[0], 400)
        self.assertEqual(self.request('/api/workouts')[1]['revision'], 0)
        for path in ['/data/podhod.sqlite3', '/server.py', '/.git/config']:
            self.assertEqual(self.request(path)[0], 404)
        for _ in range(20):
            response = self.request('/api/login', 'POST', {'login': 'missing', 'password': 'wrong-password'})
        self.assertEqual(response[0], 429)


if __name__ == '__main__':
    unittest.main()
