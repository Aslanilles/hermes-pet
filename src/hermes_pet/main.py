"""Hermes Pet — desktop AI companion. Entry point.

Wires PetWindow ↔ HermesClient entirely through Qt Signals & Slots.
No asyncio, no threading, no callbacks — pure Qt-native.
"""

import sys

from PySide6.QtWidgets import QApplication

from hermes_pet.backend.hermes_client import HermesClient
from hermes_pet.frontend.pet_window import PetWindow


def main():
    app = QApplication(sys.argv)

    client = HermesClient()
    pet = PetWindow()

    # ── Signal wiring ──────────────────────────────────────────────
    # click cat  →  POST to Hermes API
    pet.message_requested.connect(client.send_message)

    # API reply  →  show in bubble
    client.reply_received.connect(pet.show_reply)

    # API error  →  show in bubble (prefixed with ❌)
    client.error_occurred.connect(
        lambda msg: pet.show_reply(f"❌ {msg}")
    )

    # ── go ─────────────────────────────────────────────────────────
    pet.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
