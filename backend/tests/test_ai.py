from unittest.mock import patch, MagicMock
import json
import os
import pytest


def test_returns_all_required_fields_no_key():
    os.environ.pop("ANTHROPIC_API_KEY", None)
    from backend.services.ai_analysis import get_analysis
    result = get_analysis("EVT-2026-000001", [
        {"source": "Reuters", "source_category": "WESTERN", "description": "Strike hit military depot"},
        {"source": "RT", "source_category": "RUSSIAN", "description": "Strike hit civilian building"},
    ])
    for key in ["what_is_confirmed", "what_is_disputed", "where_information_goes_dark",
                "core_disagreement", "divergence_score", "coordinated_messaging_suspected"]:
        assert key in result, f"Missing key: {key}"
    assert 0.0 <= result["divergence_score"] <= 1.0
    assert isinstance(result["coordinated_messaging_suspected"], bool)


def test_real_api_called_when_key_present():
    os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-fake"
    mock_text = json.dumps({
        "what_is_confirmed": "confirmed",
        "what_is_disputed": "disputed",
        "where_information_goes_dark": "dark",
        "core_disagreement": "disagree",
        "divergence_score": 0.5,
        "coordinated_messaging_suspected": False,
    })
    mock_client = MagicMock()
    mock_resp = MagicMock()
    mock_resp.content = [MagicMock(text=mock_text)]
    mock_client.messages.create.return_value = mock_resp

    import importlib
    import backend.services.ai_analysis as ai_mod
    with patch.object(ai_mod, 'Anthropic', return_value=mock_client):
        result = ai_mod._real_analysis("EVT-2026-000001", [
            {"source": "Reuters", "source_category": "WESTERN", "description": "Strike confirmed"},
        ], "sk-ant-test-fake")

    mock_client.messages.create.assert_called_once()
    assert result["what_is_confirmed"] == "confirmed"
    os.environ.pop("ANTHROPIC_API_KEY", None)


def test_divergence_higher_with_more_source_categories():
    os.environ.pop("ANTHROPIC_API_KEY", None)
    from backend.services.ai_analysis import get_analysis
    single = get_analysis("EVT-A", [
        {"source": "Reuters", "source_category": "WESTERN", "description": "A"},
        {"source": "AP", "source_category": "WESTERN", "description": "B"},
    ])
    multi = get_analysis("EVT-B", [
        {"source": "Reuters", "source_category": "WESTERN", "description": "A"},
        {"source": "RT", "source_category": "RUSSIAN", "description": "B"},
        {"source": "Al Jazeera", "source_category": "MIDDLE_EAST", "description": "C"},
        {"source": "Bellingcat", "source_category": "OSINT", "description": "D"},
    ])
    assert multi["divergence_score"] > single["divergence_score"]


def test_404_for_unknown_event(test_client):
    resp = test_client.get("/events/EVT-DOES-NOT-EXIST/analysis")
    assert resp.status_code == 404
