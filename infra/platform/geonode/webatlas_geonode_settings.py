"""GeoNode settings for the WebATLAS platform: GeoNode's own, plus Keycloak as the sign-in provider.

GeoNode ships OIDC presets for Google and Azure only, so the provider is defined here. The browser
goes to Keycloak's public address; the token and user-info calls use the in-network one.
"""

import os

from geonode.settings import *  # noqa: F401,F403
from geonode.settings import SOCIALACCOUNT_GROUP_ROLE_MAPPER, SOCIALACCOUNT_OIDC_PROVIDER

_PUBLIC = os.environ["KEYCLOAK_PUBLIC_REALM_URL"].rstrip("/")
_INTERNAL = os.environ["KEYCLOAK_INTERNAL_REALM_URL"].rstrip("/")

SOCIALACCOUNT_PROVIDERS = {
    SOCIALACCOUNT_OIDC_PROVIDER: {
        "NAME": "Đăng nhập một lần",
        "SCOPE": ["openid", "email", "profile"],
        "AUTH_PARAMS": {},
        "COMMON_FIELDS": {"email": "email", "first_name": "given_name", "last_name": "family_name"},
        "UID_FIELD": "sub",
        "GROUP_ROLE_MAPPER_CLASS": SOCIALACCOUNT_GROUP_ROLE_MAPPER,
        "AUTHORIZE_URL": f"{_PUBLIC}/protocol/openid-connect/auth",
        "ACCESS_TOKEN_URL": f"{_INTERNAL}/protocol/openid-connect/token",
        "PROFILE_URL": f"{_INTERNAL}/protocol/openid-connect/userinfo",
        "ID_TOKEN_ISSUER": _PUBLIC,
        "OAUTH_PKCE_ENABLED": True,
    }
}

# Vietnamese first. Set here, not through the LANGUAGES variable: geonode.settings narrows that
# variable to MapStore's five default languages, and Vietnamese is not one of them, although both
# GeoNode and its MapStore client ship it (gn-/ms-translations/data.vi-VN.json).
LANGUAGE_CODE = "vi-vn"
LANGUAGES = (("vi-vn", "Tiếng Việt"), ("en-us", "English"))

# Back to the WebATLAS hub after signing out of GeoNode.
ACCOUNT_LOGOUT_REDIRECT_URL = os.environ.get("WEBATLAS_WEB_URL", "/")

# The WebATLAS bridge (webatlas_bridge/): registers worker-published coverages as datasets and lists
# resources for the catalogue sync, behind a shared bearer token. Its URL module includes GeoNode's.
INSTALLED_APPS += ("webatlas_bridge",)  # noqa: F405
ROOT_URLCONF = "webatlas_bridge.urls"
WEBATLAS_BRIDGE_TOKEN = os.environ["WEBATLAS_BRIDGE_TOKEN"]
# Live-check hook only (X-Webatlas-Bridge-Fail header); never set it outside a test run.
WEBATLAS_BRIDGE_TEST_HOOKS = os.environ.get("WEBATLAS_BRIDGE_TEST_HOOKS", "0") == "1"

# Moderation (GeoNode's advanced workflow): a new resource stays unpublished and unapproved, seen by
# its owner and group managers only, until a manager or admin approves and publishes it.
RESOURCE_PUBLISHING = True
ADMIN_MODERATE_UPLOADS = True
