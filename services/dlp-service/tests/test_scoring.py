"""Tests for the weighted scoring + banding — the >80 block / 50-80 alert
requirement lives here."""

from app import detectors as d
from app import scoring
from tests.conftest import valid_aadhaar

ALL_DETECTORS = [
    d.CREDIT_CARD, d.PAN_INDIA, d.AADHAAR, d.AWS_KEY,
    d.GITHUB_TOKEN, d.GENERIC_API_KEY, d.SOURCE_CODE,
]

CARD = "4242424242424242"
AWS = "AKIAIOSFODNN7EXAMPLE"


def policy(**kw) -> scoring.Policy:
    kw.setdefault("name", "Default DLP")
    kw.setdefault("action", "block")
    kw.setdefault("detectors", ALL_DETECTORS)
    return scoring.Policy(**kw)


def scan_text(text, filename="upload.txt", content_type="text/plain", policies=None):
    policies = policies or [policy()]
    return scoring.scan(policies, text, filename, content_type)


def test_clean_content_allows():
    r = scan_text("just a normal message with no secrets")
    assert not r.matched
    assert r.band == "allow"
    assert r.action == "allow"
    assert r.score == 0


def test_single_credit_card_alerts():
    r = scan_text(f"my card is {CARD}")
    assert r.score == 55
    assert r.band == "alert"
    assert r.action == "alert"


def test_single_aws_key_blocks():
    r = scan_text(f"aws secret {AWS}")
    assert r.score == 85
    assert r.band == "block"
    assert r.action == "block"


def test_single_generic_key_alerts():
    r = scan_text("api_key: 'aB3xZ9qL2mV8kP1nQ'")
    assert r.score == 70
    assert r.band == "alert"


def test_two_credit_cards_still_alert():
    # 55 + 0.4*55 = 77 -> alert band
    r = scan_text(f"{CARD} and 4000056655665556")
    assert r.score == 77
    assert r.band == "alert"


def test_three_credit_cards_block():
    # 55 + 0.4*(55+55) = 99 -> block band
    r = scan_text(f"{CARD} 4000056655665556 5555555555554444")
    assert r.score == 99
    assert r.band == "block"


def test_aggregate_caps_at_100():
    r = scan_text(f"{AWS} AKIA1234567890ABCDEF")  # two AWS-shaped
    assert r.score == 100


def test_context_bonus_structured_plus_keyword():
    # card(55) + keyword(25): 55 + 0.4*25 + 10(context) = 75 -> alert
    r = scan_text(f"salary {CARD}", policies=[policy(keywords=["salary"])])
    assert r.score == 75
    assert r.band == "alert"


def test_aadhaar_scores_alert():
    r = scan_text(f"aadhaar {valid_aadhaar()}")
    assert r.score == 55
    assert r.band == "alert"


def test_file_type_bypass_allows():
    r = scan_text(CARD, filename="photo.png", content_type="image/png",
                  policies=[policy(bypass_file_types=["image"])])
    assert not r.matched
    assert r.action == "allow"


def test_alert_only_policy_never_blocks():
    # AWS key scores 85 (block band) but the policy's ceiling is alert.
    r = scan_text(AWS, policies=[policy(action="alert")])
    assert r.band == "block"
    assert r.action == "alert"


def test_log_only_policy_downgrades_to_log():
    r = scan_text(AWS, policies=[policy(action="log")])
    assert r.action == "log"


def test_per_org_threshold_override():
    # Lower the block threshold so a single card (55) now blocks.
    r = scan_text(CARD, policies=[policy(block_threshold=50, alert_threshold=25)])
    assert r.score == 55
    assert r.band == "block"


def test_alert_threshold_above_block_is_clamped():
    p = policy(block_threshold=60, alert_threshold=90)
    block, alert = p.thresholds()
    assert alert < block


def test_most_severe_policy_wins():
    p_alert = policy(name="loose", action="alert", detectors=[d.CREDIT_CARD])
    p_block = policy(name="strict", action="block", detectors=[d.AWS_KEY])
    r = scoring.scan([p_alert, p_block], f"{CARD} {AWS}", "u.txt", "text/plain")
    assert r.action == "block"  # the blocking policy wins over the alerting one


def test_detector_weight_override():
    # Bump keyword weight so a single keyword blocks.
    r = scan_text("confidential",
                  policies=[policy(detectors=[], keywords=["confidential"],
                                   detector_weights={"keyword": 90})])
    assert r.score == 90
    assert r.band == "block"
