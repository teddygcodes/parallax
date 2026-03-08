"""add_media_items_table

Revision ID: 4fa9fb811f34
Revises: 8f5ce6213f10
Create Date: 2026-03-08 00:58:44.698484

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4fa9fb811f34'
down_revision: Union[str, Sequence[str], None] = '8f5ce6213f10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "media_items",
        sa.Column("id",                  sa.String(),  nullable=False),
        sa.Column("event_id",            sa.String(),  sa.ForeignKey("event.id"),   nullable=False),
        sa.Column("signal_id",           sa.String(),  sa.ForeignKey("signals.id"), nullable=False),
        sa.Column("media_type",          sa.String(),  nullable=False),
        sa.Column("source",              sa.String(),  nullable=False),
        sa.Column("source_category",     sa.String(),  nullable=False),
        sa.Column("origin_url",          sa.String(),  nullable=False),
        sa.Column("source_page_url",     sa.String(),  nullable=True),
        sa.Column("thumbnail_url",       sa.String(),  nullable=True),
        sa.Column("caption",             sa.String(),  nullable=True),
        sa.Column("alt_text",            sa.String(),  nullable=True),
        sa.Column("provider",            sa.String(),  nullable=False),
        sa.Column("verification_status", sa.String(),  nullable=False, server_default="UNVERIFIED"),
        sa.Column("position_index",      sa.Integer(), nullable=True),
        sa.Column("width",               sa.Integer(), nullable=True),
        sa.Column("height",              sa.Integer(), nullable=True),
        # server_default="now()" applies at DB level for rows inserted outside the ORM.
        # ORM-inserted rows use the model's lambda default. Both are UTC; minor path difference acceptable.
        sa.Column("created_at",          sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_media_items_event_id",   "media_items", ["event_id"])
    op.create_index("ix_media_items_signal_id",  "media_items", ["signal_id"])
    op.create_index("ix_media_items_media_type", "media_items", ["media_type"])


def downgrade() -> None:
    op.drop_index("ix_media_items_media_type", table_name="media_items")
    op.drop_index("ix_media_items_signal_id",  table_name="media_items")
    op.drop_index("ix_media_items_event_id",   table_name="media_items")
    op.drop_table("media_items")
