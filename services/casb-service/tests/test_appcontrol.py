from app import appcontrol


def ev(**kw):
    rules = kw.pop("rules", None)
    return appcontrol.evaluate(appcontrol.Request(**kw), rules)


def test_upload_to_unreviewed_app_alerts_not_blocks():
    # "Unsanctioned" only means nobody reviewed it yet — that alone must not
    # stop an employee's upload, or the product breaks work on day one.
    d = ev(app="RandomApp", category="cloud_storage", activity="upload", sanctioned=False)
    assert d.action == "alert"


def test_upload_to_high_risk_unsanctioned_blocks():
    d = ev(app="Sketchy", category="cloud_storage", activity="upload", sanctioned=False, risk_score=75)
    assert d.action == "block"


def test_org_rule_can_restore_strict_blocking():
    # A company that wants the strict posture expresses it as its own rule.
    rules = [appcontrol.Rule(sanctioned=False, activity="upload", action="block",
                             name="Block uploads to unsanctioned apps")]
    d = ev(app="RandomApp", category="cloud_storage", activity="upload", sanctioned=False, rules=rules)
    assert d.action == "block"
    assert d.matched_rule == "Block uploads to unsanctioned apps"


def test_upload_to_file_transfer_blocks():
    d = ev(app="WeTransfer", category="file_transfer", activity="upload", sanctioned=True)
    assert d.action == "block"


def test_upload_to_ai_tool_alerts():
    d = ev(app="ChatGPT", category="ai_tools", activity="upload", sanctioned=True)
    assert d.action == "alert"


def test_post_to_ai_tool_alerts():
    d = ev(app="Claude", category="ai_tools", activity="post", sanctioned=True)
    assert d.action == "alert"


def test_download_from_sanctioned_allows():
    d = ev(app="Google Drive", category="cloud_storage", activity="download", sanctioned=True)
    assert d.action == "allow"


def test_high_risk_unsanctioned_alerts():
    d = ev(app="Sketchy", category="social_media", activity="login", sanctioned=False, risk_score=70)
    assert d.action == "alert"


def test_org_rule_overrides_default():
    # Org explicitly allows uploads to a sanctioned file-transfer app, which
    # would otherwise be blocked by the default.
    rules = [appcontrol.Rule(app="Box", activity="upload", action="allow", name="Allow Box uploads")]
    d = ev(app="Box", category="file_transfer", activity="upload", sanctioned=True, rules=rules)
    assert d.action == "allow"
    assert d.matched_rule == "Allow Box uploads"


def test_no_match_allows():
    d = ev(app="Slack", category="communication", activity="download", sanctioned=True)
    assert d.action == "allow"
