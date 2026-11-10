"""Bearer-token guard for the bridge routes: `Authorization: Bearer $WEBATLAS_BRIDGE_TOKEN`."""
import functools
import hmac

from django.conf import settings
from django.http import JsonResponse


def token_ok(request):
    """True when the request carries the bridge token. An empty configured token admits no one."""
    expected = getattr(settings, "WEBATLAS_BRIDGE_TOKEN", "") or ""
    scheme, _, given = request.headers.get("Authorization", "").partition(" ")
    if not expected or scheme.lower() != "bearer" or not given:
        return False
    return hmac.compare_digest(given.strip().encode(), expected.encode())


def require_bridge_token(view):
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not token_ok(request):
            response = JsonResponse({"detail": "Thiếu hoặc sai mã truy cập cầu nối."}, status=401)
            response["WWW-Authenticate"] = 'Bearer realm="webatlas-bridge"'
            return response
        return view(request, *args, **kwargs)

    return wrapped
