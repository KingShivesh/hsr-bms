"""A fresh intent per test mutation; replay tests explicitly reuse their key."""
import uuid
import logging
import re
import httpx
from fastapi.testclient import TestClient as BaseTestClient


class RedactTestTokens(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        redacted = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED_QA_JWT]", message)
        if redacted != message:
            record.msg, record.args = redacted, ()
        return True


logging.getLogger("httpx").addFilter(RedactTestTokens())


class TestClient(BaseTestClient):
    def request(self, method, url, **kwargs):
        headers = httpx.Headers(kwargs.pop("headers", None))
        if method.upper() not in {"GET", "HEAD", "OPTIONS"} and "Idempotency-Key" not in headers:
            headers["Idempotency-Key"] = uuid.uuid4().hex
        return super().request(method, url, headers=headers, **kwargs)
