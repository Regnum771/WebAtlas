"""{% wa_t "English" "Tiếng Việt" %}: a label in the reader's language.

GeoNode's Vietnamese catalogue lacks some of the strings its templates use ("All resources", "Datasets",
"Maps"), so they showed in English beside Vietnamese ones. The WebATLAS templates name both forms instead
of relying on gettext.
"""
from django import template
from django.utils.translation import get_language

register = template.Library()


@register.simple_tag
def wa_t(english, vietnamese):
    return vietnamese if (get_language() or "").lower().startswith("vi") else english
