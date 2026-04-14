from datetime import datetime, timezone
from typing import List

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class SubmitScoreRequest(BaseModel):
    """提交分数请求体。"""

    player: str = Field(..., min_length=1, max_length=20, description="玩家昵称")
    score: int = Field(..., ge=0, description="本局得分")


class ScoreEntry(BaseModel):
    """排行榜记录。"""

    player: str
    score: int
    created_at: datetime


class LeaderboardResponse(BaseModel):
    """排行榜响应。"""

    items: List[ScoreEntry]


app = FastAPI(
    title="Snake Leaderboard API",
    version="1.0.0",
    description="贪吃蛇排行榜服务，支持查询前 10 名与提交成绩。",
)

# 允许本地开发与线上前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://xs0236.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 使用内存列表临时存储分数（重启服务后会清空）
scores_db: List[ScoreEntry] = []


def get_top_10() -> List[ScoreEntry]:
    """按分数从高到低排序；同分时按更早提交优先。"""

    return sorted(scores_db, key=lambda item: (-item.score, item.created_at))[:10]


@app.get("/leaderboard", response_model=LeaderboardResponse)
def get_leaderboard() -> LeaderboardResponse:
    return LeaderboardResponse(items=get_top_10())


@app.post(
    "/leaderboard",
    response_model=ScoreEntry,
    status_code=status.HTTP_201_CREATED,
)
def submit_score(payload: SubmitScoreRequest) -> ScoreEntry:
    entry = ScoreEntry(
        player=payload.player.strip(),
        score=payload.score,
        created_at=datetime.now(timezone.utc),
    )
    scores_db.append(entry)
    return entry
