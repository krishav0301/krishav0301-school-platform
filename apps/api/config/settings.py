"""Django settings.

Every environment-specific value comes from the environment (or a local,
git-ignored .env file). Nothing here names a school.
"""

from pathlib import Path

import environ

from core.environment import validate_environment

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    environ.Env.read_env(_env_file)

ENV = env.str("ENV", default="development")
DEMO_MODE = env.bool("DEMO_MODE", default=False)
validate_environment(ENV, DEMO_MODE)

DEBUG = ENV == "development"
SECRET_KEY = env.str("SECRET_KEY")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "drf_spectacular",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

# API only: a missing trailing slash is a 404, never a redirect. Redirects are
# cached permanently by browsers, and a redirected POST loses its body. The web
# app's proxy adds the slash (see apps/web/next.config.ts).
APPEND_SLASH = False
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# PostgreSQL only, in every environment. Requests run in a transaction so a
# failed request never leaves a half-written state. Services that need finer
# control (background jobs, outbox) open their own transactions.
DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["ATOMIC_REQUESTS"] = True
DATABASES["default"]["CONN_MAX_AGE"] = 60
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Timestamps are stored in UTC and shown in Nepal time (UTC+5:45).
USE_TZ = True
TIME_ZONE = "Asia/Kathmandu"
LANGUAGE_CODE = "en"
USE_I18N = True

# Cookies: same-site, because the web app and the API share one domain.
# The browser talks to the web app's origin, which proxies to Django, so Django
# sees the proxy's host. List the web origin(s) explicitly. Do not use
# USE_X_FORWARDED_HOST: Django is also reachable directly, so that header could
# be spoofed.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
X_FRAME_OPTIONS = "DENY"

if ENV in {"staging", "production"}:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    # Start modest. Raise once every subdomain is confirmed HTTPS-only.
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    # Deny by default. A view must declare its own permission_classes.
    "DEFAULT_PERMISSION_CLASSES": ["core.permissions.DenyByDefault"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "School Platform API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # Pin the prefix. Left automatic, it is the common prefix of whatever routes
    # exist, so the generated tags changed between development (which has an
    # extra schema route) and CI.
    "SCHEMA_PATH_PREFIX": "/api/",
    "SERVE_PERMISSIONS": ["rest_framework.permissions.AllowAny"],
}
