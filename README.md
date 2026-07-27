# 🐱 Hermes Pet

Hermes Agent desktop pet — a cute AI companion living on your desktop.

## Architecture

```
┌─────────────────┐      HTTP/WebSocket      ┌──────────────────┐
│   Hermes Pet     │ ◄─────────────────────► │  Hermes Agent    │
│   (Frontend)     │    Gateway API          │  (Backend Brain) │
│                  │                         │                  │
│  PySide6 window  │                         │  Runs locally    │
│  Transparent UI  │                         │  or remotely     │
└─────────────────┘                         └──────────────────┘
```

## Setup

```bash
uv sync
cp .env.example .env   # Edit HERMES_GATEWAY_URL if needed
```

## Run

```bash
uv run hermes-pet
```

## Project Structure

```
src/hermes_pet/
├── frontend/          # Desktop pet UI (PySide6)
│   └── pet_window.py
├── backend/           # Hermes Gateway client
│   └── hermes_client.py
└── main.py            # Entry point
