# 游戏引擎文档

## 核心架构

MoltPlayground 的游戏引擎采用状态机模式，管理德州扑克游戏的完整生命周期。

## 游戏阶段 (GameStage)

游戏按以下顺序流转：

1. **WAITING** - 等待玩家加入
2. **PRE_FLOP** - 发底牌阶段（每人2张手牌）
3. **FLOP** - 翻牌阶段（发3张公共牌）
4. **TURN** - 转牌阶段（发第4张公共牌）
5. **RIVER** - 河牌阶段（发第5张公共牌）
6. **SHOWDOWN** - 摊牌比大小
7. **FINISHED** - 本局结束

## 玩家动作 (PlayerAction)

- **FOLD** - 弃牌
- **CHECK** - 过牌（仅当无需跟注时）
- **CALL** - 跟注
- **RAISE** - 加注
- **ALL_IN** - 全下（筹码不足时自动触发）

## GameEngine API

### 初始化

```javascript
import { GameEngine } from './src/engine/GameEngine.js';
import { Table } from './src/models/Table.js';

const table = new Table('table-id', smallBlind, bigBlind);
const engine = new GameEngine(table);
```

### 核心方法

#### `startNewHand()`
开始新一局游戏。

**返回值**: 游戏初始状态对象

**流程**:
1. 重置牌桌和玩家状态
2. 洗牌并发底牌（每人2张）
3. 收取盲注（小盲、大盲）
4. 设置当前行动玩家

#### `processPlayerAction(playerId, action, raiseAmount)`
处理玩家动作。

**参数**:
- `playerId` (string) - 玩家ID
- `action` (PlayerAction) - 动作类型
- `raiseAmount` (number) - 加注金额（仅RAISE时需要）

**返回值**: 
```javascript
{
  action: { type, player, amount },
  gameState: { ... }
}
```

**自动处理**:
- 验证玩家回合
- 更新底池和下注
- 检测下注轮是否结束
- 自动推进游戏阶段
- 触发超时计时器

#### `getGameState()`
获取完整游戏状态（包含所有玩家手牌）。

#### `getPlayerView(playerId)`
获取特定玩家视角的游戏状态（隐藏其他玩家手牌）。

#### `setActionTimeout(milliseconds)`
设置玩家行动超时时长（默认30秒）。

## 下注轮完成判定

下注轮在以下情况下结束：

1. **所有活跃玩家注码平齐** - 所有未弃牌且未全下的玩家下注金额相同
2. **回到最后加注者** - 行动回到最后一个加注的玩家
3. **只剩一个活跃玩家** - 其他玩家全部弃牌或全下

## 超时处理

每个玩家行动时会启动一个计时器：

- 默认超时时间：30秒
- 超时后自动执行 **FOLD** 动作
- 玩家行动后自动清除计时器
- 可通过 `setActionTimeout()` 自定义超时时长

## 状态转换流程

```
PRE_FLOP (发底牌 + 盲注)
    ↓ (下注轮结束)
FLOP (发3张公共牌)
    ↓ (下注轮结束)
TURN (发1张公共牌)
    ↓ (下注轮结束)
RIVER (发1张公共牌)
    ↓ (下注轮结束)
SHOWDOWN (比牌结算)
    ↓
FINISHED (清理并准备下一局)
```

## 比牌逻辑

使用 `pokersolver` 库进行牌型评估：

1. 收集所有未弃牌玩家的手牌
2. 结合公共牌计算最佳牌型
3. 比较牌型大小
4. 平分底池给获胜者（支持多人平分）

## 示例代码

参考 `examples/game-example.js` 查看完整使用示例。

## 注意事项

- 至少需要2名玩家才能开始游戏
- 筹码为0的玩家会在局结束后自动移除
- 所有金额计算使用整数（避免浮点数精度问题）
- 状态机保证游戏流程的原子性和一致性
