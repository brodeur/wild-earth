"""The hub (hub.py) and the shared WebSocket framing (ws.py), against server.py on a free port.

    .venv/bin/python -m unittest tests.test_hub

The server runs in a thread with the hub's data in a temporary folder and a temporary tiles folder holding
only the manifests of the tiles used, so the acorn game's world files land there too. Tests named
test_z* run last and check what the others left behind: the database's tables, and that no tile id, no
position and nothing a player typed reached the database's file (other than group chat) or the log.
"""
from __future__ import annotations

import contextlib
import http.client
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import hub  # noqa: E402
import server  # noqa: E402
from tests.wsclient import WsClient  # noqa: E402

T1, T2 = "utm10n_680_4280", "utm10n_690_4280"
POS = {"x": 4321.125, "y": 287.5, "z": -1234.75, "yaw": 2.375}     # distinctive numbers, searched for at the end
CHAT_GROUP = "the creek is running at the bend"
CHAT_TILE = "anyone near the oaks today"
PASSWORD = "acorns and oaks"
SDP = "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=heron-at-the-ford\r\n"   # searched for at the end
CAND = "candidate:842163049 1 udp 1677729535 198.51.100.77 46154 typ srflx raddr 0.0.0.0 rport 0"
TURN_SECRET = "turn-test-secret-kingfisher"


class Tee(io.TextIOBase):
    """Everything printed (the request log and the hub's counts), kept to be searched at the end."""

    def __init__(self):
        self.buf, self.lock = io.StringIO(), threading.Lock()

    def write(self, s):
        with self.lock:
            return self.buf.write(s)

    def text(self) -> str:
        with self.lock:
            return self.buf.getvalue()


