from django.db import DatabaseError, connection, transaction
from django.utils.decorators import method_decorator
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok", "degraded"])
    database = serializers.ChoiceField(choices=["ok", "down"])


# ATOMIC_REQUESTS opens a transaction before the view runs. If the database is
# down that would fail first and turn our clean 503 into a 500, so the health
# check opts out and reports the failure itself.
@method_decorator(transaction.non_atomic_requests, name="dispatch")
class HealthView(APIView):
    """Liveness and database check for uptime monitoring. Reveals nothing else."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(
        operation_id="health_check",
        responses={200: HealthSerializer, 503: HealthSerializer},
    )
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except DatabaseError:
            return Response(
                {"status": "degraded", "database": "down"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response({"status": "ok", "database": "ok"})
