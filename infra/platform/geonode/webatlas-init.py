"""One-off GeoNode setup for the WebATLAS platform; safe to run again.

  - registers Keycloak as the OIDC sign-in app (client id and secret from the environment);
  - adds links back to WebATLAS to GeoNode's top bar.

Run with: python manage.py shell -c "exec(open('/usr/src/webatlas/webatlas-init.py').read())"
"""

import os
from urllib.parse import urlparse

from allauth.socialaccount.models import SocialApp
from django.conf import settings
from django.contrib.sites.models import Site
from geonode.base.models import Menu, MenuItem, MenuPlaceholder

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

web = os.environ.get("WEBATLAS_WEB_URL", "http://localhost:5173").rstrip("/")
placeholder, _ = MenuPlaceholder.objects.get_or_create(name="TOPBAR_MENU_LEFT")
menu, _ = Menu.objects.update_or_create(placeholder=placeholder, title="WebATLAS", defaults={"order": 0})
links = [
    ("Trang chủ WebATLAS", f"{web}/"),
    ("Bản đồ tương tác", f"{web}/ban-do"),
    ("Từ điển dữ liệu", f"{web}/du-lieu"),
]
for order, (title, url) in enumerate(links):
    MenuItem.objects.update_or_create(menu=menu, title=title, defaults={"order": order, "url": url, "blank_target": False})
MenuItem.objects.filter(menu=menu).exclude(title__in=[t for t, _ in links]).delete()
print(f"menu {menu.title}: {len(links)} links to {web}")
