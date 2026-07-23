# server.py - 使用 AsyncSqliteSaver 的 aget_tuple 方法

import asyncio
import os
import sys
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import aiosqlite

from acp import run_agent
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from deepagents_acp.server import AgentServerACP, AgentSessionContext
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.store.memory import InMemoryStore
from langchain_openai import ChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from baidusearch.baidusearch import search
from langchain.tools import tool
from langgraph.store.sqlite.aio import AsyncSqliteStore
from acp.exceptions import RequestError
import json
from datetime import datetime, timezone


# ========== 日志配置 ==========
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent_debug.log')

def log_debug(message: str):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    formatted = f"[{timestamp}] {message}"
    sys.stderr.write(formatted + '\n')
    sys.stderr.flush()
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(formatted + '\n')
    except:
        pass


@tool
def baidu_web_search(query: str) -> str:
    """使用百度搜索网络信息。"""
    try:
        results = search(query)
        if not results:
            return "未找到相关结果。"
        
        output = [f"🔍 关于 '{query}' 的搜索结果："]
        for result in results[:5]:
            title = result.get('title', '无标题')
            abstract = result.get('abstract', '')[:150]
            url = result.get('url', '#')
            output.append(f"- {title}\n  {abstract}...\n  链接: {url}")
        return "\n\n".join(output)
    except Exception as e:
        return f"搜索服务暂时不可用: {e}"

