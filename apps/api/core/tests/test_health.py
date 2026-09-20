from django.db import OperationalError
from rest_framework.test import APIClient


class BrokenConnection:
    """Stands in for the connection the health view uses, and only that one."""

    def cursor(self):
        raise OperationalError("database is down")


def test_health_reports_ok_to_anonymous_users(db):
    response = APIClient().get("/api/health/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_a_missing_trailing_slash_is_a_404_not_a_redirect(db):
    response = APIClient().get("/api/health")

    assert response.status_code == 404
    assert "Location" not in response.headers


def test_health_reports_a_database_failure_as_503(monkeypatch):
    monkeypatch.setattr("core.api.connection", BrokenConnection())

    response = APIClient().get("/api/health/")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database": "down"}
