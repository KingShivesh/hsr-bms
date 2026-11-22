"""Bound bodies as they are received, including requests without Content-Length."""
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class BodySizeLimit:
    def __init__(self, app, max_bytes):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        try:
            declared = int(Headers(scope=scope).get("content-length", "0"))
        except ValueError:
            declared = 0
        if declared > self.max_bytes:
            return await JSONResponse({"detail": "Request body too large"}, status_code=413)(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(413, "Request body too large")
            return message

        return await self.app(scope, bounded_receive, send)