@tool
def write_memory(content: str, filename: str = "memory.txt") -> str:
    """将重要信息写入记忆存储。
    
    Args:
        content: 要存储的内容
        filename: 文件名，默认为 memory.txt
    
    Returns:
        存储结果
    """
    try:
        # 写入到 /memories/ 路径
        memory_path = f"/memories/{filename}"
        # 这里实际需要通过 backend 写入
        # 但由于 backend 可能不工作，我们先使用临时方案
        script_dir = os.path.dirname(os.path.abspath(__file__))
        memories_dir = os.path.join(script_dir, "memories")
        os.makedirs(memories_dir, exist_ok=True)
        
        filepath = os.path.join(memories_dir, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return f"✅ 记忆已保存到 {filename}"
    except Exception as e:
        return f"❌ 保存失败: {e}"

@tool
def read_memory(filename: str = "memory.txt") -> str:
    """从记忆存储中读取信息。
    
    Args:
        filename: 文件名
    
    Returns:
        存储的内容
    """
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        memories_dir = os.path.join(script_dir, "memories")
        filepath = os.path.join(memories_dir, filename)
        
        if not os.path.exists(filepath):
            return "没有找到相关记忆"
        
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return content
    except Exception as e:
        return f"❌ 读取失败: {e}"


class CustomAgentServerACP(AgentServerACP):
    """自定义 ACP 服务器，实现 session/list 和 session/load"""
    
    def __init__(self, agent, checkpointer, db_path, **kwargs):
        super().__init__(agent, **kwargs)
        self._checkpointer = checkpointer
        self._db_path = db_path
        log_debug(f"✅ CustomAgentServerACP initialized with db_path={db_path}")
        # 注册自定义方法
        self._custom_methods = {
            'session_rename': self._handle_session_rename,
            'session/rename': self._handle_session_rename,
            'session_delete': self._handle_session_delete,
            'session/delete': self._handle_session_delete,
        }

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """处理 ACP 扩展方法调用。"""
        log_debug(f"📞 ext_method called with method={method}, params={params}")

        # ⭐ 注意：这里 method 应该是 '_session_rename'，带下划线
        if method == "session/rename":
            return await self._handle_session_rename(params)
        # 如果你希望同时支持不带下划线的版本，也可以保留
        elif method == "session_rename":
            return await self._handle_session_rename(params)
        
        # ⭐ 处理会话删除
        if method == "session_delete":
            return await self._handle_session_delete(params)

        # 如果父类有 ext_method，可以继续传递
        if hasattr(super(), 'ext_method'):
            return await super().ext_method(method, params)
        
        # 方法未找到
        raise RequestError(-32601, f"Extension method not found: {method}")
    
    async def _handle_session_delete(self, params: dict[str, Any]) -> dict[str, Any]:
        """处理会话删除"""
        log_debug(f"🗑️ _handle_session_delete called with params={params}")
        
        session_id = params.get("sessionId")
        
        if not session_id:
            raise RequestError(-32602, "Missing sessionId parameter")
        
        # 验证会话是否存在
        async with aiosqlite.connect(self._db_path) as conn:
            cursor = await conn.execute(
                "SELECT 1 FROM checkpoints WHERE thread_id = ? LIMIT 1",
                (session_id,)
            )
            if not await cursor.fetchone():
                raise RequestError(-32602, f"Session {session_id} not found")
        
        try:
            async with aiosqlite.connect(self._db_path) as conn:
                # 1. 删除 session_metadata 表中的记录
                await conn.execute(
                    "DELETE FROM session_metadata WHERE thread_id = ?",
                    (session_id,)
                )
                
                # 2. 删除 checkpoints 表中的记录
                await conn.execute(
                    "DELETE FROM checkpoints WHERE thread_id = ?",
                    (session_id,)
                )
                
                # 3. 删除 checkpoint_writes 表中的记录
                await conn.execute(
                    "DELETE FROM writes WHERE thread_id = ?",
                    (session_id,)
                )
                
                # # 4. 删除 checkpoint_blobs 表中的记录
                # await conn.execute(
                #     "DELETE FROM checkpoint_blobs WHERE thread_id = ?",
                #     (session_id,)
                # )
                
                await conn.commit()
                
            log_debug(f"✅ Session deleted: {session_id}")
            
            return {
                "sessionId": session_id,
                "success": True,
                "message": f"Session {session_id} deleted successfully"
            }
            
        except Exception as e:
            log_debug(f"❌ Failed to delete session {session_id}: {e}")
            import traceback
            log_debug(traceback.format_exc())
            raise RequestError(-32603, f"Failed to delete session {session_id}: {str(e)}")
    
    async def _handle_session_rename(self, params: dict[str, Any]) -> dict[str, Any]:
        """处理会话重命名"""
        log_debug(f"📝 _handle_session_rename called with params={params}")
        
        session_id = params.get("sessionId")
        new_title = params.get("title")
        
        if not session_id:
            raise RequestError(-32602, "Missing sessionId parameter")
        
        if not new_title:
            raise RequestError(-32602, "Missing title parameter")
        
        # 验证会话是否存在
        async with aiosqlite.connect(self._db_path) as conn:
            cursor = await conn.execute(
                "SELECT 1 FROM checkpoints WHERE thread_id = ? LIMIT 1",
                (session_id,)
            )
            if not await cursor.fetchone():
                raise RequestError(-32602, f"Session {session_id} not found")
        
        # 执行重命名
        success = await self._update_session_title(session_id, new_title)
        
        if not success:
            raise RequestError(-32603, f"Failed to rename session {session_id}")
        
        log_debug(f"✅ Session renamed: {session_id} -> '{new_title}'")
        
        return {
            "sessionId": session_id,
            "title": new_title,
            "success": True
        }
    
    async def _ensure_session_metadata_table(self) -> None:
        """确保 session_metadata 表存在"""
        try:
            async with aiosqlite.connect(self._db_path) as conn:
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS session_metadata (
                        thread_id TEXT PRIMARY KEY,
                        title TEXT,
                        created_at TEXT,
                        updated_at TEXT,
                        message_count INTEGER DEFAULT 0,
                        tags TEXT,
                        extra TEXT
                    )
                """)
                await conn.commit()
                log_debug("✅ session_metadata table ensured")
        except Exception as e:
            log_debug(f"❌ Failed to create session_metadata table: {e}")
            raise
    
    async def _update_session_title(self, thread_id: str, new_title: str) -> bool:
        """更新会话标题"""
        try:
            await self._ensure_session_metadata_table()
            
            async with aiosqlite.connect(self._db_path) as conn:
                # 检查是否存在记录
                cursor = await conn.execute(
                    "SELECT 1 FROM session_metadata WHERE thread_id = ?",
                    (thread_id,)
                )
                exists = await cursor.fetchone()
                
                now = datetime.now(timezone.utc).isoformat()
                
                if exists:
                    # 更新现有记录
                    await conn.execute(
                        """
                        UPDATE session_metadata 
                        SET title = ?, updated_at = ?
                        WHERE thread_id = ?
                        """,
                        (new_title, now, thread_id)
                    )
                else:
                    # 创建新记录
                    await conn.execute(
                        """
                        INSERT INTO session_metadata 
                        (thread_id, title, created_at, updated_at, message_count)
                        VALUES (?, ?, ?, ?, 0)
                        """,
                        (thread_id, new_title, now, now)
                    )
                
                await conn.commit()
                log_debug(f"✅ Session title updated for {thread_id} to '{new_title}'")
                return True
                
        except Exception as e:
            log_debug(f"❌ Failed to update session title: {e}")
            import traceback
            log_debug(traceback.format_exc())
            return False
    
    async def initialize(
        self,
        protocol_version: int,
        client_capabilities=None,
        client_info=None,
        **kwargs
    ):
        """重写 initialize，添加 sessionCapabilities 声明"""
        log_debug(f"📞 initialize called with protocol_version={protocol_version}")
        
        response = await super().initialize(
            protocol_version=protocol_version,
            client_capabilities=client_capabilities,
            client_info=client_info,
            **kwargs
        )
        
        if hasattr(response, 'model_dump'):
            result = response.model_dump()
        elif hasattr(response, 'dict'):
            result = response.dict()
        else:
            result = response if isinstance(response, dict) else {}
        
        if not isinstance(result, dict):
            result = {}
        
        if "agent_capabilities" not in result:
            result["agent_capabilities"] = {}
        if "session_capabilities" not in result["agent_capabilities"]:
            result["agent_capabilities"]["session_capabilities"] = {}
        
        result["agent_capabilities"]["session_capabilities"]["list"] = {}
        
        log_debug("✅ Added session_capabilities.list to response")
        return result
    
    async def list_sessions(
        self,
        cwd: str | None = None,
        cursor: str | None = None,
        additional_directories: list[str] | None = None,
        **kwargs
    ) -> Dict[str, Any]:
        """实现 session/list 方法（使用 session_metadata 表）"""
        log_debug(f"📋 list_sessions called: cwd={cwd}, cursor={cursor}")
        
        try:
            # 确保 session_metadata 表存在
            await self._ensure_session_metadata_table()
            
            sessions = []
            
            async with aiosqlite.connect(self._db_path) as conn:
                # 获取所有会话
                cursor = await conn.execute(
                    "SELECT DISTINCT thread_id FROM checkpoints"
                )
                rows = await cursor.fetchall()
                
                for row in rows:
                    thread_id = row[0]
                    
                    # 从 session_metadata 获取元数据
                    metadata = await self._get_session_metadata(thread_id)
                    
                    # 检查 cwd 过滤（如果需要）
                    # 注意：我们需要存储 cwd 信息，可以放在 extra 字段中
                    if cwd:
                        extra = metadata.get("extra", {})
                        if extra.get("cwd") != cwd:
                            continue
                    
                    session_info = {
                        "sessionId": thread_id,
                        "cwd": metadata.get("extra", {}).get("cwd", cwd or os.getcwd()),
                        "title": metadata.get("title"),
                        "createdAt": metadata.get("created_at"),
                        "updatedAt": metadata.get("updated_at"),
                        "messageCount": metadata.get("message_count", 0),
                        "_meta": metadata.get("extra", {})
                    }
                    sessions.append(session_info)
            
            # 按创建时间排序（最新的在前）
            sessions.sort(key=lambda x: x.get("createdAt") or "", reverse=True)
            
            log_debug(f"📋 Returning {len(sessions)} sessions")
            return {"sessions": sessions}
            
        except Exception as e:
            log_debug(f"❌ Error in list_sessions: {e}")
            import traceback
            log_debug(traceback.format_exc())
            return {"sessions": []}
    
    async def load_session(
        self,
        cwd: str,
        session_id: str,
        additional_directories: list[str] | None = None,
        mcp_servers: list | None = None,
        **kwargs
    ) -> Dict[str, Any] | None:
        """实现 session/load 方法 - 从 writes 表读取消息，并更新消息计数"""
        log_debug(f"📂 load_session called: session_id={session_id}, cwd={cwd}")
        
        try:
            messages = []
            
            async with aiosqlite.connect(self._db_path) as conn:
                # 读取消息
                cursor = await conn.execute(
                    """
                    SELECT value FROM writes 
                    WHERE thread_id = ? 
                    AND channel = 'messages'
                    AND value IS NOT NULL
                    AND value != ''
                    ORDER BY checkpoint_id, idx
                    """,
                    (session_id,)
                )
                rows = await cursor.fetchall()
                
                for row in rows:
                    value = row[0]
                    if not value:
                        continue
                    
                    parsed_msg = self._parse_and_deserialize_message(value)
                    if parsed_msg:
                        messages.append(parsed_msg)
                
                # 更新消息计数
                await self._update_message_count(session_id, len(messages))
            
            log_debug(f"📂 Retrieved {len(messages)} messages for session {session_id}")
            
            return {
                "sessionId": session_id,
                "cwd": cwd or os.getcwd(),
                "messages": messages,
                "metadata": {
                    "message_count": len(messages),
                    "title": await self._get_session_title(session_id)
                }
            }
                
        except Exception as e:
            log_debug(f"❌ Error in load_session: {e}")
            import traceback
            log_debug(traceback.format_exc())
            return None

    async def _update_message_count(self, thread_id: str, count: int) -> None:
        """更新会话的消息计数"""
        try:
            await self._ensure_session_metadata_table()
            
            async with aiosqlite.connect(self._db_path) as conn:
                cursor = await conn.execute(
                    "SELECT 1 FROM session_metadata WHERE thread_id = ?",
                    (thread_id,)
                )
                exists = await cursor.fetchone()
                
                now = datetime.now(timezone.utc).isoformat()
                
                if exists:
                    await conn.execute(
                        """
                        UPDATE session_metadata 
                        SET message_count = ?, updated_at = ?
                        WHERE thread_id = ?
                        """,
                        (count, now, thread_id)
                    )
                else:
                    # 如果没有记录，创建一条
                    title = await self._get_session_title(thread_id)
                    await conn.execute(
                        """
                        INSERT INTO session_metadata 
                        (thread_id, title, created_at, updated_at, message_count)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (thread_id, title, now, now, count)
                    )
                
                await conn.commit()
                
        except Exception as e:
            log_debug(f"⚠️ Failed to update message count: {e}")

    async def _get_session_title(self, thread_id: str) -> str | None:
        """获取会话标题"""
        try:
            async with aiosqlite.connect(self._db_path) as conn:
                cursor = await conn.execute(
                    "SELECT title FROM session_metadata WHERE thread_id = ?",
                    (thread_id,)
                )
                row = await cursor.fetchone()
                if row and row[0]:
                    return row[0]
            
            # 如果 session_metadata 没有，从 checkpoints 获取
            metadata = await self._get_metadata_from_checkpoints(thread_id)
            return metadata.get("title")
            
        except Exception as e:
            log_debug(f"⚠️ Failed to get session title: {e}")
            return None

    def _parse_and_deserialize_message(self, value: bytes) -> Optional[Dict[str, Any]]:
        """解析并反序列化消息"""
        try:
            import msgpack
            
            # 第一层解析
            outer_data = msgpack.unpackb(value, raw=False)
            
            if isinstance(outer_data, list) and len(outer_data) > 0:
                ext_obj = outer_data[0]
                
                if hasattr(ext_obj, 'code') and hasattr(ext_obj, 'data'):
                    # 第二层解析
                    inner_data = msgpack.unpackb(ext_obj.data, raw=False)
                    
                    # inner_data 是一个列表: ['langchain_core.messages.ai', 'AIMessage', {...}, 'model_validate_json']
                    if isinstance(inner_data, list) and len(inner_data) >= 3:
                        # 索引 2 是真正的消息字典
                        msg_dict = inner_data[2]
                        
                        if isinstance(msg_dict, dict):
                            msg_type = msg_dict.get('type', '')
                            content = msg_dict.get('content', '')
                            
                            # 处理 content
                            if isinstance(content, list):
                                text_parts = []
                                for block in content:
                                    if isinstance(block, dict) and block.get('type') == 'text':
                                        text_parts.append(block.get('text', ''))
                                    elif isinstance(block, str):
                                        text_parts.append(block)
                                content = '\n'.join(text_parts)
                            elif not isinstance(content, str):
                                content = str(content)
                            
                            # 角色映射
                            role_map = {
                                'human': 'user',
                                'ai': 'assistant'
                            }
                            role = role_map.get(msg_type)
                            
                            if role and content:
                                return {
                                    'role': role,
                                    'content': content.strip(),
                                    'timestamp': msg_dict.get('timestamp'),
                                    'id': msg_dict.get('id')
                                }
            
            return None
            
        except Exception as e:
            log_debug(f"⚠️ Error parsing message: {e}")
            return None

    # async def _get_session_metadata(self, thread_id: str) -> Dict[str, Any]:
    #     """获取会话元数据"""
    #     metadata = {
    #         "cwd": os.getcwd(),
    #         "title": None,
    #         "updated_at": datetime.now(timezone.utc).isoformat(),
    #         "_meta": {}
    #     }
        
    #     try:
    #         # 使用 aget_tuple 获取会话信息
    #         config = {"configurable": {"thread_id": thread_id}}
    #         checkpoint_tuple = await self._checkpointer.aget_tuple(config)
            
    #         if checkpoint_tuple:
    #             checkpoint_data = checkpoint_tuple.checkpoint
    #             channel_values = checkpoint_data.get("channel_values", {})
    #             messages_data = channel_values.get("messages", [])
                
    #             # 获取第一条消息作为标题
    #             if messages_data:
    #                 first_msg = messages_data[0]
    #                 if hasattr(first_msg, 'content'):
    #                     content = first_msg.content
    #                     if isinstance(content, str):
    #                         metadata["title"] = content[:50] + "..." if len(content) > 50 else content
                
    #             # 获取更新时间
    #             if "ts" in checkpoint_data:
    #                 metadata["updated_at"] = checkpoint_data["ts"]
                
    #             metadata["_meta"]["message_count"] = len(messages_data)
                
    #     except Exception as e:
    #         log_debug(f"⚠️ Could not get metadata for thread {thread_id}: {e}")
        
    #     return metadata
    
        # 在 CustomAgentServerACP 类中添加初始化方法

    # async def _ensure_session_metadata_table(self) -> None:
    #     """确保 session_metadata 表存在"""
    #     try:
    #         async with aiosqlite.connect(self._db_path) as conn:
    #             await conn.execute("""
    #                 CREATE TABLE IF NOT EXISTS session_metadata (
    #                     thread_id TEXT PRIMARY KEY,
    #                     title TEXT,
    #                     created_at TEXT,
    #                     updated_at TEXT,
    #                     message_count INTEGER DEFAULT 0,
    #                     tags TEXT,  -- JSON 数组，用于扩展
    #                     extra TEXT   -- JSON 对象，用于扩展
    #                 )
    #             """)
    #             await conn.commit()
    #             log_debug("✅ session_metadata table ensured")
    #     except Exception as e:
    #         log_debug(f"❌ Failed to create session_metadata table: {e}")
    #         raise

    async def _get_session_metadata(self, thread_id: str) -> Dict[str, Any]:
        """获取会话元数据（优先从 session_metadata 表读取）"""
        try:
            async with aiosqlite.connect(self._db_path) as conn:
                # 先查 session_metadata 表
                cursor = await conn.execute(
                    "SELECT title, created_at, updated_at, message_count, tags, extra FROM session_metadata WHERE thread_id = ?",
                    (thread_id,)
                )
                row = await cursor.fetchone()
                
                if row:
                    title, created_at, updated_at, message_count, tags, extra = row
                    return {
                        "title": title,
                        "created_at": created_at,
                        "updated_at": updated_at,
                        "message_count": message_count,
                        "tags": json.loads(tags) if tags else [],
                        "extra": json.loads(extra) if extra else {}
                    }
                
                # 如果 session_metadata 中没有，从 checkpoints 表获取基本信息
                return await self._get_metadata_from_checkpoints(thread_id)
                
        except Exception as e:
            log_debug(f"⚠️ Could not get metadata for thread {thread_id}: {e}")
            return {"title": None, "message_count": 0}

    async def _get_metadata_from_checkpoints(self, thread_id: str) -> Dict[str, Any]:
        """从 checkpoints 表获取基本信息（备用）"""
        metadata = {
            "title": None,
            "created_at": None,
            "updated_at": None,
            "message_count": 0,
            "tags": [],
            "extra": {}
        }
        
        try:
            async with aiosqlite.connect(self._db_path) as conn:
                # 获取第一条消息作为标题
                cursor = await conn.execute(
                    """
                    SELECT value FROM writes 
                    WHERE thread_id = ? 
                    AND channel = 'messages'
                    AND value IS NOT NULL
                    AND value != ''
                    ORDER BY checkpoint_id, idx
                    LIMIT 1
                    """,
                    (thread_id,)
                )
                row = await cursor.fetchone()
                if row:
                    # 解析消息获取内容（使用已有的解析方法）
                    parsed = self._parse_and_deserialize_message(row[0])
                    if parsed and parsed.get('content'):
                        content = parsed['content']
                        metadata["title"] = content[:50] + "..." if len(content) > 50 else content
                
                # 获取消息数量
                cursor = await conn.execute(
                    """
                    SELECT COUNT(*) FROM writes 
                    WHERE thread_id = ? 
                    AND channel = 'messages'
                    """,
                    (thread_id,)
                )
                row = await cursor.fetchone()
                if row:
                    metadata["message_count"] = row[0]
                
                # 获取创建和更新时间
                cursor = await conn.execute(
                    """
                    SELECT MIN(created_at), MAX(created_at) 
                    FROM checkpoints 
                    WHERE thread_id = ?
                    """,
                    (thread_id,)
                )
                row = await cursor.fetchone()
                if row and row[0]:
                    metadata["created_at"] = row[0]
                    metadata["updated_at"] = row[1] or row[0]
                    
        except Exception as e:
            log_debug(f"⚠️ Could not get checkpoint metadata: {e}")
        
        return metadata

    # async def _update_session_title(self, thread_id: str, new_title: str) -> bool:
    #     """更新会话标题（使用独立的 session_metadata 表）"""
    #     try:
    #         async with aiosqlite.connect(self._db_path) as conn:
    #             # 确保表存在
    #             await self._ensure_session_metadata_table()
                
    #             # 检查是否存在记录
    #             cursor = await conn.execute(
    #                 "SELECT 1 FROM session_metadata WHERE thread_id = ?",
    #                 (thread_id,)
    #             )
    #             exists = await cursor.fetchone()
                
    #             now = datetime.now(timezone.utc).isoformat()
                
    #             if exists:
    #                 # 更新现有记录
    #                 await conn.execute(
    #                     """
    #                     UPDATE session_metadata 
    #                     SET title = ?, updated_at = ?
    #                     WHERE thread_id = ?
    #                     """,
    #                     (new_title, now, thread_id)
    #                 )
    #             else:
    #                 # 创建新记录（保留原有元数据）
    #                 existing_metadata = await self._get_metadata_from_checkpoints(thread_id)
    #                 await conn.execute(
    #                     """
    #                     INSERT INTO session_metadata 
    #                     (thread_id, title, created_at, updated_at, message_count)
    #                     VALUES (?, ?, ?, ?, ?)
    #                     """,
    #                     (thread_id, new_title, now, now, existing_metadata.get("message_count", 0))
    #                 )
                
    #             await conn.commit()
    #             log_debug(f"✅ Session title updated for {thread_id} to '{new_title}'")
    #             return True
                
    #     except Exception as e:
    #         log_debug(f"❌ Failed to update session title: {e}")
    #         import traceback
    #         log_debug(traceback.format_exc())
    #         return False




