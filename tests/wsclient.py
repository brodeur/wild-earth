"""A small WebSocket client over socket for the tests (RFC 6455: the handshake, masked frames, pings)."""
from __future__ import annotations

import base64
import json
import os
import queue
import socket
import struct
import threading
import time


class WsClient:
    def __init__(self, port: int, path: str, cookie: str | None = None, origin: str | None = None):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        head = (f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n")
        if cookie:
            head += f"Cookie: we_session={cookie}\r\n"
        if origin:
            head += f"Origin: {origin}\r\n"
        self.sock.sendall((head + "\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            b = self.sock.recv(4096)
            if not b:
                raise ConnectionError("closed during the handshake")
            buf += b
        status, rest = buf.split(b"\r\n\r\n", 1)
        self.status = int(status.split(b" ")[1])
        self.headers = status.decode()
        self.buf = rest
        self.q: queue.Queue = queue.Queue()
        self.closed = threading.Event()
        if self.status == 101:
            threading.Thread(target=self._read, daemon=True).start()
        else:
            self.closed.set()

    def _recv(self, n: int) -> bytes:
        while len(self.buf) < n:
            b = self.sock.recv(65536)
            if not b:
                raise ConnectionError("closed")
            self.buf += b
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _read(self) -> None:
        self.sock.settimeout(None)
        try:
            while True:
                b0, b1 = self._recv(2)
                n = b1 & 0x7F
                if n == 126:
                    n = struct.unpack(">H", self._recv(2))[0]
                elif n == 127:
                    n = struct.unpack(">Q", self._recv(8))[0]
                data, op = self._recv(n), b0 & 0x0F
                if op == 1:
                    self.q.put(json.loads(data))
                elif op == 9:
                    self._send(data, 10)
                elif op == 8:
                    try:
                        self._send(b"", 8)
                    except OSError:
                        pass
                    break
        except (OSError, ConnectionError):
            pass
        self.closed.set()

    def _send(self, data: bytes, op: int = 1) -> None:
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x80 | op])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(head + mask + bytes(c ^ mask[i & 3] for i, c in enumerate(data)))

    def send(self, obj) -> None:
        self._send(json.dumps(obj).encode())

    def send_fragmented(self, obj) -> None:
        """One message in three frames, with a ping between them (the server joins fragments)."""
        data = json.dumps(obj).encode()
        a, b = len(data) // 3, 2 * len(data) // 3
        for i, (part, op) in enumerate(((data[:a], 1), (data[a:b], 0), (data[b:], 0))):
            mask = os.urandom(4)
            fin = 0x80 if i == 2 else 0
            self.sock.sendall(bytes([fin | op, 0x80 | len(part)]) + mask
                              + bytes(c ^ mask[j & 3] for j, c in enumerate(part)))
            if i == 0:
                self._send(b"hi", 9)

    def wait(self, t: str, timeout: float = 5.0, where=None) -> dict:
        """The next message of type t (others before it are dropped), matching where(msg) if given."""
        end = time.monotonic() + timeout
        while True:
            left = end - time.monotonic()
            if left <= 0:
                raise AssertionError(f"no {t!r} message within {timeout} s")
            try:
                m = self.q.get(timeout=left)
            except queue.Empty:
                continue
            if m.get("t") == t and (where is None or where(m)):
                return m

    def none(self, t: str, wait: float = 0.6, where=None) -> None:
        """Assert no message of type t arrives within wait seconds."""
        end = time.monotonic() + wait
        while True:
            left = end - time.monotonic()
            if left <= 0:
                return
            try:
                m = self.q.get(timeout=left)
            except queue.Empty:
                return
            if m.get("t") == t and (where is None or where(m)):
                raise AssertionError(f"unexpected {t!r} message")

    def drain(self) -> None:
        time.sleep(0.15)
        while not self.q.empty():
            self.q.get_nowait()

    def close(self) -> None:
        try:
            self._send(b"", 8)
        except OSError:
            pass
        self.closed.wait(2)
        try:
            self.sock.close()
        except OSError:
            pass
