from django.conf import settings
from django.urls import include, path

urlpatterns = [
    path("api/", include("core.urls")),
]

if settings.DEBUG:
    # The schema is served only in development. CI and client generation use
    # `manage.py spectacular`, so nothing exposes it in staging or production.
    from drf_spectacular.views import SpectacularAPIView

    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    ]
