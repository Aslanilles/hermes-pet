"""Entry point for Hermes Pet."""
import sys
from PySide6.QtWidgets import QApplication
from hermes_pet.frontend.pet_window import PetWindow


def main():
    app = QApplication(sys.argv)
    pet = PetWindow()
    pet.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
