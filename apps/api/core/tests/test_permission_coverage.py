"""Guards the rule: every route declares its permissions, deny by default."""

from django.urls import get_resolver, path
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView

from core.permissions import DenyByDefault
from core.public_routes import PUBLIC_ROUTES


def iter_routes(patterns, prefix=""):
    for entry in patterns:
        if hasattr(entry, "url_patterns"):
            yield from iter_routes(entry.url_patterns, prefix + str(entry.pattern))
        else:
            yield prefix + str(entry.pattern), entry.callback


def find_offenders(patterns):
    """Routes whose view inherited the default, or is open to all but not listed."""
    offenders = []
    for route, callback in iter_routes(patterns):
        view_class = getattr(callback, "cls", None)
        if view_class is None:
            continue
        classes = list(view_class.permission_classes)
        if DenyByDefault in classes:
            offenders.append((route, "did not declare permission_classes"))
        elif AllowAny in classes and route not in PUBLIC_ROUTES:
            offenders.append((route, "is open to everyone but not in PUBLIC_ROUTES"))
    return offenders


def test_every_real_route_declares_its_permissions():
    assert find_offenders(get_resolver().url_patterns) == []


def test_detector_flags_a_view_that_forgot_to_declare_permissions():
    class Forgetful(APIView):
        def get(self, request):  # pragma: no cover
            ...

    offenders = find_offenders([path("forgetful/", Forgetful.as_view())])

    assert [route for route, _ in offenders] == ["forgetful/"]


def test_detector_flags_an_open_view_that_is_not_listed():
    class Open(APIView):
        permission_classes = [AllowAny]

        def get(self, request):  # pragma: no cover
            ...

    offenders = find_offenders([path("open/", Open.as_view())])

    assert [route for route, _ in offenders] == ["open/"]


def test_detector_accepts_a_view_that_declares_real_permissions():
    class Guarded(APIView):
        permission_classes = [IsAuthenticated]

        def get(self, request):  # pragma: no cover
            ...

    assert find_offenders([path("guarded/", Guarded.as_view())]) == []


def test_a_view_that_forgets_permissions_is_actually_denied():
    class Forgetful(APIView):
        def get(self, request):
            return None  # never reached

    request = APIRequestFactory().get("/forgetful/")
    response = Forgetful.as_view()(request)

    assert response.status_code == 403
