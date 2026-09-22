"""Software inventory — the collector that answers "what did this employee
install", which nothing in the platform could answer before.

These cover the parsing and shaping that is safe to exercise on a headless
Linux box. The per-OS enumeration itself (registry walk, .app bundles,
package managers) needs a real machine and is out of scope here, same as the
rest of this suite.
"""

from conftest import agent


def _collector():
    return agent.InventoryCollector({"admin_url": "https://example.invalid", "token": "t"})


def test_windows_rows_are_parsed_from_json():
    raw = (
        '[{"name":"Visual Studio Code","version":"1.85.0","vendor":"Microsoft",'
        '"identifier":"{ABC-123}","install_path":"C:\\\\Program Files\\\\VS Code",'
        '"installed_at":"20240115"}]'
    )
    apps = agent.InventoryCollector._from_json(raw, "registry")
    assert len(apps) == 1
    assert apps[0]["name"] == "Visual Studio Code"
    assert apps[0]["version"] == "1.85.0"
    assert apps[0]["source"] == "registry"


def test_single_result_comes_back_as_an_object_not_a_list():
    """PowerShell's ConvertTo-Json emits a bare object when there is exactly
    one result — a real case on a nearly-empty machine, and one that would
    otherwise silently collect nothing."""
    raw = '{"name":"Solo App","version":"1.0","vendor":"","identifier":"x","install_path":"","installed_at":""}'
    apps = agent.InventoryCollector._from_json(raw, "registry")
    assert len(apps) == 1
    assert apps[0]["name"] == "Solo App"


def test_nameless_rows_are_dropped():
    """A nameless row would render as an empty cell in the dashboard table."""
    raw = '[{"name":"","version":"1"},{"name":"   ","version":"1"},{"name":"Real","version":"1"}]'
    apps = agent.InventoryCollector._from_json(raw, "registry")
    assert [a["name"] for a in apps] == ["Real"]


def test_unparseable_output_yields_nothing_rather_than_raising():
    """A collector that throws would kill the thread it runs on, taking
    inventory down until the agent restarts."""
    assert agent.InventoryCollector._from_json("not json at all", "registry") == []
    assert agent.InventoryCollector._from_json("", "registry") == []


def test_missing_fields_become_empty_strings_not_none():
    """The payload is JSON-serialised straight to the server, which expects
    strings; a None would fail binding on the Go side."""
    apps = agent.InventoryCollector._from_json('[{"name":"Bare"}]', "path")
    assert apps[0]["version"] == ""
    assert apps[0]["vendor"] == ""
    assert apps[0]["identifier"] == ""
    assert apps[0]["installed_at"] == ""


def test_manual_binaries_are_found_in_user_bin_directories(tmp_path, monkeypatch):
    """The case a package database can never see: a binary someone downloaded
    into their own bin directory."""
    binaries = tmp_path / ".local" / "bin"
    binaries.mkdir(parents=True)
    tool = binaries / "codex"
    tool.write_text("#!/bin/sh\necho hi\n")
    tool.chmod(0o755)
    (binaries / "notes.txt").write_text("not executable")

    monkeypatch.setenv("HOME", str(tmp_path))
    found = _collector()._unix_manual_binaries()

    names = [a["name"] for a in found]
    assert "codex" in names
    assert "notes.txt" not in names, "a non-executable file is not an installed application"
    entry = next(a for a in found if a["name"] == "codex")
    assert entry["source"] == "path"
    assert entry["install_path"].endswith("/codex")


def test_symlinks_are_skipped(tmp_path, monkeypatch):
    """A symlink in a bin directory is almost always a package manager's shim
    pointing at something already reported by name."""
    binaries = tmp_path / "bin"
    binaries.mkdir(parents=True)
    real = binaries / "realtool"
    real.write_text("#!/bin/sh\n")
    real.chmod(0o755)
    (binaries / "shim").symlink_to(real)

    monkeypatch.setenv("HOME", str(tmp_path))
    names = [a["name"] for a in _collector()._unix_manual_binaries()]
    assert "realtool" in names
    assert "shim" not in names
