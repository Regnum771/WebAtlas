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
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from guardian.models import GroupObjectPermission, UserObjectPermission
from guardian.shortcuts import get_anonymous_user, get_user_perms

from geonode.base import enumerations
from geonode.base.models import ExtraMetadata, ResourceBase
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
# default): `X-Webatlas-Bridge-Fail: permissions` takes GeoNode's set_permissions failure branch
# (state INVALID, no permissions, False returned) instead of calling it, for the live check.
_FAIL_HEADER = "X-Webatlas-Bridge-Fail"
# ExtraMetadata row on a dataset whose registration has not completed yet.
_PENDING_VALUE = "registration-pending"
_PENDING = {"webatlas_bridge": _PENDING_VALUE}
# GeoNode's permissions that make a resource public: anonymous view and anonymous download.
_VIEW, _DOWNLOAD = "view_resourcebase", "download_resourcebase"
# GeoNode gives anonymous access through this group (resource/manager.py set_permissions);
# AnonymousUser's own object permissions are legacy, still read.
_ANONYMOUS_GROUP = "anonymous"


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
        if not _pending(existing):
            # Registered completely: never touch it again (a reviewer may have published it, and
            # the default permissions would unpublish it).
            return JsonResponse(_ids(existing), status=200)
        # An earlier registration stopped half-way. The dataset stayed private (unpublished, no
        # moderation permissions, GeoFence denies by default): finish it now.
        return _finish(existing, user, res, name, fail_permissions, created=False)
    try:
        with transaction.atomic():
            dataset = Dataset.objects.create(
                uuid=str(uuidlib.uuid4()), name=name, workspace=WORKSPACE, store=name, subtype="raster",
                alternate=alternate, title=title, abstract=abstract, owner=user, is_published=False,
                is_approved=False)
            # Not added to dataset.metadata, so GeoNode's metadata pages do not show it.
            ExtraMetadata.objects.create(resource=dataset, metadata=_PENDING)
    except Exception:  # noqa: BLE001 - logged; a fixed message to the caller
        logger.exception("webatlas bridge: creating the dataset row for %s failed", alternate)
        return _error(502, f"GeoNode không đăng ký được {alternate}, hãy thử lại.")
    return _finish(dataset, user, res, name, fail_permissions, created=True)


def _pending(dataset):
    """
    The bridge's own marker, written with the row and removed once registration is complete. Not a
    permission: GeoNode's resourcebase_post_save already gives the owner view and change rights.
    A lost marker errs on the safe side: the dataset counts as registered and stays as it is.
    """
    return ExtraMetadata.objects.filter(resource_id=dataset.pk, metadata__webatlas_bridge=_PENDING_VALUE).exists()


def _permissions_applied(dataset, user):
    """What a successful set_permissions leaves: state PROCESSED and the owner's view permission."""
    resource = ResourceBase.objects.get(pk=dataset.pk)
    return resource.state == enumerations.STATE_PROCESSED and "view_resourcebase" in get_user_perms(user, resource)


def _mark_invalid(dataset):
    """Best effort: state INVALID, so a retry runs the whole GeoServer sync again."""
    try:
        dataset.set_processing_state(enumerations.STATE_INVALID)
    except Exception:  # noqa: BLE001 - best effort only
        logger.exception("webatlas bridge: could not mark %s as invalid", dataset.alternate)


def _sync(dataset):
    """
    What resource_manager.create does after inserting the row, without its clean-up: on any error
    it deletes the dataset, and deleting a dataset cascades into GeoServer (layer, store, the shared
    default style; purge=all on a single GeoTIFF store deletes the file), i.e. the worker's output.
    State PROCESSED at the end means all of it ran: sync_instance_with_geoserver sets PROCESSED on
    its own half-way, so any error here marks the dataset INVALID before it propagates.
    """
    try:
        dataset.set_processing_state(enumerations.STATE_RUNNING)
        with transaction.atomic():
            dataset.set_missing_info()
            dataset = sync_instance_with_geoserver(dataset.id) or dataset
        dataset.save()
        resourcebase_post_save(dataset.get_real_instance())
        dataset.set_processing_state(enumerations.STATE_PROCESSED)
    except Exception:
        _mark_invalid(dataset)
        raise
    return dataset


def _apply_permissions(dataset, user, fail_permissions):
    """
    Moderation (RESOURCE_PUBLISHING + ADMIN_MODERATE_UPLOADS): unpublished, unapproved, owner and
    group managers only, anonymous removed; GeoFence rules follow. GeoNode's set_permissions never
    raises: on error it rolls back, sets the state INVALID and returns False. True only when it
    succeeded and the owner really holds the marker permission.
    """
    if fail_permissions:
        # Test hook: GeoNode's failure branch, as set_permissions takes it.
        dataset.set_processing_state(enumerations.STATE_INVALID)
        ok = False
    else:
        ok = dataset.set_default_permissions(owner=user, created=True)
    return bool(ok) and _permissions_applied(dataset, user)


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
        if not _apply_permissions(dataset, user, fail_permissions):
            raise RuntimeError("GeoNode did not apply the permissions (see its log above)")
        ExtraMetadata.objects.filter(resource_id=dataset.pk, metadata__webatlas_bridge=_PENDING_VALUE).delete()
    except Exception:  # noqa: BLE001 - logged; a fixed message to the caller
        logger.exception("webatlas bridge: finishing the registration of %s failed", alternate)
        return _error(
            502, f"GeoNode chưa đăng ký xong {alternate}; dữ liệu vẫn giữ nguyên, hãy gửi lại yêu cầu.")
    return JsonResponse(_ids(dataset), status=201 if created else 200)


