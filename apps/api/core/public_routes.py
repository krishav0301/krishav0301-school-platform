"""Every route that is open to anonymous users, listed in one place.

A test fails if a view allows anyone and is not listed here, so the public
surface can only grow through a reviewed change to this file.
"""

PUBLIC_ROUTES = frozenset(
    {
        "api/health/",
        "api/schema/",  # development only
    }
)
