package handlers

import "testing"

// The manifest production has today: one release covering all three.
func legacyManifest() packageManifest {
	return packageManifest{
		Version: "2.9.5",
		Artifacts: map[string]string{
			"macos":   "aavishield-agent-rust-2.9.5.pkg",
			"windows": "aavishield-agent-rust-2.9.5.msi",
			"linux":   "aavishield-agent-rust-2.9.5-amd64.deb",
		},
	}
}

func TestLegacyManifestGivesEveryPlatformTheSingleVersion(t *testing.T) {
	m := legacyManifest()
	for _, p := range []string{"macos", "windows", "linux"} {
		if got := m.versionFor(p); got != "2.9.5" {
			t.Errorf("%s = %q, want 2.9.5", p, got)
		}
	}
	if got := (packageManifest{Version: "2.9.5"}).versionFor("macos"); got != "" {
		t.Errorf("a platform with nothing published has no version, got %q", got)
	}
}

// Publishing Windows must leave macOS exactly where it was — the whole
// point of per-platform releases.
func TestPublishingOnePlatformLeavesTheOthersAlone(t *testing.T) {
	m := legacyManifest()
	m.setPlatform("windows", "2.9.6", "aavishield-agent-2.9.6.msi")

	want := map[string]string{"macos": "2.9.5", "windows": "2.9.6", "linux": "2.9.5"}
	for p, v := range want {
		if got := m.versionFor(p); got != v {
			t.Errorf("%s = %q, want %q", p, got, v)
		}
	}
	if m.Artifacts["macos"] != "aavishield-agent-rust-2.9.5.pkg" {
		t.Errorf("macOS artifact moved: %q", m.Artifacts["macos"])
	}
	if m.Version != "2.9.6" {
		t.Errorf("legacy version = %q, want the highest (2.9.6)", m.Version)
	}

	// A rollback lowers only that platform, and the legacy field follows.
	m.setPlatform("windows", "2.9.5", "aavishield-agent-rust-2.9.5.msi")
	if m.versionFor("windows") != "2.9.5" || m.Version != "2.9.5" {
		t.Errorf("after rollback: windows=%q legacy=%q", m.versionFor("windows"), m.Version)
	}
}

func TestPlatformForOS(t *testing.T) {
	cases := map[string]string{"darwin": "macos", "windows": "windows", "linux": "linux", "": "", "freebsd": ""}
	for in, want := range cases {
		if got := platformForOS(in); got != want {
			t.Errorf("platformForOS(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPackageFilenamesParseWithAndWithoutRustPrefix(t *testing.T) {
	cases := []struct{ name, platform, version string }{
		{"aavishield-agent-2.9.6.pkg", "macos", "2.9.6"},
		{"aavishield-agent-rust-2.9.5.pkg", "macos", "2.9.5"},
		{"aavishield-agent-2.9.6.msi", "windows", "2.9.6"},
		{"aavishield-agent-2.9.6-amd64.deb", "linux", "2.9.6"},
		{"aavishield-agent-rust-2.9.5-amd64.deb", "linux", "2.9.5"},
	}
	for _, c := range cases {
		p, v, ok := filenamePlatformVersion(c.name)
		if !ok || p != c.platform || v != c.version {
			t.Errorf("%s -> (%q, %q, %v), want (%q, %q)", c.name, p, v, ok, c.platform, c.version)
		}
	}
}
