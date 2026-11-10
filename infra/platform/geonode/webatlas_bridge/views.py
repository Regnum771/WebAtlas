"""
The two bridge routes. Registration follows the Step 1 spike (infra/platform/README.md, "Đăng ký dữ
liệu từ mã"): `resource_manager.create` for the one coverage, not `gs_slurp`, which also builds a
thumbnail from OpenStreetMap tiles (minutes offline) and leaves the dataset published.
"""
import contextlib
import json
import logging
import re
import uuid as uuidlib
import zlib
from datetime import timezone as dt_timezone

import requests
from allauth.account.adapter import get_adapter
from allauth.socialaccount.models import SocialAccount
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from geonode.base.models import ResourceBase
from geonode.geoserver.helpers import gs_catalog, ogc_server_settings
from geonode.layers.models import Dataset
from geonode.resource.manager import resource_manager

from webatlas_bridge.auth import require_bridge_token

logger = logging.getLogger(__name__)

WORKSPACE = "geonode"
PAGE_SIZE = 200
# Same rule as packages/atlas-data/tools/timeseries/geoserver.py: store, coverage and layer name at once.
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$")
# First key of the bridge's advisory locks ("WA").
_LOCK_SPACE = 0x5741
_TIME_DIMENSION = re.compile(r'<Dimension name="time"[^>]*>([^<]*)</Dimension>')


def _error(status, detail):
    return JsonResponse({"detail": detail}, status=status)


def _provider():
    # The id allauth stores in socialaccount_socialaccount.provider for Keycloak accounts.
    return settings.SOCIALACCOUNT_OIDC_PROVIDER


def _parse_owner(owner):
    if not isinstance(owner, dict):
        return None
    sub, username, email = (owner.get(k) for k in ("sub", "username", "email"))
    if not (isinstance(sub, str) and sub.strip() and isinstance(username, str) and username.strip()):
        return None
    if email is not None and not isinstance(email, str):
        return None
    return {"sub": sub.strip(), "username": username.strip(), "email": (email or "").strip()}


def _user_for(owner):
    """
    The GeoNode user signed in through Keycloak as `owner.sub`, created with its SocialAccount when
    missing, so the user's later Keycloak sign-in lands on this same account.
    """
    provider = _provider()
    found = SocialAccount.objects.select_related("user").filter(provider=provider, uid=owner["sub"]).first()
    if found:
        return found.user
    try:
        with transaction.atomic():
            # Never take over an existing account by name: a free variant of the username.
            username = get_adapter().generate_unique_username([owner["username"], owner["email"], "user"])
            user = get_user_model().objects.create(username=username, email=owner["email"])
            user.set_unusable_password()
            user.save(update_fields=["password"])
            SocialAccount.objects.create(
                user=user, provider=provider, uid=owner["sub"],
                extra_data={"sub": owner["sub"], "preferred_username": owner["username"], "email": owner["email"]})
            return user
    except IntegrityError:
        # A concurrent registration for the same subject created it first.
        return SocialAccount.objects.select_related("user").get(provider=provider, uid=owner["sub"]).user


def _coverage(name):
    gs_catalog._cache.clear()
    gs_catalog.reset()
    try:
        res = gs_catalog.get_resource(name=name, store=name, workspace=WORKSPACE)
    except Exception:  # noqa: BLE001 - gsconfig raises for a missing store
        return None
    if res is None or getattr(res.store, "resource_type", None) != "coverageStore":
        return None
    return res


def _time_extent(res, name):
    """(has_time, first, last) from GeoServer: the coverage's time dimension and its listed values."""
    dim = (getattr(res, "metadata", None) or {}).get("time")
    enabled = getattr(dim, "enabled", False)
    if not (enabled is True or str(enabled).lower() == "true"):
        return False, None, None
    r = requests.get(
        f"{ogc_server_settings.LOCATION.rstrip('/')}/{WORKSPACE}/{name}/wms",
        params={"service": "WMS", "version": "1.3.0", "request": "GetCapabilities"},
        auth=ogc_server_settings.credentials, timeout=120)
    r.raise_for_status()
    match = _TIME_DIMENSION.search(r.text)
    times = []
    for value in (match.group(1).split(",") if match else []):
        for part in value.strip().split("/")[:2]:
            t = parse_datetime(part.strip())
            if t is not None:
                times.append(t)
    return True, (min(times) if times else None), (max(times) if times else None)


@contextlib.contextmanager
def _name_lock(alternate):
    """Serialise registrations of one name across web workers (a session-level advisory lock)."""
    key = zlib.crc32(alternate.encode()) - (1 << 31)  # signed int4
    with connection.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s, %s)", [_LOCK_SPACE, key])
    try:
        yield
    finally:
        with connection.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s, %s)", [_LOCK_SPACE, key])


def _ids(dataset):
    return {"pk": dataset.pk, "uuid": str(dataset.uuid), "alternate": dataset.alternate}


