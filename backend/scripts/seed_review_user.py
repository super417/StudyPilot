"""Idempotently create the local reviewer account after database migration."""

from uuid import UUID

from sqlalchemy import select

from app.core.database import get_session_factory
from app.models.entities import User
from app.services.auth_service import hash_password

REVIEW_USER_ID = UUID("4c6d1df3-95a2-472f-9018-34bf11db3efe")
REVIEW_USERNAME = "super"
INITIAL_PASSWORD = "StudyPilot2026!"


def main() -> None:
    with get_session_factory()() as session:
        user = session.scalar(select(User).where(User.username == REVIEW_USERNAME))
        if user is not None:
            if user.id != REVIEW_USER_ID:
                raise SystemExit(
                    "错误：已有 super 账号，但 UUID 为 "
                    f"{user.id}，不是评审要求的 {REVIEW_USER_ID}。"
                    "未修改账号、密码或数据；请先人工核对数据库。"
                )
            print(f"super 已存在（{REVIEW_USER_ID}），未修改密码或数据。")
            return

        uuid_owner = session.get(User, REVIEW_USER_ID)
        if uuid_owner is not None:
            raise SystemExit(
                f"错误：固定评审 UUID 已被账号 {uuid_owner.username!r} 使用；"
                "未创建账号或修改数据。"
            )

        session.add(
            User(
                id=REVIEW_USER_ID,
                username=REVIEW_USERNAME,
                password_hash=hash_password(INITIAL_PASSWORD),
            )
        )
        session.commit()
        print(f"已创建 super（{REVIEW_USER_ID}）；初始密码见 README.md / DEPLOY.md。")


if __name__ == "__main__":
    main()
