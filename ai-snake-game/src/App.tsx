import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

/** 后端基址：本地开发走 localhost，线上构建走云端地址 */
const API_BASE = import.meta.env.DEV
  ? 'http://127.0.0.1:8000'
  : 'https://xs0236.github.io'

/** 棋盘列数 */
const COLS = 20
/** 棋盘行数 */
const ROWS = 20
/** 移动间隔（毫秒），数值越小蛇越快 */
const TICK_MS = 130

type Cell = { x: number; y: number }
type Direction = { dx: number; dy: number }

/** 游戏阶段：未开始 | 进行中 | 结束 */
type GamePhase = 'idle' | 'playing' | 'gameover'

/** 与 OpenAPI / 后端 Pydantic 模型一致 */
type ScoreEntry = {
  player: string
  score: number
  created_at: string
}

type LeaderboardResponse = {
  items: ScoreEntry[]
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

const INITIAL_SNAKE: Cell[] = [
  { x: 10, y: 10 },
  { x: 9, y: 10 },
  { x: 8, y: 10 },
]

const INITIAL_DIR: Direction = { dx: 1, dy: 0 }

/** 判断两格是否重合 */
function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y
}

/** 方向是否相反（禁止直接掉头） */
function isOpposite(a: Direction, b: Direction): boolean {
  return a.dx === -b.dx && a.dy === -b.dy
}

/** 在空地上随机生成食物（不与蛇身重叠） */
function spawnFood(snake: Cell[]): Cell {
  const taken = new Set(snake.map((c) => `${c.x},${c.y}`))
  for (let i = 0; i < 5000; i++) {
    const x = Math.floor(Math.random() * COLS)
    const y = Math.floor(Math.random() * ROWS)
    const key = `${x},${y}`
    if (!taken.has(key)) return { x, y }
  }
  return { x: 0, y: 0 }
}

/** GET 排行榜 */
async function fetchLeaderboard(): Promise<ScoreEntry[]> {
  const res = await fetch(`${API_BASE}/leaderboard`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `获取排行榜失败 (${res.status})`)
  }
  const data: LeaderboardResponse = await res.json()
  return Array.isArray(data.items) ? data.items : []
}

