package subscription

import (
	"errors"
	"testing"

	"github.com/aavishield/admin-api/internal/models"
)

func plan(key models.PlanType) models.PricingPlan {
	for _, p := range models.DefaultPricingPlans {
		if p.Key == key {
			return p
		}
	}
	panic("no plan " + key)
}

func TestComputeAnnualINRWithGST(t *testing.T) {
	q, err := Compute(plan(models.PlanProfessional), models.DefaultPricingSettings, 20, "yearly", "INR")
	if err != nil {
		t.Fatal(err)
	}
	// ₹3,599 per device per year × 20 = ₹71,980, + 18% GST ₹12,956.40.
	if q.Cycle != CycleAnnual || q.UnitMinor != 359900 || q.Subtotal != 7198000 || q.Tax != 1295640 || q.Total != 8493640 {
		t.Fatalf("annual quote wrong: %+v", q)
	}
	if q.Display != "₹84,936.40" {
		t.Fatalf("display = %q", q.Display)
	}
}

func TestComputeMonthlyAddsUplift(t *testing.T) {
	q, err := Compute(plan(models.PlanProfessional), models.DefaultPricingSettings, 20, "monthly", "INR")
	if err != nil {
		t.Fatal(err)
	}
	// ₹3,599 / 12 × 1.2 = ₹359.90 per device per month.
	if q.UnitMinor != 35990 || q.Subtotal != 719800 || q.Total != 849364 {
		t.Fatalf("monthly quote wrong: %+v", q)
	}
}

func TestComputeUSDHasNoGST(t *testing.T) {
	q, err := Compute(plan(models.PlanStarter), models.DefaultPricingSettings, 10, "annual", "usd")
	if err != nil {
		t.Fatal(err)
	}
	if q.Currency != "USD" || q.Tax != 0 || q.Total != 39000 || q.Display != "$390.00" {
		t.Fatalf("usd quote wrong: %+v", q)
	}
}

func TestComputeRejects(t *testing.T) {
	if _, err := Compute(plan(models.PlanStarter), models.DefaultPricingSettings, 5, "annual", "INR"); !errors.Is(err, ErrSeats) {
		t.Errorf("below minimum: %v", err)
	}
	if _, err := Compute(plan(models.PlanStarter), models.DefaultPricingSettings, 51, "annual", "INR"); !errors.Is(err, ErrSeats) {
		t.Errorf("above maximum: %v", err)
	}
	if _, err := Compute(plan(models.PlanEnterprise), models.DefaultPricingSettings, 60, "annual", "INR"); !errors.Is(err, ErrPlan) {
		t.Errorf("enterprise: %v", err)
	}
}

func TestPlanKey(t *testing.T) {
	cases := map[string]models.PlanType{"Essentials": models.PlanStarter, "business": models.PlanProfessional, "starter": models.PlanStarter}
	for in, want := range cases {
		if got, ok := PlanKey(in); !ok || got != want {
			t.Errorf("PlanKey(%q) = %q, %v", in, got, ok)
		}
	}
	if _, ok := PlanKey("enterprise"); ok {
		t.Error("enterprise must not be self-serve")
	}
}

func TestFormatMoney(t *testing.T) {
	cases := map[string]string{
		FormatMoney(12345678, "INR"):  "₹1,23,456.78",
		FormatMoney(99900, "INR"):     "₹999.00",
		FormatMoney(123456789, "USD"): "$1,234,567.89",
		FormatMoney(5, "USD"):         "$0.05",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("got %q want %q", got, want)
		}
	}
}
