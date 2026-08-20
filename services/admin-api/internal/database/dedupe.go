package database

import (
	"log"

	"github.com/aavishield/admin-api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// DedupeDevices merges duplicate Device rows left over from before Enroll
// started reusing an existing row on re-enrollment (same MAC re-registering,
// or same hostname+employee when no MAC was reported). For each duplicate
// group it keeps the most recently seen row and removes the rest, revoking
// their agent tokens and correcting the owning employee's device_count.
// Runs on every boot; it's a no-op once no duplicates remain.
func DedupeDevices(db *gorm.DB) error {
	if err := dedupeByMAC(db); err != nil {
		return err
	}
	return dedupeByHostname(db)
}

func dedupeByMAC(db *gorm.DB) error {
	type key struct {
		OrgID      uuid.UUID
		MACAddress string
	}
	var keys []key
	if err := db.Model(&models.Device{}).
		Select("org_id, mac_address").
		Where("mac_address <> ''").
		Group("org_id, mac_address").
		Having("COUNT(*) > 1").
		Scan(&keys).Error; err != nil {
		return err
	}

	for _, k := range keys {
		mergeDeviceGroup(db, db.Where("org_id = ? AND mac_address = ?", k.OrgID, k.MACAddress))
	}
	return nil
}

func dedupeByHostname(db *gorm.DB) error {
	type key struct {
		OrgID      uuid.UUID
		EmployeeID uuid.UUID
		Hostname   string
	}
	var keys []key
	if err := db.Model(&models.Device{}).
		Select("org_id, employee_id, hostname").
		Where("mac_address = '' AND employee_id IS NOT NULL").
		Group("org_id, employee_id, hostname").
		Having("COUNT(*) > 1").
		Scan(&keys).Error; err != nil {
		return err
	}

	for _, k := range keys {
		mergeDeviceGroup(db, db.Where("org_id = ? AND employee_id = ? AND hostname = ? AND mac_address = ''", k.OrgID, k.EmployeeID, k.Hostname))
	}
	return nil
}

// mergeDeviceGroup keeps the most recently seen device in scope and deletes
// the rest, along with their agent tokens.
func mergeDeviceGroup(db *gorm.DB, scope *gorm.DB) {
	var devices []models.Device
	scope.Order("last_seen_at DESC NULLS LAST, created_at DESC").Find(&devices)
	if len(devices) < 2 {
		return
	}

	keep := devices[0]
	dupIDs := make([]uuid.UUID, 0, len(devices)-1)
	empCounts := map[uuid.UUID]int{}
	for _, d := range devices[1:] {
		dupIDs = append(dupIDs, d.ID)
		if d.EmployeeID != nil {
			empCounts[*d.EmployeeID]++
		}
	}
	if len(dupIDs) == 0 {
		return
	}

	db.Where("device_id IN ?", dupIDs).Delete(&models.AgentToken{})
	db.Where("id IN ?", dupIDs).Delete(&models.Device{})
	for empID, n := range empCounts {
		db.Model(&models.Employee{}).
			Where("id = ? AND device_count >= ?", empID, n).
			UpdateColumn("device_count", gorm.Expr("device_count - ?", n))
	}

	log.Printf("🧹 merged %d duplicate device row(s) into %q (%s)", len(dupIDs), keep.Hostname, keep.ID)
}