/** POST 提交分数 */
async function postScore(player: string, score: number): Promise<ScoreEntry> {
  const res = await fetch(`${API_BASE}/leaderboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player: player.trim(), score }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `提交失败 (${res.status})`)
  }
  return res.json() as Promise<ScoreEntry>
}

/** 简短展示 UTC 时间 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString(undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
  } catch {
    return iso
  }
}

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('idle')
  const [snake, setSnake] = useState<Cell[]>(() => [...INITIAL_SNAKE])
  const [food, setFood] = useState<Cell>(() => spawnFood(INITIAL_SNAKE))
  const [score, setScore] = useState(0)

  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(true)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)

  /** Game Over 且分数 > 0：昵称与提交状态 */
  const [nickname, setNickname] = useState('')
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** 与 food state 同步，避免定时器依赖 food 导致每吃一个苹果就重置 tick */
  const foodRef = useRef(food)
  foodRef.current = food

  /** 当前帧实际移动方向（与下一帧输入解耦，避免同帧内乱序） */
  const dirRef = useRef<Direction>({ ...INITIAL_DIR })
  /** 玩家按键缓存的下一方向，在下一 tick 开头再合并进 dirRef */
  const pendingDirRef = useRef<Direction>({ ...INITIAL_DIR })

  /** 加载排行榜：挂载时调用；提交成功后再次调用 */
  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true)
    setLeaderboardError(null)
    try {
      const items = await fetchLeaderboard()
      setLeaderboard(items)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加载排行榜失败'
      setLeaderboardError(msg)
      setLeaderboard([])
    } finally {
      setLeaderboardLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLeaderboard()
  }, [loadLeaderboard])

  const resetGame = useCallback((initialDir?: Direction) => {
    const s = [...INITIAL_SNAKE]
    const dir = initialDir ?? INITIAL_DIR
    setSnake(s)
    setFood(spawnFood(s))
    setScore(0)
    dirRef.current = { ...dir }
    pendingDirRef.current = { ...dir }
  }, [])

  const startGame = useCallback(
    (initialDir?: Direction) => {
      resetGame(initialDir)
      setPhase('playing')
      setNickname('')
      setSubmitStatus('idle')
      setSubmitError(null)
    },
    [resetGame],
  )

  const restartAfterGameOver = useCallback(() => {
    resetGame()
    setPhase('playing')
    setNickname('')
    setSubmitStatus('idle')
    setSubmitError(null)
  }, [resetGame])

  /** Game Over 后提交本局成绩 */
  const handleSubmitScore = async () => {
    const name = nickname.trim()
    if (!name) {
      setSubmitError('请输入昵称')
      return
    }
    if (name.length > 20) {
      setSubmitError('昵称最长 20 个字符')
      return
    }
    setSubmitStatus('submitting')
    setSubmitError(null)
    try {
      await postScore(name, score)
      setSubmitStatus('success')
      await loadLeaderboard()
    } catch (e) {
      setSubmitStatus('error')
      setSubmitError(e instanceof Error ? e.message : '提交失败')
    }
  }

  /** 键盘：方向键控制；阻止默认行为避免页面滚动 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      let next: Direction | null = null
      switch (e.key) {
        case 'ArrowUp':
          next = { dx: 0, dy: -1 }
          break
        case 'ArrowDown':
          next = { dx: 0, dy: 1 }
          break
        case 'ArrowLeft':
          next = { dx: -1, dy: 0 }
          break
        case 'ArrowRight':
          next = { dx: 1, dy: 0 }
          break
        default:
          return
      }
      e.preventDefault()
      // 未开始时按方向键也可直接开一局（体验更顺）
      if (phase === 'idle') {
        startGame(next)
        return
      }
      if (phase !== 'playing') return
      if (isOpposite(pendingDirRef.current, next)) return
      pendingDirRef.current = next
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, startGame])

  /** 游戏主循环：仅在 playing 时 tick */
  useEffect(() => {
    if (phase !== 'playing') return

    const id = window.setInterval(() => {
      dirRef.current = pendingDirRef.current
      const { dx, dy } = dirRef.current

      setSnake((prev) => {
        const head = prev[0]
        const newHead: Cell = { x: head.x + dx, y: head.y + dy }

        // 撞墙
        if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
          setPhase('gameover')
          return prev
        }

        // 撞自己：身体除尾以外的部分不能与新头重叠；尾尖会移走，允许「穿尾」一格
        const bodyMiddle = prev.slice(1, -1)
        if (bodyMiddle.some((c) => sameCell(c, newHead))) {
          setPhase('gameover')
          return prev
        }

        const eating = sameCell(newHead, foodRef.current)

        if (eating) {
          setScore((s) => s + 1)
          const grown = [newHead, ...prev]
          setFood(spawnFood(grown))
          return grown
        }

        return [newHead, ...prev.slice(0, -1)]
      })
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [phase])

  /** 进入 Game Over 时重置提交相关 UI（新的一局结束） */
  const prevPhaseRef = useRef<GamePhase>(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== 'gameover' && phase === 'gameover') {
      setNickname('')
      setSubmitStatus('idle')
      setSubmitError(null)
    }
    prevPhaseRef.current = phase
  }, [phase])

  /** 渲染用：蛇身坐标集合（含头），用于着色 */
  const snakeSet = new Set(snake.map((c) => `${c.x},${c.y}`))
  const head = snake[0]
  const headKey = head ? `${head.x},${head.y}` : ''

  const cells = []
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const key = `${x},${y}`
      const isHead = headKey === key
      const isFood = food.x === x && food.y === y
      const isBody = !isHead && snakeSet.has(key)

      let mod = ''
      if (isHead) mod = ' snake-cell--head'
      else if (isFood) mod = ' snake-cell--food'
      else if (isBody) mod = ' snake-cell--body'

      cells.push(
        <div
          key={key}
          className={`snake-cell${mod}`}
          aria-label={
            isHead ? '蛇头' : isFood ? '食物' : isBody ? '蛇身' : '空地'
          }
        />,
      )
    }
  }

  const showSubmitForm = phase === 'gameover' && score > 0

  return (
    <div className="snake-app">
      <header className="snake-header">
        <h1 className="snake-title">贪吃蛇</h1>
        <div className="snake-scoreboard" role="status">
          <span className="snake-score-label">得分</span>
          <span className="snake-score-value">{score}</span>
        </div>
      </header>

      <div className="snake-layout">
        <div className="snake-main">
          <p className="snake-hint">
            {phase === 'idle' && '点击「开始游戏」或使用方向键开始'}
            {phase === 'playing' && '使用方向键 ↑ ↓ ← → 控制'}
            {phase === 'gameover' && '游戏结束：撞墙或咬到自己'}
          </p>

          <div
            className="snake-board-wrap"
            style={
              {
                '--snake-cols': COLS,
                '--snake-rows': ROWS,
              } as React.CSSProperties
            }
          >
            {phase === 'gameover' && (
              <div className="snake-overlay" role="dialog" aria-live="polite">
                <p className="snake-overlay-title">Game Over</p>
                <p className="snake-overlay-score">本局得分：{score}</p>

                {showSubmitForm && (
                  <div className="snake-submit-block">
                    <label className="snake-submit-label" htmlFor="snake-nickname">
                      昵称（提交到高分榜）
                    </label>
                    <input
                      id="snake-nickname"
                      className="snake-input"
                      type="text"
                      maxLength={20}
                      placeholder="1～20 个字符"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      disabled={submitStatus === 'submitting' || submitStatus === 'success'}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="snake-btn snake-btn--primary"
                      onClick={() => void handleSubmitScore()}
                      disabled={
                        submitStatus === 'submitting' || submitStatus === 'success'
                      }
                    >
                      {submitStatus === 'submitting'
                        ? '提交中…'
                        : submitStatus === 'success'
                          ? '已提交'
                          : '提交成绩'}
                    </button>
                    {submitError && (
                      <p className="snake-submit-msg snake-submit-msg--error">
                        {submitError}
                      </p>
                    )}
                    {submitStatus === 'success' && (
                      <p className="snake-submit-msg">成绩已上传，榜单已更新</p>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  className="snake-btn snake-btn--primary"
                  onClick={restartAfterGameOver}
                >
                  再来一局
                </button>
              </div>
            )}
            <div className="snake-board">{cells}</div>
          </div>

          <div className="snake-actions">
            {phase === 'idle' && (
              <button
                type="button"
                className="snake-btn snake-btn--primary"
                onClick={() => startGame()}
              >
                开始游戏
              </button>
            )}
            {phase === 'playing' && (
              <button
                type="button"
                className="snake-btn"
                onClick={() => {
                  resetGame()
                  setPhase('idle')
                }}
              >
                暂停并返回菜单
              </button>
            )}
          </div>
        </div>

        <aside className="snake-leaderboard" aria-labelledby="leaderboard-heading">
          <div className="snake-leaderboard-head">
            <h2 id="leaderboard-heading" className="snake-leaderboard-title">
              高分榜
            </h2>
            <button
              type="button"
              className="snake-btn snake-btn--small"
              onClick={() => void loadLeaderboard()}
              disabled={leaderboardLoading}
            >
              {leaderboardLoading ? '刷新中…' : '刷新'}
            </button>
          </div>
          {leaderboardLoading && leaderboard.length === 0 && (
            <p className="snake-leaderboard-status">加载中…</p>
          )}
          {leaderboardError && (
            <p className="snake-leaderboard-status snake-leaderboard-status--error">
              {leaderboardError}
            </p>
          )}
          {!leaderboardLoading && !leaderboardError && leaderboard.length === 0 && (
            <p className="snake-leaderboard-status">暂无记录</p>
          )}
          <ol className="snake-leaderboard-list">
            {leaderboard.map((row, i) => (
              <li key={`${row.player}-${row.score}-${row.created_at}-${i}`}>
                <span className="snake-lb-rank">{i + 1}</span>
                <span className="snake-lb-name" title={row.player}>
                  {row.player}
                </span>
                <span className="snake-lb-score">{row.score}</span>
                <span className="snake-lb-time">{formatTime(row.created_at)}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  )
}
