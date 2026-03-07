from datetime import datetime, timezone
from backend.services.clustering import should_cluster, haversine_km, type_similarity


def test_signals_within_threshold_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.345, 34.307, datetime(2026, 3, 4, 18, 23, tzinfo=timezone.utc), "STRIKE",
    )
    assert result is True


def test_signals_too_far_apart_dont_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.800, 34.700, datetime(2026, 3, 4, 18, 5, tzinfo=timezone.utc), "STRIKE",
    )
    assert result is False


def test_signals_too_old_dont_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.345, 34.307, datetime(2026, 3, 4, 21, 10, tzinfo=timezone.utc), "STRIKE",
    )
    assert result is False


def test_incompatible_types_dont_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "NAVAL",
        31.344, 34.306, datetime(2026, 3, 4, 18, 5, tzinfo=timezone.utc), "TROOP",
    )
    assert result is False


def test_strike_and_missile_cluster():
    result = should_cluster(
        31.343, 34.305, datetime(2026, 3, 4, 18, 3, tzinfo=timezone.utc), "STRIKE",
        31.344, 34.306, datetime(2026, 3, 4, 18, 10, tzinfo=timezone.utc), "MISSILE",
    )
    assert result is True


def test_haversine_known_distance():
    # Tel Aviv to Jerusalem — approximately 55km
    dist = haversine_km(32.0853, 34.7818, 31.7683, 35.2137)
    assert 50 < dist < 60
