"""The hub: accounts, friends, blocks, groups, presence, tile rooms, counts, chat and the position relay
for the players of a node (docs/multiplayer.md, "The hub"). Mounted by server.py at /api/hub/* through
handle(); standard library only, SQLite at data/hub.sqlite (git-ignored).

POST /api/hub/signup   {name, password}            -> {you, recovery: [six codes, shown once]} + cookie
POST /api/hub/signin   {name, password}            -> {you} + cookie
POST /api/hub/signout                              -> {ok}, the session row deleted, the cookie cleared
POST /api/hub/recover  {name, code, password}      -> {you, left} + cookie (the code spent, every other
                                                      session of the user ended, the new password set)
GET  /api/hub/me                                   -> {you} or 401
GET  /api/hub/config                               -> {hub, providers: ['discord', ...]} (keys present only)
GET  /api/hub/oauth/discord                        -> 302 to Discord (scope identify); Discord sends the
                                                      browser back to this same path with ?code&state
GET  /api/hub/ws                                   WebSocket, authenticated by the we_session cookie at
                                                      the upgrade; the protocol is HubConn.on_message

Privacy (the doc's "Privacy"): the tables hold accounts, friendships, blocks, groups and group chat (kept 7
days), nothing that is a position, a tile or a time of play (a session's last_seen is kept to the day).
Presence, rooms, counts, the tile chat, invites and positions are in memory only; a position goes to the
sender's group members in the same room and nowhere else; the connection keeps its last one so that a group
member who enters the room after it is told where the sender is, and it goes with the room or the connection
(lane 4). An invite's point (the picker's planned arrival, tile-local) is relayed the same way and not kept. Nothing a
player sends is printed: the log is the request line (server.py's), and counts. No email address is asked
for. The Discord keys are read from the environment or .env and never printed.

Voice and video (lane 5): the media goes peer to peer (WebRTC), never through the hub. The hub only relays the
signalling, `rtc` {to, tc?, k: 'sdp'|'ice'|'state'|'bye', ...}, from a connection in a room to the addressed group
member's connection in the same room (the rule positions follow), stamped with the sender's user and connection id;
nothing of it is kept or printed. The ICE servers go to each signed-in client in `welcome`: public STUN, and TURN
when TURN_URL (and TURN_USERNAME and TURN_CREDENTIAL, or TURN_SECRET for coturn's time-limited ones) are set.
"""
from __future__ import annotations

import base64
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
import uuid
from collections import deque
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

from pipeline.config import REPO_ROOT, TILES_DIR
from ws import WsConn, ws_frame, ws_upgrade

DATA_DIR = REPO_ROOT / "data"
ENV_PATH = REPO_ROOT / ".env"
SCHEMA_VERSION = 1
MAX_BODY = 16_000                       # a hub request is a name and a password: small
NAME_RE = re.compile(r"^[A-Za-z0-9_.]{3,24}$")
PASS_MIN, PASS_MAX = 8, 256
DISPLAY_MAX, GROUP_NAME_MAX, CHAT_MAX = 32, 40, 500
GROUP_MAX = 16
TILE_RE = re.compile(r"^utm\d{1,2}[ns]_\d{1,4}_\d{1,5}$")
FORM_RE = re.compile(r"^[a-z0-9_]{1,48}$")
SESSION_DAYS = 30
DAY = 86400
MESSAGE_DAYS = 7
WELCOME_MESSAGES = 50
SEASONS = ("spring", "summer", "fall", "winter")
DATE_RE = re.compile(r"^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$")   # a day of the year, MM-DD (the client's ?date=)
INVITE_S = 90                           # the client's dialog lasts a minute; a late answer still lands
COUNTS_S, PING_S, IDLE_S, PRUNE_S = 2.0, 20.0, 60.0, 3600.0
FAIL_WINDOW_S = 15 * 60                 # sign-in and recovery failures counted over this window
FAIL_PER_NAME, FAIL_PER_ADDR = 8, 30
SIGNUP_WINDOW_S, SIGNUP_PER_ADDR = 3600, 20
SEARCH_RATE, SEARCH_BURST, SEARCH_MAX = 1.0, 5.0, 20
PBKDF2_ITER = 600_000                   # where hashlib has no scrypt (LibreSSL builds of Python)
SCRYPT = (2 ** 14, 8, 1)
CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # no 0/o, 1/l/i
DISCORD_AUTH = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN = "https://discord.com/api/oauth2/token"
DISCORD_ME = "https://discord.com/api/users/@me"
SEASONS_N = ("winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer",
             "fall", "fall", "fall", "winter")   # by month, meteorological; the south is six months on

SCHEMA = """
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_fold TEXT NOT NULL UNIQUE,
    display TEXT NOT NULL, pass_hash TEXT, pass_salt TEXT, created_at INTEGER NOT NULL,
    findable INTEGER NOT NULL DEFAULT 1, presence TEXT NOT NULL DEFAULT 'tile');
CREATE TABLE identities (user_id TEXT NOT NULL, provider TEXT NOT NULL, subject TEXT NOT NULL,
    UNIQUE (provider, subject));
CREATE TABLE recovery (user_id TEXT NOT NULL, code_hash TEXT NOT NULL, used_at INTEGER);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE friends (a TEXT NOT NULL, b TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (a, b));
CREATE TABLE blocks (user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, PRIMARY KEY (user_id, blocked_id));
CREATE TABLE "groups" (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL);
CREATE TABLE members (group_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id));
CREATE TABLE messages (id INTEGER PRIMARY KEY, group_id TEXT NOT NULL, user_id TEXT NOT NULL,
    text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX recovery_user ON recovery (user_id);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX friends_b ON friends (b);
CREATE INDEX members_user ON members (user_id);
CREATE INDEX messages_group ON messages (group_id, at);
"""
TABLES = ("users", "identities", "recovery", "sessions", "friends", "blocks", "groups", "members", "messages")


class HubError(Exception):
    """An answer naming the field (never the value): HTTP status, message, field."""

    def __init__(self, code: int, msg: str, field: str | None = None):
        super().__init__(msg)
        self.code, self.msg, self.field = code, msg, field