def _anonymous_perms(pks):
    """
    {pk: {codename}}: which of view_resourcebase / download_resourcebase GeoNode grants anonymous
    users on each resource, through the anonymous group or AnonymousUser. Two queries per page.
    GeoNode assigns them on the ResourceBase row (get_self_resource), hence that content type.
    """
    if not pks:
        return {}
    ct = ContentType.objects.get_for_model(ResourceBase)
    keys = [str(pk) for pk in pks]
    perms = (_VIEW, _DOWNLOAD)
    rows = list(UserObjectPermission.objects.filter(
        content_type=ct, object_pk__in=keys, user=get_anonymous_user(), permission__codename__in=perms,
    ).values_list("object_pk", "permission__codename"))
    group = Group.objects.filter(name=_ANONYMOUS_GROUP).first()
    if group is not None:
        rows += list(GroupObjectPermission.objects.filter(
            content_type=ct, object_pk__in=keys, group=group, permission__codename__in=perms,
        ).values_list("object_pk", "permission__codename"))
    out = {}
    for pk, codename in rows:
        out.setdefault(int(pk), set()).add(codename)
    return out


def _rest_names(path, outer, inner):
    """The names GeoServer's REST API lists at `path` ({outer: {inner: [{name}]}}, or "" when empty)."""
    r = requests.get(f"{ogc_server_settings.LOCATION.rstrip('/')}/rest/{path}",
                     auth=ogc_server_settings.credentials, headers={"Accept": "application/json"}, timeout=60)
    r.raise_for_status()
    listed = (r.json() or {}).get(outer) or {}
    items = (listed.get(inner) or []) if isinstance(listed, dict) else []
    return {i["name"] for i in items if isinstance(i, dict) and isinstance(i.get("name"), str)}


def _workspace_layers():
    """
    (coverages, feature types) of the geonode workspace: two GeoServer calls per page, whatever
    its size. They tell whether a dataset's GeoServer layer still exists (hasLayer) and of which
    kind (GeoNode labels a time-enabled coverage `vector_time`, like a time-enabled vector layer).
    """
    return (_rest_names(f"workspaces/{WORKSPACE}/coverages.json", "coverages", "coverage"),
            _rest_names(f"workspaces/{WORKSPACE}/featuretypes.json", "featureTypes", "featureType"))


def _layer_of(alternate, coverages, feature_types):
    """(hasLayer, layerType) of a resource; (None, None) outside the geonode workspace (not looked up)."""
    prefix = f"{WORKSPACE}:"
    if not (isinstance(alternate, str) and alternate.startswith(prefix)):
        return None, None
    name = alternate[len(prefix):]
    if name in coverages:
        return True, "coverage"
    if name in feature_types:
        return True, "featureType"
    return False, None


@require_http_methods(["GET"])
@require_bridge_token
def list_resources(request):
    """
    Every GeoNode resource (published or not) changed at or after `since`, PAGE_SIZE per page, with
    GeoNode's anonymous view/download permissions and, for the geonode workspace, whether GeoServer
    still has the layer (hasLayer) and its kind (layerType: coverage or featureType). A GeoServer
    that does not answer fails the page (502): the sync then rolls back and tries again.
    """
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
    anonymous = _anonymous_perms([r.pk for r in rows])
    coverages = feature_types = set()
    if any(isinstance(r.alternate, str) and r.alternate.startswith(f"{WORKSPACE}:") for r in rows):
        try:
            coverages, feature_types = _workspace_layers()
        except Exception:  # noqa: BLE001 - logged; a fixed message to the caller
            logger.exception("webatlas bridge: listing GeoServer's layers failed")
            return _error(502, "GeoServer không trả lời, chưa liệt kê được dữ liệu.")
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
        "anonymousView": _VIEW in anonymous.get(r.pk, ()),
        "anonymousDownload": _DOWNLOAD in anonymous.get(r.pk, ()),
        **dict(zip(("hasLayer", "layerType"), _layer_of(r.alternate, coverages, feature_types))),
        # GeoNode's processing state (PROCESSED, RUNNING, INVALID, ...): only PROCESSED is complete.
        "state": r.state,
        "bbox4326": list(r.ll_bbox_polygon.extent) if r.ll_bbox_polygon else None,
        "lastUpdated": r.last_updated.isoformat() if r.last_updated else None,
    } for r in rows]
    return JsonResponse({"resources": resources, "next": page + 1 if more else None})
