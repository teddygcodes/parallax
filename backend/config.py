from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@localhost:5432/parallax"
    redis_url: str = "redis://localhost:6379"
    anthropic_api_key: str = ""
    acled_email: str = ""
    acled_key: str = ""
    newsapi_key: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
