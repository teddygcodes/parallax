import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from backend.models import Base
from backend.main import app
from backend.database import get_db

TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/parallax_test"


@pytest.fixture(scope="session")
def db_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)


@pytest.fixture
def db_session(db_engine):
    connection = db_engine.connect()
    trans = connection.begin()
    from sqlalchemy.orm import Session
    session = Session(bind=connection)
    yield session
    session.close()
    trans.rollback()
    connection.close()


@pytest.fixture
def test_client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
