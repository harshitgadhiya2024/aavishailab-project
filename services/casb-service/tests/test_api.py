from tests.conftest import ORG_A, ORG_B


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["service"] == "casb-service"


def test_app_control_block(client, token):
    body = {"org_id": ORG_A, "app": "Random", "category": "file_transfer", "activity": "upload", "sanctioned": False}
    r = client.post("/v1/app-control", json=body, headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 200
    assert r.json()["action"] == "block"


def test_app_control_auth_required(client):
    r = client.post("/v1/app-control", json={"org_id": ORG_A, "activity": "upload"})
    assert r.status_code == 401


def test_app_control_wrong_org(client, token):
    r = client.post("/v1/app-control", json={"org_id": ORG_A, "activity": "upload"},
                    headers={"Authorization": f"Bearer {token(ORG_B)}"})
    assert r.status_code == 401


def test_oob_analyze(client, token):
    body = {
        "org_id": ORG_A,
        "provider": "manual",
        "files": [
            {"name": "Salary 2026.xlsx", "share_type": "public"},
            {"name": "readme.txt", "share_type": "private"},
            {"name": "NDA-Acme.pdf", "share_type": "external", "external_domains": ["acme.com"]},
        ],
    }
    r = client.post("/v1/oob/analyze", json=body, headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 200
    j = r.json()
    assert j["scanned"] == 3
    assert j["counts"]["high"] == 2
    assert j["findings"][0]["severity"] == "high"


def test_oob_real_provider_400(client, token):
    r = client.post("/v1/oob/analyze", json={"org_id": ORG_A, "provider": "m365"},
                    headers={"Authorization": f"Bearer {token(ORG_A)}"})
    assert r.status_code == 400
    assert "OAuth" in r.json()["detail"]


def test_metrics_is_plain_text_not_json_encoded(client):
    r = client.get("/metrics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    body = r.text
    assert not body.strip().startswith('"')
    assert "\\n" not in body
    assert "casb_app_control_total" in body
