"""Tests for Hermes Pet."""
import os
import sys
import pytest


# ── Backend tests ──

def test_hermes_client_creation():
    """HermesClient can be created with default settings."""
    from hermes_pet.backend.hermes_client import HermesClient
    client = HermesClient()
    assert client.base_url == "http://localhost:8642"
    assert client.api_key is not None
    assert len(client.api_key) >= 16


def test_api_key_from_env(monkeypatch):
    """HermesClient reads HERMES_API_KEY from environment."""
    monkeypatch.setenv("HERMES_API_KEY", "test-key-1234567890123456")
    from hermes_pet.backend.hermes_client import HermesClient
    client = HermesClient()
    assert client.api_key == "test-key-1234567890123456"


def test_gateway_url_from_env(monkeypatch):
    """HermesClient reads HERMES_GATEWAY_URL from environment."""
    monkeypatch.setenv("HERMES_GATEWAY_URL", "http://custom:9999")
    from hermes_pet.backend.hermes_client import HermesClient
    client = HermesClient()
    assert client.base_url == "http://custom:9999"


# ── Frontend tests ──

def test_pet_window_accepts_callback():
    """PetWindow accepts send_message_callback parameter."""
    from hermes_pet.frontend.pet_window import PetWindow
    called = []

    def fake_callback(msg):
        called.append(msg)
        return "reply"

    pet = PetWindow(send_message_callback=fake_callback)
    assert pet.send_message_callback is not None
    assert pet.send_message_callback("test") == "reply"
    assert called == ["test"]


def test_pet_window_has_show_reply():
    """PetWindow has show_reply method."""
    from hermes_pet.frontend.pet_window import PetWindow
    pet = PetWindow()
    assert hasattr(pet, "show_reply")
    assert callable(pet.show_reply)


# ── Integration test ──

def test_pet_app_creation():
    """PetApp can be created and holds all components."""
    from hermes_pet.main import PetApp
    app = PetApp()
    assert app.hermes is not None
    assert app.pet is not None
    assert app.pet.send_message_callback is not None
    app._shutdown()
