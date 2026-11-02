"""A minimal RFC 6455 WebSocket for the dev server: the handshake, framing and a connection's threads.

Shared by the acorn game (server.py's GameConn at /api/game/ws) and the hub (hub.py's HubConn at
/api/hub/ws). Standard library only. A connection reads on its request's thread (run) and a writer thread
drains its queue, so a slow client never holds anyone's lock. Messages are JSON text frames; their contents
are never printed here.
"""
from __future__ import annotations

import base64
import hashlib
import json
import queue
import socket
import struct
import threading
import time

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WS_MAX_IN = 64 * 1024


def ws_frame(data: bytes, op: int = 1) -> bytes:
    n, b0 = len(data), 0x80 | op
    if n < 126:
        head = struct.pack(">BB", b0, n)
    elif n < 65536:
        head = struct.pack(">BBH", b0, 126, n)
    else:
        head = struct.pack(">BBQ", b0, 127, n)
    return head + data


def ws_upgrade(handler, extra_headers: list[tuple[str, str]] = ()) -> bool:
    """The RFC 6455 handshake on a BaseHTTPRequestHandler. Answers 400 and returns False when the request is
    not an upgrade; otherwise writes the 101, logs it and hands the socket over (the caller then runs a
    WsConn on handler.connection and handler.rfile)."""
    key = handler.headers.get("Sec-WebSocket-Key")
    if "websocket" not in (handler.headers.get("Upgrade") or "").lower() or not key:
        handler.send_json({"error": "WebSocket upgrade expected"}, 400)
        return False
    accept = base64.b64encode(hashlib.sha1((key.strip() + WS_GUID).encode()).digest()).decode()
    head = ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n")
    head += "".join(f"{k}: {v}\r\n" for k, v in extra_headers)
    handler.wfile.write((head + "\r\n").encode())
    handler.log_request(101)
    handler.close_connection = True
    return True


class WsConn:
    """One WebSocket client. Subclasses implement on_message(dict) and may implement on_close()."""

    TAG = "ws"                 # the log prefix when a connection ends unexpectedly
    RATE, BURST = 40.0, 120.0  # the token bucket (allow): messages per second, and the burst

    def __init__(self, sock, rfile):
        self.sock, self.rfile = sock, rfile
        self.q: queue.Queue = queue.Queue(maxsize=4000)
        self.alive = True
        self.tokens, self.tok_t, self.last_rx = self.BURST, time.monotonic(), time.monotonic()
        threading.Thread(target=self._write, daemon=True).start()

    def send(self, obj) -> None:
        self.raw(ws_frame(json.dumps(obj, separators=(",", ":")).encode()))

    def raw(self, frame: bytes) -> None:
        if not self.alive:
            return
        try:
            self.q.put_nowait(frame)
        except queue.Full:    # far behind: drop it, it reconnects and gets a fresh snapshot
            self.kill()

    def kill(self) -> None:
        self.alive = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _write(self) -> None:
        while True:
            frame = self.q.get()
            if frame is None or not self.alive:
                return
            try:
                self.sock.sendall(frame)
            except OSError:
                self.kill()
                return

    def _read(self, n: int) -> bytes:
        b = self.rfile.read(n)
        if b is None or len(b) < n:
            raise ConnectionError("closed")
        return b

    def recv(self) -> tuple[int, bytes]:
        """One whole message (continuation frames joined): (opcode, payload)."""
        op0, buf = None, b""
        while True:
            b0, b1 = self._read(2)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            if n > WS_MAX_IN or len(buf) + n > WS_MAX_IN:
                raise ConnectionError("message too large")
            mask = self._read(4) if b1 & 0x80 else None
            data = self._read(n) if n else b""
            if mask:
                data = bytes(c ^ mask[i & 3] for i, c in enumerate(data))
            self.last_rx = time.monotonic()
            if op >= 8:                 # control frames may come between fragments: answered here, so a
                if op == 9:             # fragmented message is not lost to a ping in its middle
                    self.raw(ws_frame(data, 10))
                elif op == 8:
                    return op, data
                continue
            if op0 is None:
                op0 = op
            buf += data
            if b0 & 0x80:
                return op0, buf

    def allow(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.BURST, self.tokens + (now - self.tok_t) * self.RATE)
        self.tok_t = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True

    def close(self) -> None:
        """Send a close frame and end the writer once the queue is drained (the reader then ends)."""
        self.raw(ws_frame(b"", 8))
        try:
            self.q.put_nowait(None)
        except queue.Full:
            pass

    def run(self) -> None:
        try:
            while self.alive:
                op, data = self.recv()
                if op == 8:
                    self.raw(ws_frame(b"", 8))
                    break
                if op != 1:
                    continue
                try:
                    msg = json.loads(data)
                except ValueError:
                    self.send({"t": "err", "why": "not JSON"})
                    continue
                if isinstance(msg, dict):
                    self.on_message(msg)
        except (OSError, ConnectionError):
            pass
        except Exception as e:  # noqa: BLE001  (say why a connection ended unexpectedly; never its messages)
            print(f"[{self.TAG}] connection ended: {type(e).__name__}: {str(e)[:120]}", flush=True)
        finally:
            self.on_close()
            self.alive = False
            try:
                self.q.put_nowait(None)
            except queue.Full:
                pass

    def on_message(self, m: dict) -> None:
        raise NotImplementedError

    def on_close(self) -> None:
        pass