class HubTest(unittest.TestCase):
    names: list = []      # every name signed up, searched for in the log at the end

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="hubtest-"))
        tiles = cls.tmp / "tiles"
        for t in (T1, T2):
            (tiles / t).mkdir(parents=True)
            shutil.copy(ROOT / "tiles" / t / "manifest.json", tiles / t / "manifest.json")
        cls.saved = (server.TILES_DIR, hub.TILES_DIR)
        server.TILES_DIR = hub.TILES_DIR = tiles
        for k in ("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "HUB_ORIGIN",
                  "TURN_URL", "TURN_USERNAME", "TURN_CREDENTIAL", "TURN_SECRET"):
            os.environ.pop(k, None)
        cls.signups_saved, hub.SIGNUP_PER_ADDR = hub.SIGNUP_PER_ADDR, 60   # every test signs up from 127.0.0.1
        hub.configure(cls.tmp / "data", cls.tmp / ".env")
        cls.log = Tee()
        cls.redirect = contextlib.redirect_stdout(cls.log)
        cls.redirect.__enter__()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(server.Handler, directory=str(ROOT)))
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.socks: list = []

    @classmethod
    def tearDownClass(cls):
        for s in cls.socks:
            s.close()
        cls.httpd.shutdown()
        cls.httpd.server_close()
        hub.configure(hub.REPO_ROOT / "data", hub.REPO_ROOT / ".env")
        hub.SIGNUP_PER_ADDR = cls.signups_saved
        server.TILES_DIR, hub.TILES_DIR = cls.saved
        cls.redirect.__exit__(None, None, None)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # -- helpers
    def http(self, method: str, path: str, body=None, cookie: str | None = None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Content-Type": "application/json", **(headers or {})}
        if cookie:
            h["Cookie"] = f"we_session={cookie}"
        c.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
        r = c.getresponse()
        raw = r.read()
        out = json.loads(raw) if raw and r.getheader("Content-Type") == "application/json" else None
        set_cookie = r.getheader("Set-Cookie") or ""
        tok = None
        if set_cookie.startswith("we_session="):
            tok = set_cookie.split(";", 1)[0].split("=", 1)[1]
        c.close()
        return r.status, out, tok, r

    def signup(self, name: str) -> tuple[str, str]:
        st, out, tok, r = self.http("POST", "/api/hub/signup", {"name": name, "password": PASSWORD})
        self.assertEqual(st, 200, out)
        self.names.append(name)
        return out["you"]["id"], tok

    def ws(self, cookie: str | None, hello: bool = True) -> WsClient:
        w = WsClient(self.port, "/api/hub/ws", cookie)
        self.socks.append(w)
        if hello and cookie:
            w.send({"t": "hello"})
            w.welcome = w.wait("welcome")
        return w

    def befriend(self, a, b) -> None:
        """a and b (each (id, token, socket)) become friends: a asks, b accepts."""
        a[2].send({"t": "friend", "op": "request", "user": b[0]})
        b[2].wait("friends", where=lambda m: any(r["id"] == a[0] and r["dir"] == "in" for r in m["requests"]))
        b[2].send({"t": "friend", "op": "accept", "user": a[0]})
        a[2].wait("friends", where=lambda m: any(f["id"] == b[0] for f in m["friends"]))

    def player(self, name: str):
        uid, tok = self.signup(name)
        return uid, tok, self.ws(tok)

    # -- accounts
    def test_signup_signin_and_names(self):
        uid, tok = self.signup("Marten_1")
        self.assertTrue(len(uid) == 36 and tok)
        st, out, _, r = self.http("GET", "/api/hub/me", cookie=tok)
        self.assertEqual((st, out["you"]["name"], out["you"]["display"]), (200, "Marten_1", "Marten_1"))
        for bad in ("ab", "has space", "x" * 25, "dash-name", "émile"):
            st, out, _, _ = self.http("POST", "/api/hub/signup", {"name": bad, "password": PASSWORD})
            self.assertEqual((st, out["field"]), (400, "name"), bad)
            self.assertNotIn(bad, json.dumps(out))       # the error names the field, not the value
        st, out, _, _ = self.http("POST", "/api/hub/signup", {"name": "fisher_cat", "password": "short"})
        self.assertEqual((st, out["field"]), (400, "password"))
        st, out, _, _ = self.http("POST", "/api/hub/signup", {"name": "MARTEN_1", "password": PASSWORD})
        self.assertEqual((st, out["field"]), (409, "name"))           # unique, case folded
        st, out, tok2, r = self.http("POST", "/api/hub/signin", {"name": "marten_1", "password": PASSWORD})
        self.assertEqual((st, out["you"]["id"]), (200, uid))
        cookie = r.getheader("Set-Cookie")
        for part in ("HttpOnly", "SameSite=Lax", "Path=/", f"Max-Age={30 * 86400}"):
            self.assertIn(part, cookie)
        st, out, tok3, _ = self.http("POST", "/api/hub/signin", {"name": "marten_1", "password": PASSWORD + "!"})
        self.assertEqual((st, out["field"], tok3), (401, "password", None))
        st, out, _, _ = self.http("POST", "/api/hub/signin", {"name": "nobody_here", "password": PASSWORD})
        self.assertEqual(st, 401)
        st, _, _, r = self.http("POST", "/api/hub/signout", cookie=tok2)
        self.assertEqual(st, 200)
        self.assertIn("Max-Age=0", r.getheader("Set-Cookie"))
        self.assertEqual(self.http("GET", "/api/hub/me", cookie=tok2)[0], 401)
        self.assertEqual(self.http("GET", "/api/hub/me", cookie=tok)[0], 200)   # the other session stands
        st, out, _, _ = self.http("POST", "/api/hub/signin", {"name": "marten_1", "password": PASSWORD},
                                  headers={"Origin": "http://elsewhere.example"})
        self.assertEqual(st, 403)

    def test_signin_limited(self):
        self.signup("pika_limit")
        for _ in range(hub.FAIL_PER_NAME):
            self.assertEqual(self.http("POST", "/api/hub/signin", {"name": "pika_limit", "password": "wrong pass"})[0], 401)
        st, out, tok, _ = self.http("POST", "/api/hub/signin", {"name": "pika_limit", "password": PASSWORD})
        self.assertEqual((st, tok), (429, None))
        hub.get().fail_name.hits.clear()                 # the window passes
        hub.get().fail_addr.hits.clear()
        self.assertEqual(self.http("POST", "/api/hub/signin", {"name": "pika_limit", "password": PASSWORD})[0], 200)

    def test_recovery(self):
        st, out, tok, _ = self.http("POST", "/api/hub/signup", {"name": "Ringtail", "password": PASSWORD})
        self.names.append("Ringtail")
        codes = out["recovery"]
        self.assertEqual(len(set(codes)), 6)
        old_ws = self.ws(tok)
        st, out, _, _ = self.http("POST", "/api/hub/recover", {"name": "ringtail", "code": "aaaa-bbbb-cccc-dddd",
                                                               "password": "a new password"})
        self.assertEqual((st, out["field"]), (401, "code"))
        st, out, tok2, _ = self.http("POST", "/api/hub/recover", {"name": "ringtail", "code": codes[2].upper(),
                                                                  "password": "a new password"})
        self.assertEqual((st, out["left"]), (200, 5))
        self.assertTrue(old_ws.closed.wait(3))           # the old sessions are ended, their sockets too
        self.assertEqual(self.http("GET", "/api/hub/me", cookie=tok)[0], 401)
        self.assertEqual(self.http("GET", "/api/hub/me", cookie=tok2)[0], 200)
        self.assertEqual(self.http("POST", "/api/hub/signin", {"name": "ringtail", "password": PASSWORD})[0], 401)
        self.assertEqual(self.http("POST", "/api/hub/signin", {"name": "ringtail", "password": "a new password"})[0], 200)
        st, _, _, _ = self.http("POST", "/api/hub/recover", {"name": "ringtail", "code": codes[2],
                                                             "password": "another password"})
        self.assertEqual(st, 401)                         # a code is spent once

    def test_config_and_discord(self):
        st, out, _, _ = self.http("GET", "/api/hub/config")
        self.assertEqual((st, out["providers"]), (200, []))
        self.assertEqual(self.http("GET", "/api/hub/oauth/discord")[0], 404)
        (self.tmp / ".env").write_text("DISCORD_CLIENT_ID=test-client-id\nDISCORD_CLIENT_SECRET=test-secret\n")
        try:
            self.assertEqual(self.http("GET", "/api/hub/config")[1]["providers"], ["discord"])
            st, _, _, r = self.http("GET", "/api/hub/oauth/discord")
            self.assertEqual(st, 302)
            loc = r.getheader("Location")
            self.assertTrue(loc.startswith("https://discord.com/oauth2/authorize?"))
            self.assertIn("scope=identify&", loc)
            self.assertNotIn("email", loc)
            self.assertNotIn("test-secret", loc)
            state = loc.split("state=")[1].split("&")[0]
            oauth_cookie = r.getheader("Set-Cookie").split(";")[0]
            h = hub.get()
            seen = {}

            def fake(code, redirect):
                seen["code"], seen["redirect"] = code, redirect
                return {"id": "80351110224678912", "username": "Wolf.Fan", "global_name": "Wolf Fan"}
            h.discord_profile = fake
            # a forged state (no cookie) is refused
            st, _, tok, r = self.http("GET", f"/api/hub/oauth/discord?code=abc&state={state}")
            self.assertEqual((st, r.getheader("Location"), tok), (302, "/client/?signin=failed", None))
            state = self.http("GET", "/api/hub/oauth/discord")[3].getheader("Location").split("state=")[1].split("&")[0]
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            c.request("GET", f"/api/hub/oauth/discord?code=abc&state={state}", headers={"Cookie": f"we_oauth={state}"})
            r = c.getresponse()
            r.read()
            self.assertEqual((r.status, r.getheader("Location")), (302, "/client/?signin=discord"))
            tok = next(v.split(";")[0].split("=", 1)[1] for k, v in r.getheaders()
                       if k == "Set-Cookie" and v.startswith("we_session="))
            self.assertEqual(seen["redirect"], f"http://127.0.0.1:{self.port}/api/hub/oauth/discord")
            you = self.http("GET", "/api/hub/me", cookie=tok)[1]["you"]
            self.assertEqual((you["name"], you["display"], you["providers"], you["password"]),
                             ("wolf.fan", "Wolf Fan", ["discord"], False))
            self.names.append("wolf.fan")
            del oauth_cookie
        finally:
            (self.tmp / ".env").unlink()
            hub.get().__dict__.pop("discord_profile", None)

    # -- the socket
    def test_ws_needs_a_session(self):
        w = WsClient(self.port, "/api/hub/ws")
        self.assertEqual(w.status, 101)
        m = w.wait("err")
        self.assertEqual(m["field"], "session")
        self.assertTrue(w.closed.wait(3))
        w.close()
        w = WsClient(self.port, "/api/hub/ws", "not-a-session")
        self.assertEqual(w.wait("err")["field"], "session")
        w.close()
        _, tok = self.signup("Cross_site")
        w = WsClient(self.port, "/api/hub/ws", tok, origin="http://elsewhere.example")
        self.assertEqual(w.status, 403)
        w.close()

    def test_friends_blocks_and_search(self):
        a, b, c = self.player("Badger_a"), self.player("Badger_b"), self.player("Coyote_c")
        self.befriend(a, b)
        b[2].wait("friends", where=lambda m: any(f["id"] == a[0] for f in m["friends"]))
        # presence: a friend coming online is told
        a[2].wait("presence", where=lambda m: m["user"] == b[0] and m["state"] == "online")
        b[2].drain()
        a2 = self.ws(a[1])                                    # a second tab: presence is per user
        self.assertEqual({f["id"] for f in a2.welcome["friends"]}, {b[0]})
        self.assertIn(b[0], {o["user"] for o in a2.welcome["online"]})
        b[2].none("presence", where=lambda m: m["user"] == a[0])
        a2.close()
        b[2].none("presence", where=lambda m: m["user"] == a[0] and m["state"] == "offline")
        # search: a prefix of 3 or more, names only
        a[2].send({"t": "search", "q": "ba"})
        self.assertEqual(a[2].wait("err")["field"], "q")
        a[2].send({"t": "search", "q": "badger_"})
        found = a[2].wait("found")["users"]
        self.assertEqual([u["name"] for u in found], ["Badger_b"])
        self.assertEqual(set(found[0]), {"id", "name", "display"})
        # a block: c blocks a; a cannot find or friend c
        a[2].send({"t": "search", "q": "coyote"})
        self.assertEqual([u["id"] for u in a[2].wait("found")["users"]], [c[0]])
        c[2].send({"t": "friend", "op": "block", "user": a[0]})
        self.assertEqual([u["id"] for u in c[2].wait("friends")["blocked"]], [a[0]])   # the blocker's list (Blocked people)
        a[2].send({"t": "search", "q": "coyote"})
        self.assertEqual(a[2].wait("found")["users"], [])
        a[2].send({"t": "friend", "op": "request", "user": c[0]})
        self.assertEqual(a[2].wait("err")["re"], "friend")
        c[2].none("friends")
        # unfindable
        b[2].send({"t": "me", "findable": False})
        self.assertFalse(b[2].wait("me")["you"]["findable"])
        c[2].send({"t": "search", "q": "badger"})
        self.assertEqual([u["name"] for u in c[2].wait("found")["users"]], ["Badger_a"])   # the blocker may still find
        a[2].send({"t": "search", "q": "badger"})
        self.assertEqual(a[2].wait("found")["users"], [])
        # the search rate
        for _ in range(int(hub.SEARCH_BURST) + 1):
            a[2].send({"t": "search", "q": "badger"})
        self.assertEqual(a[2].wait("err", where=lambda m: m["re"] == "search")["why"], "too many searches")
        # "Friends see: nothing" (presence hidden): friends hear offline, and a new tab's welcome leaves the user out
        b[2].send({"t": "me", "presence": "hidden"})
        self.assertEqual(b[2].wait("me")["you"]["presence"], "hidden")
        a[2].wait("presence", where=lambda m: m["user"] == b[0] and m["state"] == "offline")
        a3 = self.ws(a[1])
        self.assertNotIn(b[0], {o["user"] for o in a3.welcome["online"]})
        a3.close()
        b[2].send({"t": "me", "presence": "online"})
        a[2].wait("presence", where=lambda m: m["user"] == b[0] and m["state"] == "online")
        b[2].send({"t": "me", "presence": "elsewhere"})
        self.assertEqual(b[2].wait("err")["field"], "presence")
        # unblock: the list empties
        c[2].send({"t": "friend", "op": "unblock", "user": a[0]})
        self.assertEqual(c[2].wait("friends")["blocked"], [])
        # remove
        b[2].send({"t": "friend", "op": "remove", "user": a[0]})
        a[2].wait("friends", where=lambda m: m["friends"] == [])

    def test_group_chat_and_invite(self):
        a, b, c = self.player("Heron_a"), self.player("Heron_b"), self.player("Egret_c")
        self.befriend(a, b)
        self.befriend(a, c)
        a[2].send({"t": "group", "op": "create", "name": "Creek walkers", "users": [b[0]]})
        g = b[2].wait("groups")["groups"][0]
        self.assertEqual((g["name"], [m["id"] for m in g["members"]]), ("Creek walkers", [a[0], b[0]]))
        a[2].send({"t": "group", "op": "create", "users": [str(__import__("uuid").uuid4())]})
        self.assertEqual(a[2].wait("err")["field"], "users")
        # a chat line reaches the group, and nobody else
        b[2].drain()
        c[2].drain()
        a[2].send({"t": "chat", "scope": "group", "text": CHAT_GROUP})
        m = b[2].wait("chat")
        self.assertEqual((m["scope"], m["group"], m["from"], m["text"]), ("group", g["id"], a[0], CHAT_GROUP))
        self.assertEqual(a[2].wait("chat")["text"], CHAT_GROUP)
        c[2].none("chat")
        a[2].send({"t": "chat", "scope": "group", "text": "x" * 501})
        self.assertEqual(a[2].wait("err")["field"], "text")
        # the welcome carries the group's recent chat
        b2 = self.ws(b[1])
        self.assertEqual(b2.welcome["groups"][0]["messages"][-1]["text"], CHAT_GROUP)
        b2.close()
        # an invite, and its answer to the picker
        a[2].send({"t": "place", "tile": T2})
        inv = b[2].wait("invite")
        self.assertEqual((inv["from"], inv["tile"], inv["group"]), (a[0], T2, g["id"]))
        self.assertIn(inv["season"], ("spring", "summer", "fall", "winter"))
        self.assertEqual(a[2].wait("placed")["to"], 1)
        c[2].none("invite")
        b[2].send({"t": "answer", "invite": inv["id"], "join": True})
        ans = a[2].wait("answer")
        self.assertEqual((ans["invite"], ans["from"], ans["join"]), (inv["id"], b[0], True))
        b[2].send({"t": "answer", "invite": inv["id"], "join": False})   # once each
        self.assertEqual(b[2].wait("err")["field"], "invite")
        c[2].send({"t": "place", "tile": "utm10n_1_1"})
        self.assertEqual(c[2].wait("err")["field"], "tile")
        # membership: add, remove (the creator), leave
        a[2].send({"t": "group", "op": "add", "group": g["id"], "user": c[0]})
        self.assertEqual(len(c[2].wait("groups")["groups"][0]["members"]), 3)
        b[2].send({"t": "group", "op": "remove", "group": g["id"], "user": c[0]})
        self.assertEqual(b[2].wait("err")["field"], "group")
        a[2].send({"t": "group", "op": "remove", "group": g["id"], "user": c[0]})
        self.assertEqual(c[2].wait("groups")["groups"], [])
        a[2].send({"t": "group", "op": "leave", "group": g["id"]})
        self.assertEqual(b[2].wait("groups", where=lambda m: len(m["groups"][0]["members"]) == 1)
                         ["groups"][0]["created_by"], b[0])

    def test_rooms_positions_and_counts(self):
        a, b, c, d = (self.player(n) for n in ("Otter_a", "Otter_b", "Mink_c", "Otter_d"))
        watcher = self.player("Watcher_w")
        self.befriend(a, b)
        self.befriend(a, d)
        a[2].send({"t": "group", "op": "create", "users": [b[0], d[0]]})
        for p in (a, b, d):
            p[2].wait("groups", where=lambda m: len(m["groups"]) == 1 and len(m["groups"][0]["members"]) == 3)
        watcher[2].send({"t": "watch", "on": True})
        self.assertEqual(watcher[2].wait("counts")["tiles"], {})
        for p in (a, b, c):
            p[2].send({"t": "room", "op": "join", "tile": T1})
        d[2].send({"t": "room", "op": "join", "tile": T2})
        a_tab2 = self.ws(a[1])
        a_tab2.send({"t": "room", "op": "join", "tile": T1})       # the same user twice: counted once
        counts = watcher[2].wait("counts", timeout=5, where=lambda m: m["tiles"] == {T1: 3, T2: 1})
        self.assertEqual(counts["tiles"], {T1: 3, T2: 1})
        # presence carries the tile to friends
        b[2].wait("presence", where=lambda m: m["user"] == a[0] and m.get("tile") == T1)
        # a position: to the group member in the same room, not to c (same room, no group) nor d (other room)
        for p in (b, c, d):
            p[2].drain()
        a[2].send({"t": "pos", **POS, "form": "lontra_canadensis"})
        got = b[2].wait("pos")
        self.assertEqual(got, {"t": "pos", "user": a[0], "name": "Otter_a", **{k: round(v, 2) for k, v in POS.items()},
                               "form": "lontra_canadensis"})          # to the centimetre, with the display name
        c[2].none("pos")
        d[2].none("pos")
        a_tab2.none("pos")                                          # not echoed to one's own tabs
        a[2].send({"t": "pos", "x": "far", "y": 0, "z": 0, "yaw": 0})
        self.assertEqual(a[2].wait("err")["field"], "x")
        # a body's pose (players.js): its sample and constants relayed with the position; dropped in spirit form or malformed
        body = [4321.125, 287.5, -1234.75, 2.375, 0, 0, 1.5, 0, 0, 0.8]
        a[2].send({"t": "pos", **POS, "form": "odocoileus_hemionus", "b": body, "c": [1.05, 0, 0, 0, 0.5, 0.5, 0.5]})
        got = b[2].wait("pos")
        self.assertEqual(got["b"], [round(v, 3) for v in body])
        self.assertEqual(got["c"][0], 1.05)
        a[2].send({"t": "pos", **POS, "form": "spirit", "b": body})
        self.assertNotIn("b", b[2].wait("pos"))
        a[2].send({"t": "pos", **POS, "form": "odocoileus_hemionus", "b": ["x"] + body, "c": list(range(20))})
        got = b[2].wait("pos")
        self.assertNotIn("b", got)
        self.assertNotIn("c", got)
        # tile chat: the room only
        c[2].send({"t": "chat", "scope": "tile", "text": CHAT_TILE})
        self.assertEqual(a[2].wait("chat")["text"], CHAT_TILE)
        d[2].none("chat")
        # presence turned down to online only: no tile told
        a[2].send({"t": "me", "presence": "online"})
        b[2].wait("presence", where=lambda m: m["user"] == a[0] and m["state"] == "online" and "tile" not in m)
        # counts change as users leave
        b[2].send({"t": "room", "op": "leave", "tile": T1})
        a_tab2.close()
        d[2].close()
        counts = watcher[2].wait("counts", timeout=5, where=lambda m: m["tiles"] == {T1: 2})
        st, out, _, _ = self.http("GET", "/api/hub/counts")                   # the same counts with no session at all
        self.assertEqual((st, out["tiles"]), (200, {T1: 2}))
        watcher[2].send({"t": "watch", "on": False})
        a[2].close()
        watcher[2].none("counts", wait=2.6)
        self.assertNotIn("pos", json.dumps(hub.get().counts()))

    def test_who_sees_whom(self):
        """docs/multiplayer.md "Who sees whom" (2026-11-06): a spirit's position goes to everyone in its world (the tile's
        room in the same season), a body's only to the group; a stranger's spirit going into a body is `gone` for the
        strangers; leaving the world, or the season changing, is `gone` for those who saw the player; a joiner gets the
        last positions it may see; nothing crosses seasons, tiles or blocks; rtc keeps to the group in the same world."""
        a, b, c, d, e = (self.player(n) for n in ("Plover_a", "Plover_b", "Stoat_c", "Marten_d", "Pika_e"))
        self.befriend(a, b)
        a[2].send({"t": "group", "op": "create", "users": [b[0]]})
        for p in (a, b):
            p[2].wait("groups", where=lambda m: len(m["groups"]) == 1 and len(m["groups"][0]["members"]) == 2)
        for p in (a, b, c):
            p[2].send({"t": "room", "op": "join", "tile": T1, "season": "fall"})
        d[2].send({"t": "room", "op": "join", "tile": T1, "season": "winter"})   # the same tile, another world
        e[2].send({"t": "room", "op": "join", "tile": T2, "season": "fall"})
        a[2].send({"t": "room", "op": "join", "tile": T1, "season": "monsoon"})
        self.assertEqual(a[2].wait("err")["field"], "season")
        time.sleep(0.2)
        spirit = {"t": "pos", **POS, "form": "spirit"}
        deer = {"t": "pos", **POS, "form": "odocoileus_hemionus", "b": [4321.125, 287.5, -1234.75, 2.375], "c": [1.0]}
        # a stranger's spirit: seen by everyone in its world, in any form, group or not
        c[2].send(spirit)
        for p in (a, b):
            got = p[2].wait("pos", where=lambda m: m["user"] == c[0])
            self.assertEqual((got["form"], got["name"]), ("spirit", "Stoat_c"))   # a stranger's name for the label
        d[2].none("pos", where=lambda m: m["user"] == c[0])          # another season
        e[2].none("pos", where=lambda m: m["user"] == c[0])          # another tile
        # the stranger goes into a body: hidden from the strangers, told once
        c[2].send(deer)
        for p in (a, b):
            p[2].wait("gone", where=lambda m: m["user"] == c[0])
            p[2].none("pos", where=lambda m: m["user"] == c[0])
        c[2].send(deer)
        a[2].none("gone")
        # a group member in a body: the group sees it with its pose, the stranger does not
        a[2].send(deer)
        got = b[2].wait("pos", where=lambda m: m["user"] == a[0])
        self.assertEqual((got["form"], got["b"][0]), ("odocoileus_hemionus", 4321.125))
        c[2].none("pos", where=lambda m: m["user"] == a[0])
        c[2].none("gone")                                           # never seen as a spirit: nothing to take back
        # out of the body: a spirit again, seen by the stranger (no pose with it)
        a[2].send({**spirit, "b": [1, 2, 3]})
        got = c[2].wait("pos", where=lambda m: m["user"] == a[0])
        self.assertEqual(got["form"], "spirit")
        self.assertNotIn("b", got)
        b[2].wait("pos", where=lambda m: m["user"] == a[0] and m["form"] == "spirit")
        # a joiner gets the last positions it may see: a's spirit, not c's body
        f = self.player("Shrew_f")
        f[2].send({"t": "room", "op": "join", "tile": T1, "season": "fall"})
        got = f[2].wait("pos")
        self.assertEqual((got["user"], got["form"]), (a[0], "spirit"))
        f[2].none("pos", where=lambda m: m["user"] == c[0])
        # a block, either way: nothing between them
        f[2].send({"t": "friend", "op": "block", "user": a[0]})
        f[2].wait("friends")
        time.sleep(0.1)
        a[2].send(spirit)
        c[2].wait("pos", where=lambda m: m["user"] == a[0])
        f[2].none("pos", where=lambda m: m["user"] == a[0])
        # the season changed in place: out of the fall world (those who saw a are told), into the winter one
        d[2].send(spirit)
        for p in (b, c):
            p[2].drain()
        a[2].send({"t": "room", "op": "join", "tile": T1, "season": "winter"})
        got = a[2].wait("pos", where=lambda m: m["user"] == d[0])   # the winter world's spirit, on entering it
        for p in (b, c):
            p[2].wait("gone", where=lambda m: m["user"] == a[0])
        a[2].send(spirit)
        d[2].wait("pos", where=lambda m: m["user"] == a[0])
        b[2].none("pos", where=lambda m: m["user"] == a[0])          # the group, but another world
        c[2].none("pos", where=lambda m: m["user"] == a[0])
        a[2].send({"t": "rtc", "to": b[0], "k": "state", "mic": True})
        b[2].none("rtc")                                            # voice keeps to the world too
        # leaving the room, or the connection closing: gone for those who saw them
        d[2].send({"t": "room", "op": "leave"})
        a[2].wait("gone", where=lambda m: m["user"] == d[0])
        a[2].send({"t": "room", "op": "join", "tile": T1, "season": "fall"})
        a[2].send(spirit)
        for p in (b, c):
            p[2].wait("pos", where=lambda m: m["user"] == a[0])
        a[2].close()
        for p in (b, c):
            p[2].wait("gone", where=lambda m: m["user"] == a[0])
        # an older client's join, with no season: the tile's by the calendar
        e[2].send({"t": "room", "op": "join", "tile": T1})
        time.sleep(0.2)
        conn = next(iter(hub.get().conns[e[0]]))
        self.assertEqual(conn.season, hub.season_now(T1))
        for p in (b, c, d, e, f):
            p[2].close()

    def test_travel_together(self):
        """Lane 4: place with a group and the picker's point; the invite carries both; the picker's last position
        reaches a member who enters the room after it, and nobody else; it goes with the room."""
        a, b, c = (self.player(n) for n in ("Fox_a", "Fox_b", "Fox_c"))
        self.befriend(a, b)
        self.befriend(a, c)
        a[2].send({"t": "group", "op": "create", "name": "Fox walk", "users": [b[0]]})
        g1 = b[2].wait("groups")["groups"][0]
        a[2].send({"t": "group", "op": "create", "users": [c[0]]})
        c[2].wait("groups")
        a[2].wait("groups", where=lambda m: len(m["groups"]) == 2)
        a[2].send({"t": "place", "tile": T2})                       # in two groups: the group is required
        self.assertEqual(a[2].wait("err")["field"], "group")
        point = {"x": POS["x"], "north": POS["z"]}
        a[2].send({"t": "place", "tile": T2, "group": g1["id"], "point": point})
        inv = b[2].wait("invite")
        self.assertEqual((inv["from"], inv["tile"], inv["group"], inv["point"]),
                         (a[0], T2, g1["id"], {"x": round(POS["x"], 2), "north": round(POS["z"], 2)}))
        self.assertEqual(a[2].wait("placed")["point"], inv["point"])
        c[2].none("invite")
        a[2].send({"t": "place", "tile": T2, "group": g1["id"], "point": {"x": "here", "north": 1}})
        self.assertEqual(a[2].wait("err")["field"], "x")
        # the picker enters and moves; the member joins, answers, and enters the room: the picker's last position at once
        a[2].send({"t": "room", "op": "join", "tile": T2})
        a[2].send({"t": "pos", **POS, "form": "spirit"})
        b[2].send({"t": "answer", "invite": inv["id"], "join": True})
        self.assertTrue(a[2].wait("answer")["join"])
        b[2].drain()
        b[2].send({"t": "room", "op": "join", "tile": T2})
        got = b[2].wait("pos", timeout=2)
        self.assertEqual(got, {"t": "pos", "user": a[0], "name": "Fox_a", **{k: round(v, 2) for k, v in POS.items()}, "form": "spirit"})
        b[2].none("pos")                                            # once, not again until the picker moves
        c[2].send({"t": "room", "op": "join", "tile": T2})           # c shares a group with a, so c has it too...
        c[2].wait("pos", timeout=2)
        c[2].send({"t": "room", "op": "leave"})
        c[2].drain()
        b[2].send({"t": "room", "op": "join", "tile": T1})           # ...but not in another room
        b[2].none("pos")
        a[2].send({"t": "room", "op": "leave"})                     # leaving the room lets the position go
        a[2].send({"t": "room", "op": "join", "tile": T2})
        c[2].send({"t": "room", "op": "join", "tile": T2})
        c[2].none("pos")
        self.assertIsNone(hub.get().invites.get(inv["id"], {}).get("point"))   # the invite's record holds no point
        for p in (a, b, c):
            p[2].close()

    def test_follow_invite(self):
        """Group follow: a member presses Start and `place` carries follow; the invite says follow and goes only to
        the group's members who are online; `placed` counts them; a Decline reaches the sender; a joiner entering the
        room has the sender's last position at once, to stand behind them."""
        a, b, c = (self.player(n) for n in ("Wolf_a", "Wolf_b", "Wolf_c"))
        self.befriend(a, b)
        self.befriend(a, c)
        a[2].send({"t": "group", "op": "create", "name": "Pack", "users": [b[0], c[0]]})
        g = b[2].wait("groups")["groups"][0]
        c[2].wait("groups")
        a[2].drain()
        c[2].close()                                                # c is offline
        time.sleep(0.3)
        point = {"x": POS["x"], "north": -POS["z"]}
        a[2].send({"t": "place", "tile": T2, "group": g["id"], "point": point, "follow": True})
        inv = b[2].wait("invite")
        self.assertEqual((inv["from"], inv["tile"], inv["group"], inv.get("follow")), (a[0], T2, g["id"], True))
        placed = a[2].wait("placed")
        self.assertEqual((placed["to"], placed.get("follow")), (1, True))   # b alone: c is offline
        self.assertNotIn("follow", self.hub_invite(inv["id"]))
        # a plain place still asks every member, online or not, and carries no follow
        a[2].send({"t": "place", "tile": T2, "group": g["id"]})
        self.assertNotIn("follow", b[2].wait("invite"))
        self.assertEqual(a[2].wait("placed")["to"], 2)
        # Decline: the sender is told
        b[2].send({"t": "answer", "invite": inv["id"], "join": False})
        ans = a[2].wait("answer")
        self.assertEqual((ans["from"], ans["join"]), (b[0], False))
        # a second follow invite, joined: the sender is in the room; the joiner's room join brings the sender's pose
        a[2].send({"t": "room", "op": "join", "tile": T2})
        a[2].send({"t": "pos", **POS, "form": "odocoileus_hemionus"})
        a[2].send({"t": "place", "tile": T2, "group": g["id"], "follow": True})
        inv2 = b[2].wait("invite", where=lambda m: m.get("follow"))
        b[2].send({"t": "answer", "invite": inv2["id"], "join": True})
        self.assertTrue(a[2].wait("answer")["join"])
        b[2].drain()
        b[2].send({"t": "room", "op": "join", "tile": T2})
        got = b[2].wait("pos", timeout=2)
        self.assertEqual((got["user"], got["form"], got["yaw"]), (a[0], "odocoileus_hemionus", round(POS["yaw"], 2)))
        for p in (a, b):
            p[2].close()

    def test_group_season(self):
        """Group season: `season` goes to every online member of the sender's groups wherever they are (with the
        sender's tile when in one), to no one else, and is checked; a follow invite carries the sender's season and day."""
        a, b, c, d = (self.player(n) for n in ("Lynx_a", "Lynx_b", "Lynx_c", "Lynx_d"))
        self.befriend(a, b)
        self.befriend(a, c)
        self.befriend(a, d)                                         # d is a friend, not in the group
        a[2].send({"t": "group", "op": "create", "name": "Lynxes", "users": [b[0], c[0]]})
        g = b[2].wait("groups")["groups"][0]
        c[2].wait("groups")
        a[2].drain()
        a[2].send({"t": "room", "op": "join", "tile": T2})
        b[2].send({"t": "room", "op": "join", "tile": T2})          # b in a's tile, c on the main screen
        for p in (a, b, c, d):
            p[2].drain()
        a[2].send({"t": "season", "season": "winter", "date": "01-15"})
        for p in (b, c):
            got = p[2].wait("season")
            self.assertEqual(got, {"t": "season", "from": a[0], "season": "winter", "date": "01-15", "tile": T2})
        self.assertEqual(a[2].wait("seasoned")["to"], 2)
        d[2].none("season")
        a[2].send({"t": "season", "season": "auto"})                # back to the calendar's: no date
        self.assertEqual(b[2].wait("season")["season"], "auto")
        self.assertNotIn("date", c[2].wait("season"))
        for bad, field in (({"season": "monsoon"}, "season"), ({"season": "fall", "date": "13-01"}, "date"),
                           ({"season": "auto", "date": "01-01"}, "date"), ({"date": "01-01"}, "season")):
            a[2].send({"t": "season", **bad})
            self.assertEqual(a[2].wait("err")["field"], field, bad)
        b[2].none("season")
        # the follow invite carries the season and day the sender goes into
        a[2].send({"t": "place", "tile": T2, "group": g["id"], "follow": True, "season": "winter", "date": "01-15"})
        inv = b[2].wait("invite")
        self.assertEqual((inv["season"], inv["date"]), ("winter", "01-15"))
        a[2].send({"t": "place", "tile": T2, "group": g["id"], "follow": True, "season": "auto"})
        self.assertEqual(a[2].wait("err")["field"], "season")
        for p in (a, b, c, d):
            p[2].close()

    def test_bodies(self):
        """The home screen's rings: `body` (a tile and a species code, or the body worn there) goes to the online members
        of the sender's groups and to no one else (not a friend outside the group, not a blocked member), is checked,
        held for a member who connects later (welcome's bodies), cleared by {tile: null} or the connection closing, and
        not told while the sender hides their place; nothing else rides on it."""
        a, b, c, d = (self.player(n) for n in ("Elk_a", "Elk_b", "Elk_c", "Elk_d"))
        self.befriend(a, b)
        self.befriend(a, c)
        self.befriend(a, d)                                         # d is a friend, not in the group
        a[2].send({"t": "group", "op": "create", "name": "Elks", "users": [b[0], c[0]]})
        b[2].wait("groups")
        c[2].wait("groups")
        for p in (a, b, c, d):
            p[2].drain()
        a[2].send({"t": "body", "tile": T1, "code": "odocoileus_hemionus", "x": 1.5, "secret": "no"})
        for p in (b, c):
            self.assertEqual(p[2].wait("body"), {"t": "body", "user": a[0], "tile": T1, "code": "odocoileus_hemionus", "here": False})
        d[2].none("body")
        a[2].none("body")                                           # not echoed
        a[2].send({"t": "body", "tile": T1, "code": "odocoileus_hemionus"})
        b[2].none("body")                                           # unchanged: not told again
        # the body worn in that tile's world
        a[2].send({"t": "body", "tile": T1, "code": "spirit", "here": True})
        self.assertEqual(b[2].wait("body")["here"], True)
        c[2].wait("body")
        for bad, field in (({"tile": "utm10n_1_1", "code": "spirit"}, "tile"), ({"tile": T1, "code": "Deer!"}, "code"),
                           ({"tile": T1}, "code"), ({"tile": T1, "code": "x" * 60}, "code")):
            a[2].send({"t": "body", **bad})
            self.assertEqual(a[2].wait("err")["field"], field, bad)
        b[2].none("body")
        # a member connecting later is given it in the welcome
        b2 = self.ws(b[1])
        self.assertEqual(b2.welcome["bodies"], [{"user": a[0], "tile": T1, "code": "spirit", "here": True}])
        self.assertEqual(self.ws(d[1]).welcome["bodies"], [])
        # hidden place: the group is told it is gone, and a later welcome has none
        a[2].send({"t": "me", "presence": "online"})
        self.assertEqual(b[2].wait("body", where=lambda m: m["user"] == a[0]), {"t": "body", "user": a[0], "tile": None})
        self.assertEqual(self.ws(c[1]).welcome["bodies"], [])
        a[2].send({"t": "me", "presence": "tile"})
        self.assertEqual(b[2].wait("body", where=lambda m: m["user"] == a[0])["code"], "spirit")
        # blocked: not told
        c[2].send({"t": "friend", "op": "block", "user": a[0]})
        c[2].drain()
        a[2].send({"t": "body", "tile": T2, "code": "ursus_americanus"})
        self.assertEqual(b[2].wait("body")["tile"], T2)
        c[2].none("body")
        # taken back, and gone with the connection that told it
        a[2].send({"t": "body", "tile": None})
        self.assertEqual(b[2].wait("body")["tile"], None)
        a[2].send({"t": "body", "tile": T1, "code": "canis_latrans"})
        b[2].wait("body")
        a[2].close()
        self.assertEqual(b[2].wait("body", where=lambda m: m["user"] == a[0]), {"t": "body", "user": a[0], "tile": None})
        self.assertNotIn(a[0], hub.get().bodies)
        for p in (b, c, d):
            p[2].close()

    def hub_invite(self, iid: str) -> dict:
        return hub.get().invites.get(iid, {})

    def test_invite_people(self):
        """The home screen's Invite: place with `to` asks friends or fellow group members by name, with or without a
        group, each once; a stranger or a blocked user cannot be asked; the answer reaches the inviter."""
        a, b, c = (self.player(n) for n in ("Hare_a", "Hare_b", "Hare_c"))
        self.befriend(a, b)
        a[2].send({"t": "place", "tile": T1, "to": [b[0]]})
        inv = b[2].wait("invite")
        self.assertEqual((inv["from"], inv["tile"]), (a[0], T1))
        self.assertNotIn("group", inv)
        self.assertEqual(a[2].wait("placed")["to"], 1)
        b[2].send({"t": "answer", "invite": inv["id"], "join": True})
        ans = a[2].wait("answer")
        self.assertEqual((ans["from"], ans["join"]), (b[0], True))
        for bad in ([c[0]], [], ["nobody"], "x"):                 # a stranger, no one, no such user, not a list
            a[2].send({"t": "place", "tile": T1, "to": bad})
            self.assertEqual(a[2].wait("err")["field"], "to")
        c[2].none("invite")
        # a group and a person in it at once: asked once
        a[2].send({"t": "group", "op": "create", "name": "Hares", "users": [b[0]]})
        g = b[2].wait("groups")["groups"][0]
        a[2].drain()
        a[2].send({"t": "place", "tile": T2, "group": g["id"], "to": [b[0]]})
        self.assertEqual(a[2].wait("placed")["to"], 1)
        self.assertEqual(b[2].wait("invite")["group"], g["id"])
        b[2].none("invite")
        # a block ends it
        b[2].send({"t": "friend", "op": "block", "user": a[0]})
        b[2].drain()
        a[2].drain()
        a[2].send({"t": "place", "tile": T1, "to": [b[0]]})
        self.assertEqual(a[2].wait("err")["field"], "to")
        for p in (a, b, c):
            p[2].close()

    def test_rtc_signalling(self):
        """Lane 5: rtc goes to the addressed group member's connection in the same room and nowhere else: not across
        groups, not across tiles, not out of a room; one tab answers; bye on leaving; the ICE servers in welcome."""
        a, b, c, d = (self.player(n) for n in ("Crane_a", "Crane_b", "Ibis_c", "Crane_d"))
        self.befriend(a, b)
        self.befriend(a, d)
        self.befriend(a, c)                                          # a friend, but not in the group
        a[2].send({"t": "group", "op": "create", "users": [b[0], d[0]]})
        for p in (a, b, d):
            p[2].wait("groups", where=lambda m: len(m["groups"]) == 1 and len(m["groups"][0]["members"]) == 3)
        self.assertEqual(a[2].welcome["ice"], [{"urls": list(hub.STUN_DEFAULT)}])   # STUN only by default
        offer = {"t": "rtc", "to": b[0], "k": "sdp", "sdp": {"type": "offer", "sdp": SDP}}
        a[2].send(offer)                                             # out of a room: nowhere
        b[2].none("rtc")
        for p in (a, b, c):
            p[2].send({"t": "room", "op": "join", "tile": T1})
        d[2].send({"t": "room", "op": "join", "tile": T2})
        time.sleep(0.2)
        a[2].send(offer)
        got = b[2].wait("rtc")
        self.assertEqual((got["from"], got["k"], got["sdp"]), (a[0], "sdp", {"type": "offer", "sdp": SDP}))
        fa = got["fc"]
        self.assertRegex(fa, r"^[0-9a-f]{8}$")
        # the answer to that connection; a candidate; the media state
        b[2].send({"t": "rtc", "to": a[0], "tc": fa, "k": "sdp", "sdp": {"type": "answer", "sdp": SDP}})
        ans = a[2].wait("rtc")
        self.assertEqual((ans["from"], ans["sdp"]["type"]), (b[0], "answer"))
        fb = ans["fc"]
        ice = {"candidate": CAND, "sdpMid": "0", "sdpMLineIndex": 0}
        b[2].send({"t": "rtc", "to": a[0], "tc": fa, "k": "ice", "ice": ice})
        self.assertEqual(a[2].wait("rtc")["ice"], ice)
        b[2].send({"t": "rtc", "to": a[0], "k": "ice", "ice": None})
        self.assertIsNone(a[2].wait("rtc", where=lambda m: m["k"] == "ice")["ice"])
        a[2].send({"t": "rtc", "to": b[0], "tc": fb, "k": "state", "mic": True, "cam": 0, "extra": "dropped"})
        st = b[2].wait("rtc")
        self.assertEqual(st, {"t": "rtc", "from": a[0], "fc": fa, "k": "state", "mic": True, "cam": False})
        # not across groups (c is in the room, a friend, not in the group), not across tiles (d), not to oneself
        for to in (c, d):
            a[2].send({**offer, "to": to[0]})
            to[2].none("rtc")
        a_tab2 = self.ws(a[1])
        a_tab2.send({"t": "room", "op": "join", "tile": T1})
        time.sleep(0.2)
        a[2].send({**offer, "to": a[0]})
        a_tab2.none("rtc")
        c[2].send({**offer, "to": a[0]})                             # c to a: not a group member either
        a[2].none("rtc")
        a_tab2.none("rtc")
        # one tab answers: without tc, the tab that entered the room last; with tc, that one only
        b[2].send({"t": "rtc", "to": a[0], "k": "sdp", "sdp": {"type": "offer", "sdp": SDP}})
        a_tab2.wait("rtc")
        a[2].none("rtc")
        b[2].send({"t": "rtc", "to": a[0], "tc": fa, "k": "state", "mic": False, "cam": True})
        self.assertTrue(a[2].wait("rtc")["cam"])
        a_tab2.none("rtc")
        b[2].send({"t": "rtc", "to": a[0], "tc": "00000000", "k": "bye"})   # a connection that is not there: nowhere
        a[2].none("rtc")
        # malformed: the field named
        for bad, field in (({"to": "someone", "k": "bye"}, "to"), ({"to": b[0], "k": "video"}, "k"),
                           ({"to": b[0], "k": "sdp", "sdp": {"type": "offer", "sdp": "x" * 50_000}}, "sdp"),
                           ({"to": b[0], "k": "sdp", "sdp": "v=0"}, "sdp"),
                           ({"to": b[0], "k": "ice", "ice": {"candidate": CAND, "sdpMLineIndex": "0"}}, "ice"),
                           ({"to": b[0], "tc": "ZZ", "k": "bye"}, "tc")):
            a[2].send({"t": "rtc", **bad})
            self.assertEqual(a[2].wait("err")["field"], field)
        # leaving the room, or closing, tells the members in it: bye
        b[2].send({"t": "room", "op": "leave"})
        for tab in (a[2], a_tab2):
            self.assertEqual(tab.wait("rtc", where=lambda m: m["k"] == "bye")["from"], b[0])
        d[2].none("rtc")
        b[2].send({"t": "room", "op": "join", "tile": T1})
        time.sleep(0.2)
        a_tab2.close()
        b[2].wait("rtc", where=lambda m: m["k"] == "bye" and m["from"] == a[0])
        for p in (a, b, c, d):
            p[2].close()

    def test_ice_servers_with_turn(self):
        """TURN from the environment: a static pair, or coturn's time-limited credential from TURN_SECRET."""
        try:
            os.environ["TURN_URL"] = "turn:turn.example.org:3478?transport=udp, turns:turn.example.org:5349, nonsense"
            os.environ["TURN_USERNAME"], os.environ["TURN_CREDENTIAL"] = "we-static-user", "we-static-pass"
            a = self.player("Turn_a")
            turn = a[2].welcome["ice"][1]
            self.assertEqual(turn, {"urls": ["turn:turn.example.org:3478?transport=udp", "turns:turn.example.org:5349"],
                                    "username": "we-static-user", "credential": "we-static-pass"})
            os.environ["TURN_SECRET"] = TURN_SECRET
            w = self.ws(a[1])
            turn = w.welcome["ice"][1]
            expiry = int(turn["username"].split(":")[0])
            self.assertAlmostEqual(expiry, time.time() + hub.TURN_TTL_S, delta=60)
            import base64, hashlib, hmac
            want = base64.b64encode(hmac.new(TURN_SECRET.encode(), turn["username"].encode(), hashlib.sha1).digest()).decode()
            self.assertEqual(turn["credential"], want)
            del os.environ["TURN_URL"]
            self.assertEqual(len(self.ws(a[1]).welcome["ice"]), 1)
        finally:
            for k in ("TURN_URL", "TURN_USERNAME", "TURN_CREDENTIAL", "TURN_SECRET"):
                os.environ.pop(k, None)

    def test_framing(self):
        """ws.py joins fragments around a ping and answers the ping."""
        a = self.player("Vole_frag")
        a[2].send_fragmented({"t": "search", "q": "vole_fr"})
        self.assertEqual([u["name"] for u in a[2].wait("found")["users"]], [])
        a[2].send({"t": "nonsense"})
        self.assertEqual(a[2].wait("err")["why"], "unknown message")

    def test_game_still_runs(self):
        """The acorn game's hello and welcome over /api/game/ws, now on ws.py's framing."""
        g = WsClient(self.port, "/api/game/ws")
        self.socks.append(g)
        self.assertEqual(g.status, 101)
        g.send({"t": "hello", "tile": T1, "season": "fall", "species": "sciurus_griseus"})
        r = g.wait("epoch")["r"]
        g.send_fragmented({"t": "hello", "tile": T1, "season": "fall", "species": "sciurus_griseus",
                           "sid": "0123456789abcdef0123", "r": r})
        w = g.wait("welcome")
        self.assertEqual((w["n"], w["host"], w["world"]["tile"]), (1, True, T1))
        self.assertTrue(w["you"].startswith("p:"))
        g.send({"t": "hello", "tile": "utm10n_1_1", "season": "fall"})
        self.assertEqual(g.wait("err")["why"], "unknown tile")
        g.close()
        for _ in range(20):          # the server leaves the world once it has read the close
            if self.http("GET", f"/api/game/{T1}/fall")[1]["players"] == 0:
                break
            time.sleep(0.1)
        self.assertEqual(self.http("GET", f"/api/game/{T1}/fall")[1]["players"], 0)

    # -- last: what the others left behind
    def test_zz_database_and_log(self):
        time.sleep(0.3)
        db = self.tmp / "data" / "hub.sqlite"
        self.assertEqual(sorted(p.name for p in db.parent.iterdir()), ["hub.sqlite"])
        con = sqlite3.connect(str(db))
        tables = sorted(r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'"))
        self.assertEqual(tables, sorted(hub.TABLES))
        self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], hub.SCHEMA_VERSION)
        self.assertGreater(con.execute("SELECT COUNT(*) FROM users").fetchone()[0], 10)
        self.assertEqual(con.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 1)
        cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
        self.assertNotIn("email", cols)
        con.close()
        raw = db.read_bytes()
        needles = [T1, T2, "4321.12", "4321.13", "1234.75", "287.5", "2.375", CHAT_TILE, PASSWORD, "lontra",
                   "heron-at-the-ford", "198.51.100.77"]
        for n in needles:
            self.assertNotIn(n.encode(), raw, n)
        self.assertIn(CHAT_GROUP.encode(), raw)                 # group chat is kept (7 days)
        log = self.log.text()
        self.assertIn("/api/hub/signin 200", log)
        for n in needles[2:] + [CHAT_GROUP, "test-secret", "test-client-id", TURN_SECRET, "we-static-pass"] + self.names:
            self.assertNotIn(n, log, n)


if __name__ == "__main__":
    unittest.main()
