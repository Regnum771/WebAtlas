"""One-off GeoNode setup for the WebATLAS platform; safe to run again.

  - registers Keycloak as the OIDC sign-in app (client id and secret from the environment);
  - removes the old "WebATLAS" top-bar menu: since K7 the WebATLAS header itself links back
    (webatlas_bridge/templates/geonode-mapstore-client/snippets/brand_navbar.html).

Run with: python manage.py shell -c "exec(open('/usr/src/webatlas/webatlas-init.py').read())"
"""

import os
from urllib.parse import urlparse

from allauth.socialaccount.models import SocialApp
from django.conf import settings
from django.contrib.sites.models import Site
from geonode.base.models import Menu

site = Site.objects.get_current()
# Django's placeholder site is example.com; name it after GeoNode's real address.
site.domain = urlparse(settings.SITEURL).netloc
site.name = "Danh mục bản đồ"
site.save()
app, _ = SocialApp.objects.update_or_create(
    provider=settings.SOCIALACCOUNT_OIDC_PROVIDER,
    defaults={
        "name": "Keycloak",
        "client_id": os.environ["KEYCLOAK_GEONODE_CLIENT_ID"],
        "secret": os.environ["KEYCLOAK_GEONODE_SECRET"],
    },
)
app.sites.set([site])
print(f"social app: {app.provider} ({app.client_id}) on {site.domain}")

# Before K7 the links back to WebATLAS were a "WebATLAS" dropdown in GeoNode's top bar. The WebATLAS
# header now carries them, so the menu would only repeat them in the tabs row.
deleted, _ = Menu.objects.filter(placeholder__name="TOPBAR_MENU_LEFT", title="WebATLAS").delete()
print(f"old WebATLAS top-bar menu: {'removed' if deleted else 'absent'}")
