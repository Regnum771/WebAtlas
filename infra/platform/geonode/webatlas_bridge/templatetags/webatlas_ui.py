"""{% wa_t "English" "Tiếng Việt" %}: a label in the reader's language.

GeoNode's Vietnamese catalogue lacks some of the strings its templates use ("All resources", "Datasets",
"Maps"), so they showed in English beside Vietnamese ones. The WebATLAS templates name both forms instead
of relying on gettext.
"""
from django import template
from django.utils.safestring import mark_safe
from django.utils.translation import get_language

register = template.Library()


@register.simple_tag
def wa_t(english, vietnamese):
    return vietnamese if (get_language() or "").lower().startswith("vi") else english


_THEME_CSS = "/usr/src/webatlas/theme/webatlas-theme/geonode.css"


@register.simple_tag
def wa_theme_css():
    """The generated WebATLAS stylesheet (K7), inlined; empty when it is not mounted.

    A container restarted with these templates but without the compose mount (an old container definition)
    then keeps GeoNode's own look instead of failing every page on a missing include.
    """
    try:
        with open(_THEME_CSS, encoding="utf-8") as f:
            return mark_safe(f.read())  # noqa: S308 - our own generated file, not user input
    except OSError:
        return ""
