"""GeoNode's own URLs plus the two bridge routes (settings: ROOT_URLCONF = 'webatlas_bridge.urls')."""
from django.urls import path

from geonode.urls import urlpatterns as geonode_urlpatterns

from webatlas_bridge import views

# GeoNode's error handler lives in its URL module; keep it now that the module is no longer the root.
from geonode.urls import handler500  # noqa: F401

urlpatterns = [
    path("webatlas-bridge/datasets", views.register_dataset, name="webatlas_bridge_datasets"),
    path("webatlas-bridge/resources", views.list_resources, name="webatlas_bridge_resources"),
] + geonode_urlpatterns
