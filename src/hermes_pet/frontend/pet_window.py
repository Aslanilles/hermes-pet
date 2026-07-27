"""Transparent desktop pet window — click to chat, reply in bubble.

Pure Qt Signal/Slot.  Emits ``message_requested`` on click;
caller wires it to a backend and feeds replies into ``show_reply``.
"""

from PySide6.QtWidgets import QLabel, QWidget
from PySide6.QtCore import Qt, Signal


class PetWindow(QWidget):
    """Frameless, always-on-top cat with a chat bubble."""

    message_requested = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)

        # ── window ──
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setGeometry(100, 100, 220, 350)

        # ── cat ──
        self.cat_label = QLabel("🐱", self)
        self.cat_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.cat_label.setStyleSheet("font-size: 72px;")
        self.cat_label.setGeometry(0, 0, 220, 200)

        # ── bubble ──
        self.bubble = QLabel(self)
        self.bubble.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.bubble.setWordWrap(True)
        self.bubble.setMinimumWidth(100)
        self.bubble.setMaximumWidth(200)
        self.bubble.setStyleSheet("""
            QLabel {
                background: rgba(255, 255, 255, 210);
                border: 1px solid rgba(0, 0, 0, 60);
                border-radius: 14px;
                padding: 10px 14px;
                font-size: 14px;
                color: #333;
            }
        """)
        self.bubble.setGeometry(10, 210, 200, 80)
        self.bubble.hide()

    # ── click ──────────────────────────────────────────────────────────

    def mousePressEvent(self, event):
        """Click cat → show "…" → emit ``message_requested``."""
        self.bubble.setText("…")
        self.bubble.adjustSize()
        self._center_bubble()
        self.bubble.show()
        self.message_requested.emit("你好")

    # ── public slot ────────────────────────────────────────────────────

    def show_reply(self, text: str):
        """Display *text* in the bubble (call from any thread-safe Signal)."""
        self.bubble.setText(text)
        self.bubble.adjustSize()
        self._center_bubble()
        self.bubble.show()

    # ── helpers ────────────────────────────────────────────────────────

    def _center_bubble(self):
        bw = self.bubble.width()
        ww = self.width()
        self.bubble.move((ww - bw) // 2, self.bubble.y())