# ========== Agent 工厂函数 ==========
def build_agent(context: AgentSessionContext, checkpointer, backend, tools):
    """创建 Deep Agent 的工厂函数"""
    log_debug(f"🏗️ Building agent for cwd={context.cwd}")
    
    model = ChatOpenAI(
        model=os.getenv("QWEN_MODEL", "qwen-plus"),
        api_key=os.getenv("DASHSCOPE_API_KEY"),
        base_url=os.getenv("OPENAI_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        temperature=0.7,
        streaming=True,
    )
    
    system_prompt = """
            你是 AI 编程助手。
            
            【重要】当前工作空间位于 **Windows 操作系统** 上。
            - 所有文件操作、命令执行都针对 Windows 环境
            - 路径推荐使用正斜杠 `/`，如 `./src/main.py`
            
             【文件记忆功能】
                你可以使用 write_memory 和 read_memory 工具来持久化存储用户偏好和重要信息。
                当用户说"记住"、"保存"、"存储"时，使用 write_memory 工具保存信息。
                当用户询问之前的信息时，使用 read_memory 工具读取。
            【记忆功能的使用方法】
                1.  **当用户说“记住...”、“保存...”或暗示这是重要偏好时，你应该立即执行以下操作：**
                    *   使用你的内置文件编辑工具（如 `edit_file`、`write_file` 等），将信息写入 `/memories/` 路径下的一个 Markdown 文件。例如，记住用户的编程偏好时，可以写入 `/memories/preferences.md`。
                    *   *行动示例：* `edit_file` 目标路径为 `/memories/preferences.md`，内容为“用户偏好 Python 和类型提示”。
                2.  **当用户问及过往信息或你的行为依据时，你应该先从 `/memories/` 目录下读取相关文件，并结合这些信息进行回复。**
                3.  **如果文件不存在，你需要创建它；如果已存在，你应该智能地更新或追加内容。**
            
            请根据 Windows 工作空间的特点高效完成任务。
            """
    
    agent = create_deep_agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
        checkpointer=checkpointer,
        backend=backend,
    )
    
    log_debug("✅ Agent built successfully")
    return agent


