"""Transparent desktop pet window using PySide6."""
from PySide6.QtWidgets import QApplication, QLabel, QWidget
from PySide6.QtCore import Qt


class PetWindow(QWidget):
    """A frameless, transparent, always-on-top pet window."""

    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setGeometry(100, 100, 200, 200)

        self.label = QLabel("🐱", self)
        self.label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.label.setStyleSheet("font-size: 64px;")
        self.label.setGeometry(0, 0, 200, 200)


if __name__ == "__main__":
    app = QApplication([])
    pet = PetWindow()
    pet.show()
    app.exec()
