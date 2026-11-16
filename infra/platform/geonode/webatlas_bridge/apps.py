from django.apps import AppConfig
from django.conf import settings


class WebatlasBridgeConfig(AppConfig):
    name = "webatlas_bridge"
    label = "webatlas_bridge"
    verbose_name = "WebATLAS bridge"
    default_auto_field = "django.db.models.AutoField"

    def ready(self):
        # K7: put the WebATLAS template folders (settings.WEBATLAS_TEMPLATE_DIRS) first. geonode_mapstore_client
        # inserts its own folder at the front of TEMPLATES DIRS in its ready(), which runs before this one
        # (this app is installed last), so a plain settings value would end up behind it and never override.
        # The template engine is built lazily, on the first render, so changing the setting here still counts.
        ours = list(getattr(settings, "WEBATLAS_TEMPLATE_DIRS", []))
        if ours:
            dirs = settings.TEMPLATES[0]["DIRS"]
            settings.TEMPLATES[0]["DIRS"] = ours + [d for d in dirs if d not in ours]
