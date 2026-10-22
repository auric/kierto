# Plugins

Plugins are shared objects that the host loads with `dlopen`. Third parties build them with their own compiler and release them on their own schedule, so a plugin often runs against a newer engine than the one it was built with.

A plugin checks `engine_abi_version() == ENGINE_ABI_VERSION` when it loads and refuses to run on a mismatch.
