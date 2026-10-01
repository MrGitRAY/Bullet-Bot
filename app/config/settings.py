from typing import Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: SecretStr
    telegram_proxy_url: SecretStr | None = None
    database_url: str = "sqlite+aiosqlite:///./data/bullet.db"
    default_language: Literal["fa", "en"] = "fa"
    timezone: str = "Asia/Tehran"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    allowed_user_ids: list[int] = []

    @field_validator("bot_token")
    @classmethod
    def validate_token(cls, value: SecretStr) -> SecretStr:
        from aiogram.utils.token import validate_token

        validate_token(value.get_secret_value())
        return value

    @field_validator("telegram_proxy_url")
    @classmethod
    def validate_proxy(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None or not value.get_secret_value().strip():
            return None
        parsed = urlparse(value.get_secret_value())
        if parsed.scheme not in {"http", "https", "socks4", "socks5"}:
            raise ValueError("Proxy must use http, https, socks4, or socks5")
        if not parsed.hostname or parsed.port is None:
            raise ValueError("Proxy URL must include host and port")
        return value

    @field_validator("database_url")
    @classmethod
    def validate_database(cls, value: str) -> str:
        if make_url(value).drivername not in {"sqlite+aiosqlite", "postgresql+asyncpg"}:
            raise ValueError("Use sqlite+aiosqlite or postgresql+asyncpg")
        return value

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unknown IANA timezone") from exc
        return value
