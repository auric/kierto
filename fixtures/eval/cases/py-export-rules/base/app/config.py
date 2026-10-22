"""Settings. A tenant can override a setting. The environment gives the default."""

import os

_TENANT_OVERRIDES: dict[str, dict[str, str]] = {}
_current_tenant = "default"


def set_tenant(tenant: str, overrides: dict[str, str] | None = None) -> None:
    global _current_tenant
    _current_tenant = tenant
    if overrides is not None:
        _TENANT_OVERRIDES[tenant] = dict(overrides)


def get_setting(name: str, default: str | None = None) -> str | None:
    tenant = _TENANT_OVERRIDES.get(_current_tenant, {})
    if name in tenant:
        return tenant[name]
    return os.environ.get(name, default)