@csrf_exempt
@require_http_methods(["POST"])
@require_bridge_token
def register_dataset(request):
    """
    Register the existing GeoServer coverage geonode:<name> as a GeoNode dataset owned by the
    Keycloak subject `owner.sub`, unpublished and unapproved, with its time dimension recorded.
    201 with {pk, uuid, alternate}; 200 with the same when that owner registered it already.
    """
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        return _error(400, "Nội dung yêu cầu không phải JSON hợp lệ.")
    if not isinstance(body, dict):
        return _error(400, "Nội dung yêu cầu phải là một đối tượng JSON.")
    name, title, abstract = body.get("name"), body.get("title"), body.get("abstract", "")
    owner = _parse_owner(body.get("owner"))
    if not (isinstance(name, str) and _NAME.match(name)):
        return _error(400, "Tên bộ dữ liệu không hợp lệ.")
    if not (isinstance(title, str) and title.strip()):
        return _error(400, "Thiếu tiêu đề.")
    if not isinstance(abstract, str):
        return _error(400, "Tóm tắt phải là chuỗi.")
    if owner is None:
        return _error(400, "Thiếu chủ sở hữu (sub, username).")

    alternate = f"{WORKSPACE}:{name}"
    res = _coverage(name)
    if res is None:
        return _error(404, f"Không có lớp ảnh {alternate} trên GeoServer.")
    user = _user_for(owner)
    with _name_lock(alternate):
        return _register(name, alternate, title.strip(), abstract, user, res)


def _register(name, alternate, title, abstract, user, res):
    existing = Dataset.objects.filter(alternate=alternate).first()
    if existing is not None:
        if existing.owner_id == user.pk:
            return JsonResponse(_ids(existing), status=200)
        return _error(409, f"{alternate} đã được đăng ký cho người dùng khác.")

    try:
        has_time, first, last = _time_extent(res, name)
        dataset = resource_manager.create(
            str(uuidlib.uuid4()), resource_type=Dataset,
            defaults=dict(name=name, workspace=WORKSPACE, store=name, subtype="raster", alternate=alternate,
                          title=title, abstract=abstract, owner=user,
                          is_published=False, is_approved=False))
    except Exception as e:  # noqa: BLE001 - reported to the caller
        logger.exception("webatlas bridge: registering %s failed", alternate)
        return _error(502, f"GeoNode không đăng ký được {alternate}: {e}")
    try:
        # GeoNode's GeoServer sync labels every time-enabled resource `vector_time`, coverages included.
        Dataset.objects.filter(pk=dataset.pk).update(has_time=has_time)
        ResourceBase.objects.filter(pk=dataset.pk).update(
            subtype="raster", temporal_extent_start=first, temporal_extent_end=last)
        dataset.refresh_from_db()
        # Moderation (RESOURCE_PUBLISHING + ADMIN_MODERATE_UPLOADS): unpublished, unapproved, owner
        # and group managers only, anonymous removed; GeoFence rules follow.
        dataset.set_default_permissions(owner=user, created=True)
    except Exception as e:  # noqa: BLE001 - reported to the caller
        logger.exception("webatlas bridge: permissions for %s failed", alternate)
        resource_manager.delete(dataset.uuid, instance=dataset)
        return _error(502, f"GeoNode không đặt được quyền cho {alternate}: {e}")
    return JsonResponse(_ids(dataset), status=201)


@require_http_methods(["GET"])
@require_bridge_token
def list_resources(request):
    """Every GeoNode resource (published or not) changed at or after `since`, PAGE_SIZE per page."""
    since = None
    if request.GET.get("since"):
        since = parse_datetime(request.GET["since"].replace(" ", "+"))
        if since is None:
            return _error(400, "Tham số since phải là thời điểm ISO 8601.")
        if timezone.is_naive(since):
            since = timezone.make_aware(since, dt_timezone.utc)
    try:
        page = int(request.GET.get("page", "1"))
    except ValueError:
        page = 0
    if page < 1:
        return _error(400, "Tham số page phải là số nguyên dương.")

    qs = ResourceBase.objects.non_polymorphic().order_by("last_updated", "pk")
    if since is not None:
        qs = qs.filter(last_updated__gte=since)
    offset = (page - 1) * PAGE_SIZE
    rows = list(qs[offset:offset + PAGE_SIZE + 1])
    more = len(rows) > PAGE_SIZE
    rows = rows[:PAGE_SIZE]
    subs = dict(SocialAccount.objects.filter(provider=_provider(), user_id__in={r.owner_id for r in rows})
                .order_by("-pk").values_list("user_id", "uid"))
    resources = [{
        "pk": r.pk,
        "uuid": str(r.uuid),
        "alternate": r.alternate,
        "resourceType": r.resource_type,
        "subtype": r.subtype,
        "title": r.title,
        "abstract": r.abstract or "",
        "ownerSub": subs.get(r.owner_id),
        "isPublished": r.is_published,
        "isApproved": r.is_approved,
        "bbox4326": list(r.ll_bbox_polygon.extent) if r.ll_bbox_polygon else None,
        "lastUpdated": r.last_updated.isoformat() if r.last_updated else None,
    } for r in rows]
    return JsonResponse({"resources": resources, "next": page + 1 if more else None})
