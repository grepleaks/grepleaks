# Host access

Docker gives Grepleaks Linux tools; it does not turn macOS or Windows into Linux.

| Resource | Available access |
| --- | --- |
| Engagement files | `--workspace DIRECTORY`, read-write at `/engagement` |
| Home directory | `--host-access`, read-write at `/host` |
| Another directory/shared root | `GREPLEAKS_HOST_ROOT=/path ./grepleaks --host-access` |
| Host network services | `host.docker.internal`, subject to service binding/firewall |
| macOS processes/kernel | Not exposed by a Linux container |
| Raw host Wi-Fi/USB | Not generally passed through the macOS/Windows Linux VM |
| Docker daemon socket | Deliberately not mounted; it grants control over Docker |

For an entire root on a host/VM that shares it:

```bash
GREPLEAKS_HOST_ROOT=/ ./grepleaks --host-access
```

This exposes everything Docker can mount from that root, read-write. On macOS with
Colima, only configured VM shares are accessible: `/` in the VM is not proof that
the Mac's root is exposed. Prefer an explicit shared path and verify a known file
under `/host` before relying on it. Do not alter global Docker/Colima sharing or
macOS privacy permissions automatically.

The launcher uses Docker `--mount`, which rejects unavailable source paths rather
than silently creating them. Paths containing commas are rejected because Docker
uses commas as mount separators. Symlinks outside the shared directory may not
resolve inside the container.

No `--privileged`, host PID namespace, Docker socket, or automatic sudo is required
for ordinary shared-file access. These settings would broaden control without
solving macOS VM hardware limitations. Tool-specific network/hardware access should
be configured explicitly for the engagement and platform.
