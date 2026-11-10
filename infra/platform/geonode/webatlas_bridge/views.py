"""
The two bridge routes. Registration follows the Step 1 spike (infra/platform/README.md, "Đăng ký dữ
liệu từ mã"): the steps of `resource_manager.create` for the one coverage (not `gs_slurp`, which
also builds a thumbnail from OpenStreetMap tiles, minutes offline), but without its delete-on-error:
the bridge never deletes a dataset, since that cascades into GeoServer and the worker's files.
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

from guardian.shortcuts import get_user_perms

from geonode.base import enumerations
from geonode.base.models import ResourceBase
from geonode.geoserver.helpers import gs_catalog, ogc_server_settings, sync_instance_with_geoserver
from geonode.layers.models import Dataset
from geonode.resource.utils import resourcebase_post_save

from webatlas_bridge.auth import require_bridge_token

logger = logging.getLogger(__name__)

WORKSPACE = "geonode"
PAGE_SIZE = 200
# Same rule as packages/atlas-data/tools/timeseries/geoserver.py: store, coverage and layer name at once.
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$")
# First key of the bridge's advisory locks ("WA").
_LOCK_SPACE = 0x5741
_TIME_DIMENSION = re.compile(r'<Dimension name="time"[^>]*>([^<]*)</Dimension>')
# Honoured only when settings.WEBATLAS_BRIDGE_TEST_HOOKS (env WEBATLAS_BRIDGE_TEST_HOOKS=1, off by
# default): `X-Webatlas-Bridge-Fail: permissions` makes the permissions step fail, for the live check.
_FAIL_HEADER = "X-Webatlas-Bridge-Fail"


def _test_hooks():
    return bool(getattr(settings, "WEBATLAS_BRIDGE_TEST_HOOKS", False))


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
    missing, so the user's later Keycloak sign-in lands on this same account. None when no account
    could be created (the username kept clashing with concurrent registrations of other subjects).
    """
    provider = _provider()
    for _attempt in range(2):
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
                    extra_data={"sub": owner["sub"], "preferred_username": owner["username"],
                                "email": owner["email"]})
                return user
        except IntegrityError:
            # A concurrent registration of the same subject (found on the next pass), or of another
            # subject that took the same username first (a fresh variant on the next pass).
            logger.warning("webatlas bridge: account for %s clashed, retrying", owner["sub"], exc_info=True)
    found = SocialAccount.objects.select_related("user").filter(provider=provider, uid=owner["sub"]).first()
    return found.user if found else None


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
    if user is None:
        return _error(409, "Không tạo được tài khoản GeoNode cho chủ sở hữu, hãy thử lại.")
    fail_permissions = _test_hooks() and request.headers.get(_FAIL_HEADER) == "permissions"
    with _name_lock(alternate):
        return _register(name, alternate, title.strip(), abstract, user, res, fail_permissions)


def _register(name, alternate, title, abstract, user, res, fail_permissions):
    existing = Dataset.objects.filter(alternate=alternate).first()
    if existing is not None:
        if existing.owner_id != user.pk:
            return _error(409, f"{alternate} đã được đăng ký cho người dùng khác.")
        if _permissions_applied(existing, user):
            return JsonResponse(_ids(existing), status=200)
        # An earlier registration stopped half-way. The dataset stayed private (no permissions,
        # GeoFence denies by default): finish it now.
        return _finish(existing, user, res, name, fail_permissions, created=False)
    try:
        dataset = Dataset.objects.create(
            uuid=str(uuidlib.uuid4()), name=name, workspace=WORKSPACE, store=name, subtype="raster",
            alternate=alternate, title=title, abstract=abstract, owner=user, is_published=False,
            is_approved=False)
    except Exception:  # noqa: BLE001 - logged; a fixed message to the caller
        logger.exception("webatlas bridge: creating the dataset row for %s failed", alternate)
        return _error(502, f"GeoNode không đăng ký được {alternate}, hãy thử lại.")
    return _finish(dataset, user, res, name, fail_permissions, created=True)


def _permissions_applied(dataset, user):
    """The owner's own view permission, the last thing registration sets (there is none before)."""
    return "view_resourcebase" in get_user_perms(user, ResourceBase.objects.get(pk=dataset.pk))


def _sync(dataset):
    """
    What resource_manager.create does after inserting the row, without its clean-up: on any error
    it deletes the dataset, and deleting a dataset cascades into GeoServer (layer, store, the shared
    default style; purge=all on a single GeoTIFF store deletes the file), i.e. the worker's output.
    """
    dataset.set_processing_state(enumerations.STATE_RUNNING)
    with transaction.atomic():
        dataset.set_missing_info()
        dataset = sync_instance_with_geoserver(dataset.id) or dataset
    dataset.save()
    resourcebase_post_save(dataset.get_real_instance())
    dataset.set_processing_state(enumerations.STATE_PROCESSED)
    return dataset


def _finish(dataset, user, res, name, fail_permissions, created):
    """
    Sync with GeoServer unless done already, record the time dimension, apply the moderation
    permissions. Never deletes anything: on failure the dataset stays, private, and a retry of the
    same registration resumes here. 201 for a new dataset, 200 when resuming one.
    """
    alternate = dataset.alternate
    try:
        if dataset.state != enumerations.STATE_PROCESSED:
            dataset = _sync(dataset)
        has_time, first, last = _time_extent(res, name)
        # GeoNode's GeoServer sync labels every time-enabled resource `vector_time`, coverages included.
        Dataset.objects.filter(pk=dataset.pk).update(has_time=has_time)
        ResourceBase.objects.filter(pk=dataset.pk).update(
            subtype="raster", temporal_extent_start=first, temporal_extent_end=last)
        dataset.refresh_from_db()
        if fail_permissions:
            raise RuntimeError("test hook: the permissions step was asked to fail")
        # Moderation (RESOURCE_PUBLISHING + ADMIN_MODERATE_UPLOADS): unpublished, unapproved, owner
        # and group managers only, anonymous removed; GeoFence rules follow.
        dataset.set_default_permissions(owner=user, created=True)
    except Exception:  # noqa: BLE001 - logged; a fixed message to the caller
        logger.exception("webatlas bridge: finishing the registration of %s failed", alternate)
        try:
            if dataset.state != enumerations.STATE_PROCESSED:
                dataset.set_processing_state(enumerations.STATE_INVALID)
        except Exception:  # noqa: BLE001 - best effort only
            logger.exception("webatlas bridge: could not mark %s as failed", alternate)
        return _error(
            502, f"GeoNode chưa đăng ký xong {alternate}; dữ liệu vẫn giữ nguyên, hãy gửi lại yêu cầu.")
    return JsonResponse(_ids(dataset), status=201 if created else 200)


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