async def main():
    sys.stderr.write("Starting Agent...\n")
    sys.stderr.write(f"Workspace OS: Windows\n")

    # 获取工作区路径
    workspace_root = os.getcwd()
    defaultmcpserverUrl = os.getenv("DEFAULT_MCP_SERVER_URL", "http://localhost:9876")
    
    # 2. 加载 MCP 工具
    tools = []
    try:
        mcp_client = MultiServerMCPClient({
            "vscode-local-tools": {
                "transport": "http",
                "url": defaultmcpserverUrl,
                "timeout": 300,
            }
        })
        
        tools = await mcp_client.get_tools()
        sys.stderr.write(f"✅ Loaded {len(tools)} tools from VSCode MCP Server\n")
        sys.stderr.write(f"Tools: {', '.join([t.name for t in tools])}\n")
        
    except Exception as e:
        sys.stderr.write(f"⚠️ Could not load MCP tools: {e}\n")
        import traceback
        sys.stderr.write(traceback.format_exc())

    tools = tools + [baidu_web_search, write_memory, read_memory]
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    checkpoint_db_path = os.path.join(script_dir, 'checkpoints.db')
    memories_db_path = os.path.join(script_dir, 'memories.db')
    
    sys.stderr.write(f"📁 Checkpoint database: {checkpoint_db_path}\n")
    
    # 使用 AsyncSqliteSaver，它会自动创建标准表
    async with AsyncSqliteSaver.from_conn_string(checkpoint_db_path) as checkpointer:
        sys.stderr.write("✅ AsyncSqliteSaver created and connected\n")
        sys.stderr.write("   (Auto-creates standard tables: checkpoints, checkpoint_writes, checkpoint_blobs)\n")
        async with AsyncSqliteStore.from_conn_string(memories_db_path) as store:
            # 创建 Backend：管理文件存储
            backend = CompositeBackend(
                default=StateBackend(),  # 默认路径使用临时存储
                routes={
                    "/memories/": StoreBackend(
                        store=store,
                        namespace=lambda ctx: ("memories",)  # 使用 lambda 函数
                    ),
                }
            )
        
            def agent_factory(context: AgentSessionContext):
                return build_agent(context, checkpointer, backend,tools)
            
            server = CustomAgentServerACP(
                agent=agent_factory,
                checkpointer=checkpointer,
                db_path=checkpoint_db_path
            )
            
            sys.stderr.write("🚀 Starting Deep Agents server...\n")
            sys.stderr.write("   - session/list: ✅ implemented\n")
            sys.stderr.write("   - session/load: ✅ implemented (using aget_tuple)\n")
            sys.stderr.write("   - Checkpointer: AsyncSqliteSaver\n")
            
            try:
                await run_agent(server)
            except Exception as e:
                sys.stderr.write(f"❌ Server execution error: {e}\n")
                import traceback
                sys.stderr.write(traceback.format_exc())


if __name__ == "__main__":
    asyncio.run(main())
