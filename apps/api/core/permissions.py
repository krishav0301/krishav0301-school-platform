"""Permission building blocks.

Phase 1 adds the role + action + scope layer here. Until then the only rule is
the default: a view that does not declare its permissions is denied.
"""

from rest_framework.permissions import BasePermission


class DenyByDefault(BasePermission):
    """Default for every view. Inheriting it means a view forgot to declare access."""

    def has_permission(self, request, view) -> bool:
        return False
