"""A fresh intent per test mutation; replay tests explicitly reuse their key."""
import uuid
import httpx
from fastapi.testclient import TestClient as BaseTestClient


class TestClient(BaseTestClient):
    def request(self, method, url, **kwargs):
        headers = httpx.Headers(kwargs.pop("headers", None))
        if method.upper() not in {"GET", "HEAD", "OPTIONS"} and "Idempotency-Key" not in headers:
            headers["Idempotency-Key"] = uuid.uuid4().hex
        return super().request(method, url, headers=headers, **kwargs)
