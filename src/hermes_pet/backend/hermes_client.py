"""Client for Hermes Agent API Server using Qt's native HTTP (QNetworkAccessManager).

Pure Qt Signal/Slot — no asyncio, no httpx, no threading needed.
"""

import json
import os

from PySide6.QtCore import QObject, Signal, QUrl, QByteArray
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest
from dotenv import load_dotenv

load_dotenv()

API_SERVER_KEY = "806c5f86c7c1cb15e70218be34040bc4815936f9e8e7a3cca1e52b41c7dbe355"


class HermesClient(QObject):
    """Qt-native async client for the Hermes Agent API Server.

    Usage::

        client = HermesClient()
        client.reply_received.connect(my_slot)   # str
        client.error_occurred.connect(my_slot)   # str
        client.send_message("你好")               # slot — call from anywhere
    """

    reply_received = Signal(str)
    error_occurred = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._base_url = os.getenv("HERMES_GATEWAY_URL", "http://localhost:8642")
        self._api_key = os.getenv("HERMES_API_KEY", API_SERVER_KEY)
        self._nam = QNetworkAccessManager(self)

    # ── public slot ────────────────────────────────────────────────────

    def send_message(self, message: str):
        """POST *message* to the Hermes API; reply arrives via ``reply_received``."""
        url = QUrl(f"{self._base_url}/v1/chat/completions")

        request = QNetworkRequest(url)
        request.setHeader(QNetworkRequest.ContentTypeHeader,
                          "application/json")
        request.setRawHeader(b"Authorization",
                             f"Bearer {self._api_key}".encode())

        body = json.dumps({
            "model": "hermes-agent",
            "messages": [{"role": "user", "content": message}],
        }).encode("utf-8")

        reply = self._nam.post(request, QByteArray(body))
        reply.finished.connect(lambda r=reply: self._on_finished(r))

    # ── internals ──────────────────────────────────────────────────────

    def _on_finished(self, reply: QNetworkReply):
        if reply.error() != QNetworkReply.NetworkError.NoError:
            self.error_occurred.emit(reply.errorString())
        else:
            try:
                data = json.loads(reply.readAll().data().decode("utf-8"))
                text = data["choices"][0]["message"]["content"]
                self.reply_received.emit(text)
            except Exception as exc:
                self.error_occurred.emit(str(exc))
        reply.deleteLater()
