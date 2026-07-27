"""Client for communicating with Hermes Agent Gateway."""
import os
import httpx
from dotenv import load_dotenv

load_dotenv()


class HermesClient:
    """Async client to talk to Hermes Agent."""

    def __init__(self):
        self.base_url = os.getenv("HERMES_GATEWAY_URL", "http://localhost:8000")
        self.client = httpx.AsyncClient(timeout=30.0)

    async def send_message(self, message: str) -> str:
        """Send a message to Hermes and get the response."""
        resp = await self.client.post(
            f"{self.base_url}/chat",
            json={"message": message},
        )
        resp.raise_for_status()
        return resp.json()["reply"]

    async def close(self):
        await self.client.aclose()