def env_key(name: str) -> str | None:
    """A key from the environment or the git-ignored .env, as tools/meshy_generate.py reads MESHY_API_KEY.
    Never printed."""
    k = os.environ.get(name, "").strip()
    if k:
        return k
    if ENV_PATH.is_file():
        with open(ENV_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                if key.startswith("export "):
                    key = key[7:].strip()
                if key == name:
                    val = val.strip().strip('"').strip("'")
                    if val:
                        return val
    return None


def _season_date(m: dict, auto: bool = False) -> tuple:
    """A message's season ('spring' .. 'winter', or 'auto' when allowed) and date ('MM-DD' or None), checked: a bad one is
    an error naming the field; an absent one is (None, None)."""
    season, date = m.get("season"), m.get("date")
    if season is None and date is None:
        return None, None
    if season not in SEASONS and not (auto and season == "auto"):
        raise HubError(400, "season must be spring, summer, fall or winter", "season")
    if date is not None and (season == "auto" or not isinstance(date, str) or not DATE_RE.match(date)):
        raise HubError(400, "date must be MM-DD", "date")
    return season, date


def season_now(tile: str) -> str:
    """The season at the tile by the calendar: meteorological, the southern hemisphere six months on."""
    m = datetime.now(timezone.utc).month - 1
    south = re.match(r"^utm\d{1,2}s_", tile) is not None
    return SEASONS_N[(m + 6) % 12 if south else m]


BODY_MAX, BODY_C_MAX = 32, 8      # pos: the body's sample and constants (m_pos)
RTC_KINDS = ("sdp", "ice", "state", "bye")
SDP_TYPES = ("offer", "answer", "pranswer", "rollback")
SDP_MAX, ICE_MAX = 48_000, 1_024        # an SDP and a candidate, in characters (a socket message over 64 KB closes it)
RTC_RATE, RTC_BURST = 40.0, 120.0       # rtc's own bucket: a mesh's candidates come in bursts
STUN_DEFAULT = ("stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478")
TURN_TTL_S = 12 * 3600                  # coturn's time-limited credentials (TURN_SECRET): good for this long
ID_RE = re.compile(r"^[0-9a-f-]{36}$")


def ice_servers() -> list:
    """The ICE servers for a signed-in client's peer connections: public STUN, and TURN when the environment or .env
    has it: TURN_URL (comma-separated turn:/turns: URLs) with TURN_USERNAME and TURN_CREDENTIAL (a provider's static
    pair, as metered.ca gives), or with TURN_SECRET (coturn's static-auth-secret: a credential good for TURN_TTL_S,
    made here per welcome, the REST API's rule). Read on each welcome; never printed."""
    out = [{"urls": list(STUN_DEFAULT)}]
    urls = [u.strip() for u in (env_key("TURN_URL") or "").split(",") if u.strip().startswith(("turn:", "turns:"))]
    if not urls:
        return out
    secret = env_key("TURN_SECRET")
    if secret:
        user = f"{int(time.time()) + TURN_TTL_S}:wildearth"
        cred = base64.b64encode(hmac.new(secret.encode(), user.encode(), hashlib.sha1).digest()).decode()
        out.append({"urls": urls, "username": user, "credential": cred})
    else:
        user, cred = env_key("TURN_USERNAME"), env_key("TURN_CREDENTIAL")
        if user and cred:
            out.append({"urls": urls, "username": user, "credential": cred})
    return out


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _coord(v, k: str) -> float:
    """A coordinate (a position's, an invite's point's): a finite number, rounded to the centimetre."""
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > 1e6:
        raise HubError(400, f"{k} must be a number", k)
    return round(float(v), 2)


def tile_built(tile) -> bool:
    return isinstance(tile, str) and TILE_RE.match(tile) is not None and (TILES_DIR / tile / "manifest.json").exists()


# -- passwords and codes
def hash_password(password: str, salt: bytes) -> str:
    """scrypt where hashlib has it; else PBKDF2-HMAC-SHA256. The algorithm and its cost go in the hash."""
    pw = password.encode()
    if hasattr(hashlib, "scrypt"):
        n, r, p = SCRYPT
        return f"scrypt:{n}:{r}:{p}:" + hashlib.scrypt(pw, salt=salt, n=n, r=r, p=p, dklen=32).hex()
    return f"pbkdf2_sha256:{PBKDF2_ITER}:" + hashlib.pbkdf2_hmac("sha256", pw, salt, PBKDF2_ITER).hex()


def check_password(password: str, salt: bytes, stored: str) -> bool:
    parts = stored.split(":")
    pw = password.encode()
    if parts[0] == "scrypt" and len(parts) == 5 and hasattr(hashlib, "scrypt"):
        n, r, p = (int(x) for x in parts[1:4])
        got = hashlib.scrypt(pw, salt=salt, n=n, r=r, p=p, dklen=32).hex()
    elif parts[0] == "pbkdf2_sha256" and len(parts) == 3:
        got = hashlib.pbkdf2_hmac("sha256", pw, salt, int(parts[1])).hex()
    else:
        return False
    return hmac.compare_digest(got, parts[-1])


def preferred(stored: str) -> bool:
    return stored.startswith("scrypt:" if hasattr(hashlib, "scrypt") else f"pbkdf2_sha256:{PBKDF2_ITER}:")


def new_code() -> str:
    """A recovery code: 16 characters (80 bits) in four groups, so its hash needs no salt."""
    c = "".join(secrets.choice(CODE_ALPHABET) for _ in range(16))
    return "-".join(c[i:i + 4] for i in range(0, 16, 4))


def code_hash(code: str) -> str:
    return hashlib.sha256(re.sub(r"[\s-]", "", code.lower()).encode()).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _name(v, field: str = "name") -> str:
    if not isinstance(v, str) or not NAME_RE.match(v):
        raise HubError(400, f"{field} must be 3 to 24 letters, digits, _ or .", field)
    return v


def _password(v, field: str = "password") -> str:
    if not isinstance(v, str) or not (PASS_MIN <= len(v) <= PASS_MAX):
        raise HubError(400, f"{field} must be {PASS_MIN} to {PASS_MAX} characters", field)
    return v


def _clean_text(v, limit: int) -> str | None:
    if not isinstance(v, str):
        return None
    v = re.sub(r"[\x00-\x1f\x7f]", " ", v).strip()
    return v[:limit] if v else None


class Limiter:
    """Events per key over a sliding window, in memory only (the key may be an address: never written)."""

    def __init__(self, window: float, limit: int):
        self.window, self.limit, self.hits = window, limit, {}

    def full(self, key) -> bool:
        q = self.hits.get(key)
        if not q:
            return False
        cut = time.monotonic() - self.window
        while q and q[0] < cut:
            q.popleft()
        if not q:
            del self.hits[key]
        return bool(q) and len(q) >= self.limit

    def hit(self, key) -> None:
        self.hits.setdefault(key, deque()).append(time.monotonic())


class Hub:
    def __init__(self, data_dir):
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = data_dir / "hub.sqlite"
        self.lock = threading.RLock()      # the database and the memory below
        self.db = sqlite3.connect(str(self.path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA secure_delete = ON")   # a deleted chat line or session is overwritten
        if self.db.execute("PRAGMA user_version").fetchone()[0] == 0:
            with self.db:
                self.db.executescript(SCHEMA)
                self.db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        self.blocks = {(r[0], r[1]) for r in self.db.execute("SELECT user_id, blocked_id FROM blocks")}
        # memory only: who is connected (presence is per user), the last presence told, invites
        self.conns: dict[str, set] = {}
        self.told: dict[str, dict] = {}
        self.invites: dict[str, dict] = {}
        self.search_tok: dict[str, list] = {}
        self.fail_name = Limiter(FAIL_WINDOW_S, FAIL_PER_NAME)
        self.fail_addr = Limiter(FAIL_WINDOW_S, FAIL_PER_ADDR)
        self.signups = Limiter(SIGNUP_WINDOW_S, SIGNUP_PER_ADDR)
        self.oauth_states: dict[str, float] = {}
        self.last_counts: dict = {}
        self.stopped = False
        self.prune()
        threading.Thread(target=self._ticker, daemon=True).start()

    # -- the database
    def q(self, sql: str, args=()) -> list:
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def q1(self, sql: str, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchone()

    def w(self, sql: str, args=()) -> None:
        with self.lock, self.db:
            self.db.execute(sql, args)

    def prune(self) -> None:
        now = int(time.time())
        with self.lock, self.db:
            self.db.execute("DELETE FROM messages WHERE at < ?", (now - MESSAGE_DAYS * DAY,))
            self.db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))

    def user(self, uid: str):
        return self.q1("SELECT * FROM users WHERE id = ?", (uid,))

    @staticmethod
    def pub(row) -> dict:
        return {"id": row["id"], "name": row["name"], "display": row["display"]}

    def you(self, uid: str) -> dict:
        r = self.user(uid)
        return {**self.pub(r), "findable": bool(r["findable"]), "presence": r["presence"],
                "password": r["pass_hash"] is not None,
                "providers": [x[0] for x in self.q("SELECT provider FROM identities WHERE user_id = ?", (uid,))]}

    def blocked(self, a: str, b: str) -> bool:
        """Either blocked the other."""
        return (a, b) in self.blocks or (b, a) in self.blocks

    # -- accounts
    def create_user(self, name: str, display: str, password: str | None) -> str:
        uid = str(uuid.uuid4())
        salt = secrets.token_bytes(16)
        ph = hash_password(password, salt) if password is not None else None
        self.w("INSERT INTO users (id, name, name_fold, display, pass_hash, pass_salt, created_at) "
               "VALUES (?, ?, ?, ?, ?, ?, ?)",
               (uid, name, name.casefold(), display, ph, salt.hex() if ph else None, int(time.time())))
        return uid

    def new_session(self, uid: str) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        day = now - now % DAY
        self.w("INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)",
               (token_hash(token), uid, now, day, now + SESSION_DAYS * DAY))
        return token

    def session(self, token: str | None) -> tuple[str | None, bool]:
        """The session's user, and whether it slid (the cookie should be sent again). last_seen is kept to
        the day, so the table is no log of play."""
        if not token or len(token) > 200:
            return None, False
        th, now = token_hash(token), int(time.time())
        with self.lock:
            r = self.q1("SELECT user_id, last_seen, expires_at FROM sessions WHERE token_hash = ?", (th,))
            if not r or r["expires_at"] < now:
                return None, False
            day = now - now % DAY
            if r["last_seen"] < day:
                self.w("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?",
                       (day, now + SESSION_DAYS * DAY, th))
                return r["user_id"], True
            return r["user_id"], False

    def signup(self, data: dict, addr: str) -> tuple[dict, str]:
        name, password = _name(data.get("name")), _password(data.get("password"))
        with self.lock:
            if self.signups.full(addr):
                raise HubError(429, "too many new accounts from here; try later")
            if self.q1("SELECT 1 FROM users WHERE name_fold = ?", (name.casefold(),)):
                raise HubError(409, "name is taken", "name")
        uid = self.create_user(name, name, password)    # the hash is slow: outside the lock
        codes = [new_code() for _ in range(6)]
        with self.lock, self.db:
            self.db.executemany("INSERT INTO recovery (user_id, code_hash) VALUES (?, ?)",
                                [(uid, code_hash(c)) for c in codes])
            self.signups.hit(addr)
        print(f"[hub] signup ({self.count_users()} accounts)", flush=True)
        return {"you": self.you(uid), "recovery": codes}, self.new_session(uid)

    def count_users(self) -> int:
        return self.q1("SELECT COUNT(*) FROM users")[0]

    def _limited(self, fold: str, addr: str) -> None:
        if self.fail_name.full(fold) or self.fail_addr.full(addr):
            raise HubError(429, "too many attempts; try later")

    def _failed(self, fold: str, addr: str) -> None:
        self.fail_name.hit(fold)
        self.fail_addr.hit(addr)

    def signin(self, data: dict, addr: str) -> tuple[dict, str]:
        name, password = data.get("name"), data.get("password")
        if not isinstance(name, str) or not name:
            raise HubError(400, "name is required", "name")
        if not isinstance(password, str) or not password:
            raise HubError(400, "password is required", "password")
        fold = name.casefold()[:64]
        with self.lock:
            self._limited(fold, addr)
            r = self.q1("SELECT id, pass_hash, pass_salt FROM users WHERE name_fold = ?", (fold,))
        if r and r["pass_hash"]:
            ok = len(password) <= PASS_MAX and check_password(password, bytes.fromhex(r["pass_salt"]), r["pass_hash"])
        else:
            hash_password("not a password", b"\0" * 16)   # the same time for a name that does not exist
            ok = False
        if not ok:
            with self.lock:
                self._failed(fold, addr)
            raise HubError(401, "name or password is wrong", "password")
        if not preferred(r["pass_hash"]):                  # moved to a host with scrypt: rehash
            salt = secrets.token_bytes(16)
            self.w("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?",
                   (hash_password(password, salt), salt.hex(), r["id"]))
        return {"you": self.you(r["id"])}, self.new_session(r["id"])

    def recover(self, data: dict, addr: str) -> tuple[dict, str]:
        name, code = data.get("name"), data.get("code")
        if not isinstance(name, str) or not name:
            raise HubError(400, "name is required", "name")
        if not isinstance(code, str) or not code or len(code) > 64:
            raise HubError(400, "code is required", "code")
        password = _password(data.get("password"))
        fold = name.casefold()[:64]
        with self.lock:
            self._limited(fold, addr)
            r = self.q1("SELECT id FROM users WHERE name_fold = ?", (fold,))
            row = r and self.q1("SELECT rowid FROM recovery WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
                                (r["id"], code_hash(code)))
            if not row:
                self._failed(fold, addr)
                raise HubError(401, "name or code is wrong", "code")
            uid = r["id"]
            self.w("UPDATE recovery SET used_at = ? WHERE rowid = ?", (int(time.time()), row[0]))
        salt = secrets.token_bytes(16)
        ph = hash_password(password, salt)
        with self.lock:
            with self.db:
                self.db.execute("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?", (ph, salt.hex(), uid))
                self.db.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
            for c in list(self.conns.get(uid, ())):   # whoever held the old password is signed out
                c.kill()
            left = self.q1("SELECT COUNT(*) FROM recovery WHERE user_id = ? AND used_at IS NULL", (uid,))[0]
        return {"you": self.you(uid), "left": left}, self.new_session(uid)

    def signout(self, token: str | None) -> None:
        if not token:
            return
        th = token_hash(token)
        with self.lock:
            self.w("DELETE FROM sessions WHERE token_hash = ?", (th,))
            for cs in list(self.conns.values()):
                for c in list(cs):
                    if c.th == th:
                        c.kill()

    # -- Discord (authorization code, scope identify)
    def providers(self) -> list:
        out = []
        if env_key("DISCORD_CLIENT_ID") and env_key("DISCORD_CLIENT_SECRET"):
            out.append("discord")
        if env_key("GOOGLE_CLIENT_ID") and env_key("GOOGLE_CLIENT_SECRET"):
            out.append("google")     # listed when its keys exist; the flow is not built yet
        return out

    def oauth_state(self) -> str:
        s = secrets.token_urlsafe(24)
        now = time.monotonic()
        with self.lock:
            self.oauth_states = {k: t for k, t in self.oauth_states.items() if now - t < 600}
            self.oauth_states[s] = now
        return s

    def oauth_take(self, state: str) -> bool:
        with self.lock:
            t = self.oauth_states.pop(state, None)
        return t is not None and time.monotonic() - t < 600

    def discord_profile(self, code: str, redirect: str) -> dict:
        """Exchange the code and read the user: {id, username, global_name}. The token is used once and
        dropped; the keys go to Discord only."""
        body = urlencode({"grant_type": "authorization_code", "code": code, "redirect_uri": redirect,
                          "client_id": env_key("DISCORD_CLIENT_ID"),
                          "client_secret": env_key("DISCORD_CLIENT_SECRET")}).encode()
        req = Request(DISCORD_TOKEN, data=body, headers={"Content-Type": "application/x-www-form-urlencoded",
                                                         "User-Agent": "wild-earth-hub"})
        with urlopen(req, timeout=10) as f:
            tok = json.loads(f.read())
        req = Request(DISCORD_ME, headers={"Authorization": f"Bearer {tok['access_token']}",
                                           "User-Agent": "wild-earth-hub"})
        with urlopen(req, timeout=10) as f:
            return json.loads(f.read())

    def discord_user(self, prof: dict, signed_in: str | None) -> str:
        """The user for a Discord account: the one it is linked to, else the signed-in user (linked now),
        else a new user named after the Discord username. Only the Discord id is kept."""
        subject = str(prof["id"])
        with self.lock:
            r = self.q1("SELECT user_id FROM identities WHERE provider = 'discord' AND subject = ?", (subject,))
            if r:
                return r["user_id"]
            uid = signed_in
            if not uid:
                base = re.sub(r"[^a-z0-9_.]", "", str(prof.get("username", "")).lower())[:20]
                base = base if len(base) >= 3 else (base + "___")[:3]
                name, n = base, 1
                while self.q1("SELECT 1 FROM users WHERE name_fold = ?", (name,)):
                    n += 1
                    name = f"{base}{n}"
                display = _clean_text(prof.get("global_name") or prof.get("username"), DISPLAY_MAX) or name
                uid = self.create_user(name, display, None)
            self.w("INSERT INTO identities (user_id, provider, subject) VALUES (?, 'discord', ?)", (uid, subject))
            return uid

    # -- presence
    def audience(self, uid: str) -> set:
        """Who is told this user's presence: accepted friends and group co-members, without blocks."""
        out = {r[0] for r in self.q("SELECT b FROM friends WHERE a = ? AND state = 'accepted' UNION "
                                    "SELECT a FROM friends WHERE b = ? AND state = 'accepted'", (uid, uid))}
        out |= self.comembers(uid)
        return {u for u in out if u != uid and not self.blocked(uid, u)}

    def comembers(self, uid: str, group: str | None = None) -> set:
        if group:
            return {r[0] for r in self.q("SELECT user_id FROM members WHERE group_id = ?", (group,))} - {uid}
        return {r[0] for r in self.q("SELECT m2.user_id FROM members m1 JOIN members m2 ON m1.group_id = m2.group_id "
                                     "WHERE m1.user_id = ? AND m2.user_id != ?", (uid, uid))}

    def presence(self, uid: str) -> dict:
        cs = self.conns.get(uid)
        if not cs:
            return {"t": "presence", "user": uid, "state": "offline"}
        rooms = sorted((c for c in cs if c.room), key=lambda c: c.room_t)
        r = self.user(uid)
        if rooms and r and r["presence"] == "tile":
            return {"t": "presence", "user": uid, "state": "tile", "tile": rooms[-1].room}
        return {"t": "presence", "user": uid, "state": "online"}

    def tell_presence(self, uid: str) -> None:
        p = self.presence(uid)
        if self.told.get(uid) == p:
            return
        self.told[uid] = p
        if p["state"] == "offline":
            self.told.pop(uid, None)
        for u in self.audience(uid):
            self.to_user(u, p)

    def online_for(self, uid: str) -> list:
        return [{k: v for k, v in self.presence(u).items() if k != "t"}
                for u in sorted(self.audience(uid)) if self.conns.get(u)]

    def to_user(self, uid: str, msg: dict) -> None:
        for c in list(self.conns.get(uid, ())):
            c.send(msg)

    # -- lists
    def friends_msg(self, uid: str) -> dict:
        friends, requests = [], []
        for r in self.q("SELECT f.a, f.b, f.state, u.id, u.name, u.display FROM friends f JOIN users u "
                        "ON u.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END WHERE f.a = ? OR f.b = ? ORDER BY u.name_fold",
                        (uid, uid, uid)):
            if r["state"] == "accepted":
                friends.append(self.pub(r))
            else:
                requests.append({**self.pub(r), "dir": "out" if r["a"] == uid else "in"})
        return {"t": "friends", "friends": friends, "requests": requests}

    def groups_list(self, uid: str, messages: bool = False) -> list:
        out = []
        for g in self.q('SELECT g.* FROM "groups" g JOIN members m ON m.group_id = g.id WHERE m.user_id = ? '
                        "ORDER BY g.created_at", (uid,)):
            mem = [self.pub(r) for r in self.q("SELECT u.id, u.name, u.display FROM members m JOIN users u "
                                               "ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.joined_at, m.rowid",
                                               (g["id"],))]
            item = {"id": g["id"], "name": g["name"], "created_by": g["created_by"], "members": mem}
            if messages:
                rows = self.q("SELECT m.user_id, m.text, m.at FROM messages m WHERE m.group_id = ? "
                              "ORDER BY m.at DESC, m.id DESC LIMIT ?", (g["id"], WELCOME_MESSAGES))
                item["messages"] = [{"from": r["user_id"], "text": r["text"], "at": r["at"]} for r in reversed(rows)
                                    if not self.blocked(uid, r["user_id"])]
            out.append(item)
        return out

    def tell_groups(self, uids) -> None:
        for u in set(uids):
            if self.conns.get(u):
                self.to_user(u, {"t": "groups", "groups": self.groups_list(u)})

    def counts(self) -> dict:
        rooms: dict[str, set] = {}
        for uid, cs in self.conns.items():
            for c in cs:
                if c.room:
                    rooms.setdefault(c.room, set()).add(uid)
        return {t: len(us) for t, us in sorted(rooms.items())}

    # -- connections
    def connect(self, c) -> None:
        with self.lock:
            self.conns.setdefault(c.uid, set()).add(c)
            self.tell_presence(c.uid)
            self.log_online()

    def disconnect(self, c) -> None:
        with self.lock:
            if self.stopped:
                return
            cs = self.conns.get(c.uid)
            if cs is None or c not in cs:
                return
            cs.discard(c)
            if not cs:
                del self.conns[c.uid]
            c.rtc_bye()
            c.room, c.watch = None, False
            self.tell_presence(c.uid)
            self.log_online()

    def log_online(self) -> None:
        n = sum(len(cs) for cs in self.conns.values())
        print(f"[hub] {len(self.conns)} user(s) online, {n} connection(s), {len(self.counts())} room(s)", flush=True)

    def _ticker(self) -> None:
        count_t = ping_t = prune_t = 0.0
        last = time.monotonic()
        while not self.stopped:
            time.sleep(0.5)
            now = time.monotonic()
            dt, last = now - last, now
            count_t, ping_t, prune_t = count_t + dt, ping_t + dt, prune_t + dt
            try:
                with self.lock:
                    conns = [c for cs in self.conns.values() for c in cs]
                    if count_t >= COUNTS_S:
                        count_t = 0.0
                        counts = self.counts()
                        if counts != self.last_counts:
                            self.last_counts = counts
                            for c in conns:
                                if c.watch:
                                    c.send({"t": "counts", "tiles": counts})
                    if ping_t >= PING_S:
                        ping_t = 0.0
                        for c in conns:
                            if now - c.last_rx > IDLE_S:
                                c.kill()
                            else:
                                c.raw(ws_frame(b"", 9))
                        wall = time.time()
                        self.invites = {k: v for k, v in self.invites.items() if wall - v["at"] < INVITE_S}
                if prune_t >= PRUNE_S:
                    prune_t = 0.0
                    self.prune()
            except Exception as e:  # noqa: BLE001  (keep ticking; never print a message's contents)
                print(f"[hub] tick failed: {type(e).__name__}", flush=True)

    def stop(self) -> None:
        self.stopped = True
        with self.lock:
            for cs in list(self.conns.values()):
                for c in list(cs):
                    c.kill()
            self.db.close()


class HubConn(WsConn):
    """One signed-in client on /api/hub/ws. Messages {t, ...} as docs/multiplayer.md's "Protocol"."""

    TAG = "hub"
    RATE, BURST = 20.0, 40.0

    def __init__(self, sock, rfile, hub: Hub, uid: str | None, th: str | None):
        self.hub, self.uid, self.th = hub, uid, th
        self.room, self.room_t, self.watch = None, 0.0, False
        self.last_pos = None                   # the last position relayed, memory only (gone with the room or the connection)
        self.cid = secrets.token_hex(4)        # the connection's id in rtc (a user may have two tabs), memory only
        self.rtc_tokens, self.rtc_t = RTC_BURST, time.monotonic()
        super().__init__(sock, rfile)

    def err(self, why: str, re_: str | None = None, field: str | None = None) -> None:
        m = {"t": "err", "why": why}
        if re_:
            m["re"] = re_
        if field:
            m["field"] = field
        self.send(m)

    def on_close(self) -> None:
        if self.uid:
            self.hub.disconnect(self)

    def on_message(self, m: dict) -> None:
        if not self.uid:
            return
        t = m.get("t")
        if not (self.rtc_allow() if t == "rtc" else self.allow()):
            return self.err("too many messages", t)
        fn = getattr(self, "m_" + t, None) if isinstance(t, str) and t.isalpha() else None
        if not fn:
            return self.err("unknown message", t if isinstance(t, str) else None)
        with self.hub.lock:
            if not self.hub.user(self.uid):        # the account is gone
                self.kill()
                return
            try:
                fn(m)
            except HubError as e:
                self.err(e.msg, t, e.field)

    # -- messages in
    def m_hello(self, m: dict) -> None:
        h = self.hub
        f = h.friends_msg(self.uid)
        self.send({"t": "welcome", "you": h.you(self.uid), "friends": f["friends"], "requests": f["requests"],
                   "groups": h.groups_list(self.uid, messages=True), "online": h.online_for(self.uid),
                   "providers": h.providers(), "ice": ice_servers()})

    def m_me(self, m: dict) -> None:
        """Added to the doc's protocol: {display?, findable?, presence?: 'tile'|'online'} -> me {you}."""
        h, sets = self.hub, []
        if "display" in m:
            d = _clean_text(m["display"], DISPLAY_MAX)
            if not d:
                raise HubError(400, "display must be 1 to 32 characters", "display")
            sets.append(("display", d))
        if "findable" in m:
            sets.append(("findable", 1 if m["findable"] else 0))
        if "presence" in m:
            if m["presence"] not in ("tile", "online"):
                raise HubError(400, "presence must be tile or online", "presence")
            sets.append(("presence", m["presence"]))
        for k, v in sets:
            h.w(f"UPDATE users SET {k} = ? WHERE id = ?", (v, self.uid))
        you = h.you(self.uid)
        h.to_user(self.uid, {"t": "me", "you": you})
        h.tell_presence(self.uid)
        if any(k == "display" for k, _ in sets):
            for u in h.audience(self.uid):
                h.to_user(u, h.friends_msg(u))
            h.tell_groups(h.comembers(self.uid))

    def m_search(self, m: dict) -> None:
        h = self.hub
        q = m.get("q")
        if not isinstance(q, str) or not (3 <= len(q.strip()) <= 24):
            raise HubError(400, "q must be 3 to 24 characters", "q")
        now = time.monotonic()
        tok = h.search_tok.setdefault(self.uid, [SEARCH_BURST, now])
        tok[0] = min(SEARCH_BURST, tok[0] + (now - tok[1]) * SEARCH_RATE)
        tok[1] = now
        if tok[0] < 1:
            raise HubError(429, "too many searches")
        tok[0] -= 1
        fold = q.strip().casefold()
        like = re.sub(r"([\\%_])", r"\\\1", fold) + "%"
        rows = h.q("SELECT id, name, display FROM users WHERE name_fold LIKE ? ESCAPE '\\' AND findable = 1 "
                   "AND id != ? AND id NOT IN (SELECT user_id FROM blocks WHERE blocked_id = ?) "
                   "ORDER BY name_fold LIMIT ?", (like, self.uid, self.uid, SEARCH_MAX))
        self.send({"t": "found", "q": q, "users": [h.pub(r) for r in rows]})

    def m_friend(self, m: dict) -> None:
        h, me = self.hub, self.uid
        op, other = m.get("op"), m.get("user")
        if op not in ("request", "accept", "remove", "block", "unblock"):
            raise HubError(400, "op must be request, accept, remove, block or unblock", "op")
        if not isinstance(other, str) or other == me or not h.user(other):
            raise HubError(404, "no such user", "user")
        row = h.q1("SELECT a, b, state FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", (me, other, other, me))
        now = int(time.time())
        before = h.audience(me)
        if op == "request":
            if h.blocked(me, other):
                raise HubError(403, "cannot friend that user", "user")
            if not row:
                h.w("INSERT INTO friends (a, b, state, at) VALUES (?, ?, 'requested', ?)", (me, other, now))
            elif row["state"] == "requested" and row["a"] == other:      # they asked first: this accepts
                h.w("UPDATE friends SET state = 'accepted', at = ? WHERE a = ? AND b = ?", (now, other, me))
        elif op == "accept":
            if not (row and row["state"] == "requested" and row["a"] == other):
                raise HubError(404, "no request from that user", "user")
            h.w("UPDATE friends SET state = 'accepted', at = ? WHERE a = ? AND b = ?", (now, other, me))
        elif op == "remove":
            h.w("DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", (me, other, other, me))
        elif op == "block":
            with h.db:
                h.db.execute("INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)", (me, other))
                h.db.execute("DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", (me, other, other, me))
            h.blocks.add((me, other))
        else:
            h.w("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?", (me, other))
            h.blocks.discard((me, other))
        h.to_user(me, h.friends_msg(me))
        h.to_user(other, h.friends_msg(other))
        self._presence_changes(me, before)

    def _presence_changes(self, uid: str, before: set) -> None:
        """After a change in who sees whom: tell the new audience where uid is, and uid where they are;
        those who no longer see uid hear offline."""
        h = self.hub
        after = h.audience(uid)
        p = h.presence(uid)
        for u in after - before:
            if h.conns.get(uid):
                h.to_user(u, p)
            if h.conns.get(u):
                h.to_user(uid, h.presence(u))
        for u in before - after:
            h.to_user(u, {"t": "presence", "user": uid, "state": "offline"})
            h.to_user(uid, {"t": "presence", "user": u, "state": "offline"})

    def _group(self, gid) -> sqlite3.Row:
        h = self.hub
        g = isinstance(gid, str) and h.q1('SELECT * FROM "groups" WHERE id = ?', (gid,))
        if not g or not h.q1("SELECT 1 FROM members WHERE group_id = ? AND user_id = ?", (gid, self.uid)):
            raise HubError(404, "no such group", "group")
        return g

    def _addable(self, other) -> str:
        h, me = self.hub, self.uid
        if not isinstance(other, str) or not h.user(other):
            raise HubError(404, "no such user", "users")
        if h.blocked(me, other) or not h.q1("SELECT 1 FROM friends WHERE state = 'accepted' AND "
                                            "((a = ? AND b = ?) OR (a = ? AND b = ?))", (me, other, other, me)):
            raise HubError(403, "a group is made from friends", "users")
        return other

    def m_group(self, m: dict) -> None:
        h, me, op = self.hub, self.uid, m.get("op")
        now = int(time.time())
        if op == "create":
            name = _clean_text(m.get("name"), GROUP_NAME_MAX) or ""
            users = m.get("users") or []
            if not isinstance(users, list) or len(set(users) - {me}) + 1 > GROUP_MAX:
                raise HubError(400, f"users must be a list (a group holds {GROUP_MAX})", "users")
            users = [self._addable(u) for u in dict.fromkeys(users) if u != me]
            gid = str(uuid.uuid4())
            befores = {u: h.audience(u) for u in users + [me]}
            with h.db:
                h.db.execute('INSERT INTO "groups" (id, name, created_by, created_at) VALUES (?, ?, ?, ?)',
                             (gid, name, me, now))
                h.db.executemany("INSERT INTO members (group_id, user_id, joined_at) VALUES (?, ?, ?)",
                                 [(gid, u, now) for u in [me] + users])
            touched = [me] + users
        elif op in ("add", "remove", "leave", "name"):
            g = self._group(m.get("group"))
            gid = g["id"]
            members = [r[0] for r in h.q("SELECT user_id FROM members WHERE group_id = ? ORDER BY joined_at, rowid", (gid,))]
            touched = list(members)
            befores = {u: h.audience(u) for u in members}
            if op == "add":
                other = self._addable(m.get("user"))
                if other not in members:
                    if len(members) >= GROUP_MAX:
                        raise HubError(400, f"a group holds {GROUP_MAX}", "user")
                    befores[other] = h.audience(other)
                    h.w("INSERT INTO members (group_id, user_id, joined_at) VALUES (?, ?, ?)", (gid, other, now))
                    touched.append(other)
            elif op == "remove":
                other = m.get("user")
                if g["created_by"] != me:
                    raise HubError(403, "only the group's creator removes", "group")
                if other not in members or other == me:
                    raise HubError(404, "not a member", "user")
                h.w("DELETE FROM members WHERE group_id = ? AND user_id = ?", (gid, other))
            elif op == "leave":
                rest = [u for u in members if u != me]
                with h.db:
                    h.db.execute("DELETE FROM members WHERE group_id = ? AND user_id = ?", (gid, me))
                    if not rest:
                        h.db.execute('DELETE FROM "groups" WHERE id = ?', (gid,))
                        h.db.execute("DELETE FROM messages WHERE group_id = ?", (gid,))
                    elif g["created_by"] == me:     # the longest-standing member carries on
                        h.db.execute('UPDATE "groups" SET created_by = ? WHERE id = ?', (rest[0], gid))
            else:
                h.w('UPDATE "groups" SET name = ? WHERE id = ?', (_clean_text(m.get("name"), GROUP_NAME_MAX) or "", gid))
        else:
            raise HubError(400, "op must be create, add, remove, leave or name", "op")
        h.tell_groups(touched)
        for u, before in befores.items():
            self._presence_changes(u, before)

    def m_chat(self, m: dict) -> None:
        h, me = self.hub, self.uid
        text = _clean_text(m.get("text"), 10 ** 6)
        if not text or len(text) > CHAT_MAX:
            raise HubError(400, f"text must be 1 to {CHAT_MAX} characters", "text")
        scope, now = m.get("scope"), int(time.time())
        if scope == "group":
            gid = m.get("group")
            if gid is None:
                gs = [r[0] for r in h.q("SELECT group_id FROM members WHERE user_id = ?", (me,))]
                if len(gs) != 1:
                    raise HubError(400, "group is required (in no group, or in several)", "group")
                gid = gs[0]
            self._group(gid)
            h.w("INSERT INTO messages (group_id, user_id, text, at) VALUES (?, ?, ?, ?)", (gid, me, text, now))
            msg = {"t": "chat", "scope": "group", "group": gid, "from": me, "text": text, "at": now}
            for u in h.comembers(me, gid) | {me}:
                if not h.blocked(me, u):
                    h.to_user(u, msg)
        elif scope == "tile":
            if not self.room:
                raise HubError(400, "not in a tile's room", "scope")
            msg = {"t": "chat", "scope": "tile", "from": me, "name": h.user(me)["display"], "text": text, "at": now}
            for u, cs in h.conns.items():
                if not h.blocked(me, u):
                    for c in list(cs):
                        if c.room == self.room:
                            c.send(msg)
        else:
            raise HubError(400, "scope must be group or tile", "scope")

    def m_place(self, m: dict) -> None:
        """{tile, group?, to?, point?, follow?, season?, date?}: the invite goes to a group's members, to named people
        (`to`: friends or fellow group members, the home screen's Invite), or both; with neither, to the sender's one
        group. follow: the sender pressed Start and is going in now (group follow): the invite says so and goes only to
        those online, since a joiner enters behind the sender at once; `placed` counts only them. season and date: the
        world the sender goes into when it is not the calendar's (the group's season, set by `season`), relayed so a
        joiner enters the same one; otherwise the invite's season is the tile's by the calendar."""
        h, me = self.hub, self.uid
        tile = m.get("tile")
        if not tile_built(tile):
            raise HubError(404, "no such tile", "tile")
        gid, users = m.get("group"), m.get("to")
        to: set = set()
        if users is not None:
            if not isinstance(users, list) or not 1 <= len(users) <= GROUP_MAX:
                raise HubError(400, f"to must be a list of 1 to {GROUP_MAX} users", "to")
            mates = h.comembers(me)
            for u in dict.fromkeys(users):
                if not isinstance(u, str) or u == me or not h.user(u):
                    raise HubError(404, "no such user", "to")
                if h.blocked(me, u) or not (u in mates or h.q1(
                        "SELECT 1 FROM friends WHERE state = 'accepted' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))",
                        (me, u, u, me))):
                    raise HubError(403, "invite friends or group members", "to")
                to.add(u)
        if gid is not None or users is None:
            if gid is None:
                gs = [r[0] for r in h.q("SELECT group_id FROM members WHERE user_id = ?", (me,))]
                if len(gs) != 1:
                    raise HubError(400, "group is required (in no group, or in several)", "group")
                gid = gs[0]
            self._group(gid)
            to |= {u for u in h.comembers(me, gid) if not h.blocked(me, u)}
        follow = m.get("follow") is True
        if follow:
            to = {u for u in to if h.conns.get(u)}
        iid = secrets.token_hex(8)
        season, date = _season_date(m)
        season = season or season_now(tile)
        h.invites[iid] = {"from": me, "to": to, "at": time.time()}   # memory only, and no tile kept
        msg = {"t": "invite", "id": iid, "from": me, "tile": tile, "season": season}
        if gid is not None:
            msg["group"] = gid
        if follow:
            msg["follow"] = True
        if date:
            msg["date"] = date
        point = m.get("point")   # the picker's planned arrival, tile-local {x, north}: relayed to the joiners, never kept
        if isinstance(point, dict):
            msg["point"] = {k: _coord(point.get(k), k) for k in ("x", "north")}
        for u in to:
            h.to_user(u, msg)
        self.send({"t": "placed", "id": iid, "tile": tile, "season": season, "to": len(to),
                   **({"point": msg["point"]} if "point" in msg else {}), **({"follow": True} if follow else {})})

    def m_season(self, m: dict) -> None:
        """{season, date?}: the sender changed the season (group season, docs/multiplayer.md): relayed to every member of
        the sender's groups who is online, wherever they are: those in the sender's tile go to that season with them, the
        rest carry it into their next Start. season 'auto' is the calendar's again (date then absent). Never kept."""
        h, me = self.hub, self.uid
        season, date = _season_date(m, auto=True)
        if not season:
            raise HubError(400, "season must be spring, summer, fall, winter or auto", "season")
        out = {"t": "season", "from": me, "season": season, **({"date": date} if date else {})}
        if self.room:
            out["tile"] = self.room
        n = 0
        for u in h.comembers(me):
            if not h.blocked(me, u) and h.conns.get(u):
                h.to_user(u, out)
                n += 1
        self.send({"t": "seasoned", "season": season, "to": n})

    def m_answer(self, m: dict) -> None:
        h, me = self.hub, self.uid
        inv = h.invites.get(m.get("invite")) if isinstance(m.get("invite"), str) else None
        if not inv or me not in inv["to"]:
            raise HubError(404, "no such invite", "invite")
        inv["to"].discard(me)
        h.to_user(inv["from"], {"t": "answer", "invite": m["invite"], "from": me, "join": bool(m.get("join"))})

    def m_room(self, m: dict) -> None:
        h = self.hub
        op = m.get("op")
        if op == "join":
            if not tile_built(m.get("tile")):
                raise HubError(404, "no such tile", "tile")
            if self.room != m["tile"]:
                self.rtc_bye()
                self.last_pos = None
            self.room, self.room_t = m["tile"], time.monotonic()
            # where the group members already in this room are (their last relayed positions), so a joiner arriving
            # behind the one who picked the place has it at once (lane 4)
            for u in h.comembers(self.uid):
                if h.blocked(self.uid, u):
                    continue
                for c in list(h.conns.get(u, ())):
                    if c.room == self.room and c.last_pos:
                        self.send(c.last_pos)
        elif op == "leave":
            self.rtc_bye()
            self.room, self.last_pos = None, None
        else:
            raise HubError(400, "op must be join or leave", "op")
        h.tell_presence(self.uid)

    def m_pos(self, m: dict) -> None:
        """Relayed to the sender's group members in the same room, and to no one else. Never kept."""
        h, me = self.hub, self.uid
        if not self.room:
            return
        out = {"t": "pos", "user": me}
        for k in ("x", "y", "z", "yaw"):
            out[k] = _coord(m.get(k), k)
        form = m.get("form")
        out["form"] = form if isinstance(form, str) and FORM_RE.match(form) else "spirit"
        # the body's pose for the members who draw it (docs/multiplayer.md "Players as their animals"): b, the animal
        # stream's fields (client/src/animalNet.js FIELDS), and c, the body's few constants (size, sex, antlers); numbers
        # only, relayed as they come, never kept past the connection
        if out["form"] != "spirit":
            for k, n in (("b", BODY_MAX), ("c", BODY_C_MAX)):
                v = m.get(k)
                if isinstance(v, list) and len(v) <= n and all(_num(x) and abs(x) <= 1e6 for x in v):
                    out[k] = [round(float(x), 3) for x in v]
        self.last_pos = out
        for u in h.comembers(me):
            if h.blocked(me, u):
                continue
            for c in list(h.conns.get(u, ())):
                if c.room == self.room:
                    c.send(out)

    # -- voice and video: the signalling relay (lane 5)
    def rtc_allow(self) -> bool:
        now = time.monotonic()
        self.rtc_tokens = min(RTC_BURST, self.rtc_tokens + (now - self.rtc_t) * RTC_RATE)
        self.rtc_t = now
        if self.rtc_tokens < 1:
            return False
        self.rtc_tokens -= 1
        return True

    def rtc_peers(self, to: str, tc=None) -> list:
        """The connections an rtc from this one may reach: the user `to`'s, in this connection's room, when `to` shares a
        group with the sender and neither blocks the other. With tc, only that connection; without, the one that
        entered the room last (one tab answers, not two)."""
        h, me = self.hub, self.uid
        if not self.room or to == me or to not in h.comembers(me) or h.blocked(me, to):
            return []
        cs = [c for c in h.conns.get(to, ()) if c.room == self.room]
        if tc is not None:
            return [c for c in cs if c.cid == tc]
        return sorted(cs, key=lambda c: c.room_t)[-1:]

    def rtc_bye(self) -> None:
        """Leaving the room (or the connection closing): the group members in it are told, so their peers close now."""
        if not self.room:
            return
        h, me = self.hub, self.uid
        for u in h.comembers(me):
            if h.blocked(me, u):
                continue
            for c in list(h.conns.get(u, ())):
                if c.room == self.room:
                    c.send({"t": "rtc", "from": me, "fc": self.cid, "k": "bye"})

    def m_rtc(self, m: dict) -> None:
        """WebRTC signalling, relayed as positions are: to the addressed group member's connection in the same room and
        to no one else; out of a room, or to anyone else, it goes nowhere (quietly: a peer may just have left). Never kept
        or printed. {to, tc?, k, sdp?: {type, sdp}, ice?: {candidate, sdpMid, sdpMLineIndex} | null, mic?, cam?}"""
        to, tc, k = m.get("to"), m.get("tc"), m.get("k")
        if not isinstance(to, str) or not ID_RE.match(to):
            raise HubError(400, "to must be a user id", "to")
        if tc is not None and not (isinstance(tc, str) and re.match(r"^[0-9a-f]{8}$", tc)):
            raise HubError(400, "tc must be a connection id", "tc")
        if k not in RTC_KINDS:
            raise HubError(400, "k must be sdp, ice, state or bye", "k")
        out = {"t": "rtc", "from": self.uid, "fc": self.cid, "k": k}
        if k == "sdp":
            d = m.get("sdp")
            if not (isinstance(d, dict) and d.get("type") in SDP_TYPES and isinstance(d.get("sdp", ""), str)
                    and len(d.get("sdp", "")) <= SDP_MAX):
                raise HubError(400, "sdp must be {type, sdp}", "sdp")
            out["sdp"] = {"type": d["type"], "sdp": d.get("sdp", "")}
        elif k == "ice":
            c = m.get("ice")            # null: the end of the candidates
            if c is not None:
                if not isinstance(c, dict):
                    raise HubError(400, "ice must be a candidate", "ice")
                cand, mid, idx = c.get("candidate"), c.get("sdpMid"), c.get("sdpMLineIndex")
                if not (isinstance(cand, str) and len(cand) <= ICE_MAX
                        and (mid is None or (isinstance(mid, str) and len(mid) <= 64))
                        and (idx is None or (type(idx) is int and 0 <= idx < 64))):
                    raise HubError(400, "ice must be a candidate", "ice")
                c = {"candidate": cand, "sdpMid": mid, "sdpMLineIndex": idx}
            out["ice"] = c
        elif k == "state":
            out["mic"], out["cam"] = bool(m.get("mic")), bool(m.get("cam"))
        for c in self.rtc_peers(to, tc):
            c.send(out)

    def m_watch(self, m: dict) -> None:
        self.watch = bool(m.get("on"))
        if self.watch:
            self.send({"t": "counts", "tiles": self.hub.counts()})


# -- the hub's HTTP side, mounted from server.py's Handler
HUB: list = []
HUB_LOCK = threading.Lock()


def get() -> Hub:
    with HUB_LOCK:
        if not HUB:
            HUB.append(Hub(DATA_DIR))
        return HUB[0]


def configure(data_dir=None, env_path=None) -> None:
    """Point the hub at another data folder (and .env), dropping the running one: for tests."""
    global DATA_DIR, ENV_PATH
    with HUB_LOCK:
        if HUB:
            HUB.pop().stop()
        if data_dir is not None:
            DATA_DIR = data_dir
        if env_path is not None:
            ENV_PATH = env_path


def _cookie(h, name: str) -> str | None:
    raw = h.headers.get("Cookie")
    if not raw:
        return None
    try:
        c = SimpleCookie()
        c.load(raw)
    except Exception:  # noqa: BLE001
        return None
    return c[name].value if name in c else None


def _secure(h) -> str:
    return "; Secure" if (h.headers.get("X-Forwarded-Proto") or "").lower() == "https" else ""


def session_cookie(h, token: str | None) -> str:
    if token is None:
        return f"we_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{_secure(h)}"
    return f"we_session={token}; Path=/; Max-Age={SESSION_DAYS * DAY}; HttpOnly; SameSite=Lax{_secure(h)}"


def _send(h, data, code: int = 200, cookies=()) -> None:
    body = json.dumps(data).encode()
    h.send_response(code)
    h.send_header("Content-Type", "application/json")
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    for c in cookies:
        h.send_header("Set-Cookie", c)
    h.end_headers()
    h.wfile.write(body)


def _redirect(h, to: str, cookies=()) -> None:
    h.send_response(302)
    h.send_header("Location", to)
    h.send_header("Content-Length", "0")
    h.send_header("Cache-Control", "no-store")
    for c in cookies:
        h.send_header("Set-Cookie", c)
    h.end_headers()


def _same_origin(h) -> bool:
    """A browser's request from another site (Origin set and not this host) is refused: it would carry the
    cookie to the socket, or sign a visitor in to someone else's account."""
    o = h.headers.get("Origin")
    return not o or urlsplit(o).netloc == (h.headers.get("Host") or "")


def _origin(h) -> str:
    o = env_key("HUB_ORIGIN")
    if o:
        return o.rstrip("/")
    scheme = "https" if _secure(h) else "http"
    return f"{scheme}://{h.headers.get('Host') or 'localhost'}"


def _body(h) -> dict:
    n = int(h.headers.get("Content-Length") or 0)
    if n > MAX_BODY:
        raise HubError(413, "body too large")
    try:
        data = json.loads(h.rfile.read(n) or b"{}")
    except ValueError:
        raise HubError(400, "body must be JSON") from None
    if not isinstance(data, dict):
        raise HubError(400, "body must be a JSON object")
    return data


def handle(h, method: str, path: str, query: str = "") -> bool:
    """Answer a request under /api/hub/. False when the path is not the hub's (the caller goes on)."""
    if not (path == "/api/hub" or path.startswith("/api/hub/")):
        return False
    hub = get()
    token = _cookie(h, "we_session")
    try:
        if not _same_origin(h):
            raise HubError(403, "cross-origin request")
        if method == "GET" and path == "/api/hub/config":
            return _send(h, {"hub": env_key("HUB_NAME") or "Wild Earth", "providers": hub.providers()}) or True
        if method == "GET" and path == "/api/hub/me":
            uid, slid = hub.session(token)
            if not uid:
                raise HubError(401, "not signed in")
            with hub.lock:
                you = hub.you(uid)
            return _send(h, {"you": you}, cookies=[session_cookie(h, token)] if slid else ()) or True
        if method == "GET" and path == "/api/hub/ws":
            return hub_ws(h, hub, token) or True
        if method == "GET" and path == "/api/hub/oauth/discord":
            return oauth_discord(h, hub, token, query) or True
        if method == "POST" and path in ("/api/hub/signup", "/api/hub/signin", "/api/hub/recover"):
            data, addr = _body(h), h.client_address[0]
            fn = {"signup": hub.signup, "signin": hub.signin, "recover": hub.recover}[path.rsplit("/", 1)[1]]
            out, tok = fn(data, addr)
            return _send(h, out, cookies=[session_cookie(h, tok)]) or True
        if method == "POST" and path == "/api/hub/signout":
            hub.signout(token)
            return _send(h, {"ok": True}, cookies=[session_cookie(h, None)]) or True
        raise HubError(404, "not found")
    except HubError as e:
        out = {"error": e.msg}
        if e.field:
            out["field"] = e.field
        _send(h, out, e.code)
        return True


def hub_ws(h, hub: Hub, token: str | None) -> None:
    uid, slid = hub.session(token)
    if not ws_upgrade(h, [("Set-Cookie", session_cookie(h, token))] if slid else ()):
        return
    c = HubConn(h.connection, h.rfile, hub, uid, token_hash(token) if uid else None)
    if not uid:                       # no session: say so and close
        c.err("not signed in", None, "session")
        c.close()
        try:
            h.connection.settimeout(5)
        except OSError:
            pass
        return c.run()
    hub.connect(c)
    c.run()


def oauth_discord(h, hub: Hub, token: str | None, query: str) -> None:
    if "discord" not in hub.providers():
        raise HubError(404, "not found")
    redirect = _origin(h) + "/api/hub/oauth/discord"
    q = {k: v[0] for k, v in parse_qs(query).items()}
    if "code" not in q and "error" not in q:
        state = hub.oauth_state()
        url = DISCORD_AUTH + "?" + urlencode({"response_type": "code", "client_id": env_key("DISCORD_CLIENT_ID"),
                                              "scope": "identify", "state": state, "redirect_uri": redirect,
                                              "prompt": "none"})
        return _redirect(h, url, [f"we_oauth={state}; Path=/api/hub/oauth; Max-Age=600; HttpOnly; SameSite=Lax"
                                  f"{_secure(h)}"])
    state = q.get("state") or ""
    clear = [f"we_oauth=; Path=/api/hub/oauth; Max-Age=0; HttpOnly; SameSite=Lax{_secure(h)}"]
    if "error" in q or not state or state != _cookie(h, "we_oauth") or not hub.oauth_take(state):
        return _redirect(h, "/client/?signin=failed", clear)
    try:
        prof = hub.discord_profile(q["code"], redirect)
        if not isinstance(prof, dict) or not prof.get("id"):
            raise ValueError("no id")
    except Exception as e:  # noqa: BLE001  (the error's kind only: never the code, the token or a key)
        print(f"[hub] discord exchange failed: {type(e).__name__}", flush=True)
        return _redirect(h, "/client/?signin=failed", clear)
    signed_in, _ = hub.session(token)
    uid = hub.discord_user(prof, signed_in)
    return _redirect(h, "/client/?signin=discord", clear + [session_cookie(h, hub.new_session(uid))])

