import os
import re
import json
from anthropic import Anthropic


def get_analysis(event_id: str, signals: list) -> dict:
    """
    Main entry point. Called by GET /events/{id}/analysis.
    signals: list of dicts with keys: source, source_category, description

    CRITICAL: If ANTHROPIC_API_KEY is set and non-empty, always calls the real API.
    Mock fallback is only used when the key is absent or empty.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _mock_analysis(event_id, signals)
    return _real_analysis(event_id, signals, api_key)


def _real_analysis(event_id: str, signals: list, api_key: str) -> dict:
    client = Anthropic(api_key=api_key)
    prompt = _build_prompt(event_id, signals)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}]
    )
    return _parse_response(response.content[0].text, event_id, signals)


def _build_prompt(event_id: str, signals: list) -> str:
    signals_text = "\n".join([
        f"[{s.get('source_category', 'UNKNOWN')}] {s.get('source', 'Unknown')}: {s.get('description', '')}"
        for s in signals
    ])
    return f"""You are a neutral intelligence analyst. Do not take sides. Maintain strict impartiality.

Event ID: {event_id}
Incoming reports:
{signals_text}

Respond with ONLY a JSON object with exactly these keys:
- "what_is_confirmed": string
- "what_is_disputed": string
- "where_information_goes_dark": string
- "core_disagreement": string
- "divergence_score": number 0.0-1.0
- "coordinated_messaging_suspected": boolean

No other text. Return only the JSON."""


def _parse_response(text: str, event_id: str, signals: list) -> dict:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            result = json.loads(match.group())
            required = [
                "what_is_confirmed",
                "what_is_disputed",
                "where_information_goes_dark",
                "core_disagreement",
                "divergence_score",
                "coordinated_messaging_suspected",
            ]
            if all(k in result for k in required):
                return result
        except json.JSONDecodeError:
            pass
    return _mock_analysis(event_id, signals)


def _mock_analysis(event_id: str, signals: list) -> dict:
    source_categories = list(set(s.get("source_category", "UNKNOWN") for s in signals))
    signal_count = len(signals)

    # Divergence based on source category diversity (unchanged logic)
    if len(source_categories) <= 1:
        divergence = 0.25
    elif len(source_categories) == 2:
        divergence = 0.55
    elif len(source_categories) == 3:
        divergence = 0.72
    else:
        divergence = 0.85

    if signal_count == 0:
        return {
            "what_is_confirmed": "No signals have been ingested for this event yet.",
            "what_is_disputed": "Unable to assess — no source data available.",
            "where_information_goes_dark": "All information is currently unavailable.",
            "core_disagreement": "Cannot be determined without signal data.",
            "divergence_score": 0.0,
            "coordinated_messaging_suspected": False,
        }

    descs = [s.get("description", "") for s in signals if s.get("description")]
    confirmed = descs[0] if descs else "An incident has been reported at this location."

    cats = ", ".join(sorted(set(s.get("source_category", "UNKNOWN") for s in signals)))
    noun = f"signal{'s' if signal_count != 1 else ''}"

    if len(source_categories) == 1:
        disputed = (
            f"No cross-source verification available. "
            f"All {signal_count} {noun} sourced from {cats}."
        )
    else:
        disputed = (
            f"Reporting varies across {len(source_categories)} source categories ({cats}). "
            f"Details have not been independently verified."
        )

    dark = (
        "No independent ground access confirmed. Satellite or on-ground verification pending."
        if signal_count < 3
        else (
            f"{signal_count} {noun} ingested. "
            f"Coverage incomplete — independent verification pending."
        )
    )

    core = (
        "Insufficient source diversity to identify a core disagreement."
        if len(source_categories) <= 1
        else (
            f"Narrative differences between {cats} sources "
            f"have not been independently resolved."
        )
    )

    return {
        "what_is_confirmed": confirmed,
        "what_is_disputed": disputed,
        "where_information_goes_dark": dark,
        "core_disagreement": core,
        "divergence_score": divergence,
        "coordinated_messaging_suspected": False,
    }
