import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models.base import Base
from app.models.entities import User, UserDocument
from app.services.assistant_service import get_user_profile, check_if_user_has_materials, build_chat_messages
from app.services.document_service import build_context


def test_user_context_is_isolated():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        a = User(id=uuid.uuid4(), username='user-a', password_hash='x', school='甲大学', major='计算机', direction='人工智能')
        b = User(id=uuid.uuid4(), username='user-b', password_hash='x')
        session.add_all([a, b, UserDocument(user_id=a.id, doc_id='a', filename='a.txt', file_type='txt', chunk_index=0, content='Python 变量')])
        session.commit()
        assert get_user_profile(session, a.id)['school'] == '甲大学'
        assert not get_user_profile(session, b.id)['school']
        assert check_if_user_has_materials(session, a.id)
        assert not check_if_user_has_materials(session, b.id)
        assert 'Python' in build_context(session, a.id, ['a'], 'Python')[0]
        assert build_context(session, b.id, ['a'], 'Python')[0] == ''


def test_material_status_in_prompt():
    def prompt(has_materials, rag_text=''):
        return build_chat_messages('说说我的情况', context_type=None, mistake_excerpt='', rag_text=rag_text, has_materials=has_materials)[1]['content']
    assert '已上传资料，但当前问题未匹配到相关内容' in prompt(True)
    assert '还没有上传' in prompt(False)
    assert 'Python 变量' in prompt(True, 'Python 变量')
    assert '用户已有上传资料' in prompt(True)
    assert '用户已有上传资料' in prompt(True, 'Python 变量')
    assert '用户尚未上传学习资料' in prompt(False)
