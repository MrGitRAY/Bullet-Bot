import json
from functools import lru_cache
from pathlib import Path

LOCALES = Path(__file__).resolve().parents[2] / "locales"


@lru_cache(maxsize=2)
def messages(language: str) -> dict[str, str]:
    language = language if language in {"fa", "en"} else "en"
    return json.loads((LOCALES / f"{language}.json").read_text(encoding="utf-8"))


def translate(key: str, language: str) -> str:
    return messages(language)[key]
