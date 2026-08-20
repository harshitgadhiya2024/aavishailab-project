package posture

import "testing"

func b(v bool) *bool { return &v }

func TestAllControlsPass(t *testing.T) {
	r := Evaluate(Signals{
		DiskEncryption: b(true), Firewall: b(true), OSUpToDate: b(true),
		ScreenLock: b(true), Antivirus: b(true),
	}, 80, 50)
	if r.Score != 100 || r.Status != "pass" {
		t.Fatalf("expected 100/pass, got %d/%s", r.Score, r.Status)
	}
	if len(r.Failed) != 0 || len(r.Unknown) != 0 {
		t.Fatalf("expected no failures, got %+v", r)
	}
}

func TestDiskEncryptionOffDropsScore(t *testing.T) {
	r := Evaluate(Signals{
		DiskEncryption: b(false), Firewall: b(true), OSUpToDate: b(true),
		ScreenLock: b(true), Antivirus: b(true),
	}, 80, 50)
	if r.Score != 70 { // 100 - 30
		t.Fatalf("expected 70, got %d", r.Score)
	}
	if r.Status != "warn" {
		t.Fatalf("expected warn, got %s", r.Status)
	}
}

func TestUnknownIsHalfPenalty(t *testing.T) {
	r := Evaluate(Signals{
		DiskEncryption: nil, // unknown -> -15 (half of 30)
		Firewall:       b(true), OSUpToDate: b(true), ScreenLock: b(true), Antivirus: b(true),
	}, 80, 50)
	if r.Score != 85 {
		t.Fatalf("expected 85, got %d", r.Score)
	}
	if len(r.Unknown) != 1 || r.Unknown[0] != "disk_encryption" {
		t.Fatalf("expected disk_encryption unknown, got %+v", r.Unknown)
	}
}

func TestManyFailuresFail(t *testing.T) {
	r := Evaluate(Signals{
		DiskEncryption: b(false), Firewall: b(false), OSUpToDate: b(false),
		ScreenLock: b(true), Antivirus: b(true),
	}, 80, 50)
	// 100 - 30 - 20 - 20 = 30 -> fail
	if r.Score != 30 || r.Status != "fail" {
		t.Fatalf("expected 30/fail, got %d/%s", r.Score, r.Status)
	}
}

func TestScoreFloorsAtZero(t *testing.T) {
	r := Evaluate(Signals{
		DiskEncryption: b(false), Firewall: b(false), OSUpToDate: b(false),
		ScreenLock: b(false), Antivirus: b(false),
	}, 80, 50)
	if r.Score != 0 || r.Status != "fail" {
		t.Fatalf("expected 0/fail, got %d/%s", r.Score, r.Status)
	}
}

func TestWarnClampedBelowPass(t *testing.T) {
	// warn >= pass should be clamped so bands stay ordered.
	r := Evaluate(Signals{DiskEncryption: b(false), Firewall: b(true), OSUpToDate: b(true), ScreenLock: b(true), Antivirus: b(true)}, 60, 90)
	// score 70, pass=60 -> pass
	if r.Status != "pass" {
		t.Fatalf("expected pass, got %s", r.Status)
	}
}
