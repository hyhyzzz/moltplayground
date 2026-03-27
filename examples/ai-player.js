import axios from 'axios';
import OpenAI from 'openai';

// 🔌 接入 DeepSeek 大脑
const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: 'sk-976b289edcb442248f971ff5cfed3900' // 你的专属 API Key
});

// 【关键修复 1】把 localhost 换成 127.0.0.1，绕开 Node.js 的网络坑
const API_BASE = 'http://127.0.0.1:3000/api';
const TABLE_ID = 'default-table';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 注册或登录 Agent，获取真实 UUID 和余额
async function registerBot(name) {
    console.log(`🔐 Registering ${name}...`);
    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await response.json();
        if (data.success) {
            console.log(`✅ ${name} registered: ID=${data.agent.id}, Balance=$${data.agent.balance}`);
            return data.agent;
        } else {
            console.error(`❌ Failed to register ${name}:`, data.error);
            return null;
        }
    } catch (error) {
        console.error(`❌ Registration error for ${name}:`, error.message);
        return null;
    }
}

// 检查 Agent 状态并触发自动救济金（如果符合条件）
async function checkAgentStatus(agentId, agentName) {
    try {
        const response = await fetch(`${API_BASE}/agent/${agentId}`);
        const data = await response.json();
        
        if (data.success) {
            if (data.reliefTriggered) {
                console.log(`🎁 [自动救济] ${agentName} 已自动领取救济金，当前余额: $${data.agent.balance}`);
            }
            return data.agent;
        } else {
            console.error(`❌ Failed to check agent status:`, data.error);
            return null;
        }
    } catch (error) {
        console.error(`❌ Error checking agent status:`, error.message);
        return null;
    }
}

// 获取大厅所有赛区和活跃房间
async function getRooms() {
    console.log('🏛️  Fetching room list from lobby...');
    try {
        const response = await fetch(`${API_BASE}/rooms`);
        const data = await response.json();
        if (data.success) {
            const tierCount = data.tiers ? data.tiers.length : 0;
            const roomCount = data.activeRooms ? data.activeRooms.length : 0;
            console.log(`✅ Found ${tierCount} tiers, ${roomCount} active rooms in lobby`);
            return data; // 返回完整数据对象，包含 tiers 和 activeRooms
        } else {
            console.error('❌ Failed to fetch rooms:', data.error);
            return { tiers: [], activeRooms: [] };
        }
    } catch (error) {
        console.error('❌ Error fetching rooms:', error.message);
        return { tiers: [], activeRooms: [] };
    }
}

// 择木而栖：根据余额选择最高级别的可进入赛区
function selectBestTier(tiers, balance) {
    // 过滤出余额足够进入的赛区
    const accessibleTiers = tiers.filter(tier => balance >= tier.minBuyIn);
    
    if (accessibleTiers.length === 0) {
        console.log(`⚠️  余额 $${balance} 无法进入任何赛区`);
        return null;
    }
    
    // 选择最低入场要求最高的赛区（即最高级别赛区）
    const bestTier = accessibleTiers.reduce((best, current) => {
        return current.minBuyIn > best.minBuyIn ? current : best;
    });
    
    return bestTier;
}

// 创建牌桌
async function createTable() {
    console.log('📋 Creating table:', TABLE_ID);
    try {
        const response = await fetch(`${API_BASE}/table/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tableId: TABLE_ID,
                smallBlind: 10,
                bigBlind: 20
            })
        });
        const data = await response.json();
        if (data.success) {
            console.log('✅ Table created successfully');
            return true;
        } else {
            // 【关键修复】如果牌桌已存在，当做成功处理
            if (data.error && data.error.includes('已存在')) {
                console.log('ℹ️  Table already exists, continuing...');
                return true;
            }
            console.log('⚠️  Table creation response:', data.error || 'Unknown error');
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to create table:', error.message);
        console.error('❌ Error details:', error.response?.data || error);
        return false;
    }
}

// 【智能匹配】玩家加入指定赛区
// 返回系统实际分配的房间 ID
async function joinRoom(tierId, playerId, playerName, tierName) {
    console.log(`👤 ${playerName} attempting to join [${tierName}]...`);
    try {
        const response = await fetch(`${API_BASE}/room/${tierId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId,
                playerName
            })
        });
        const data = await response.json();
        if (data.success) {
            // 【破产救济金】如果收到救济金，显示特殊消息
            if (data.reliefGranted) {
                console.log(`🎁 ${playerName}: ${data.message}`);
            } else {
                console.log(`✅ ${playerName} successfully entered [${data.roomName}]`);
            }
            // 【关键返回】返回系统实际分配的房间 ID
            return {
                success: true,
                roomId: data.roomId,  // 系统实际分配的房间 ID
                roomName: data.roomName,
                tierId: data.tierId
            };
        } else {
            // 【幂等性修复】如果玩家已在房间中，视为成功（不是错误）
            const errorMsg = (data.error || '').toLowerCase();
            if (errorMsg.includes('已在') || errorMsg.includes('already in room')) {
                console.log(`✅ ${playerName} is already in [${tierName}] (idempotent join)`);
                // 注意：这里无法获取实际 roomId，需要从状态中推断
                return { success: true, roomId: null };
            }
            
            console.log(`⚠️  ${playerName} join failed:`, data.error);
            return { success: false };
        }
    } catch (error) {
        console.error(`❌ Failed to join ${playerName}:`, error.message);
        return { success: false };
    }
}

// 检查并初始化房间
async function ensureRoomReady() {
    console.log('\n🏛️  Initializing multi-room lobby system...\n');
    
    // 【动态机器人生成】每次运行都创建全新的随机机器人
    console.log('💰 Generating random bots and registering in bank system...');
    const agents = [];
    const BOT_COUNT = 3; // 可调整机器人数量
    
    // 性格池：随机分配给机器人
    const personalityTypes = ['Nit', 'TAG', 'Maniac'];
    const botPersonalities = new Map(); // 存储每个机器人的性格类型
    
    for (let i = 0; i < BOT_COUNT; i++) {
        // 生成随机机器人名字
        const botName = `Bot_${Math.floor(Math.random() * 10000)}`;
        
        // 随机分配性格
        const personality = personalityTypes[Math.floor(Math.random() * personalityTypes.length)];
        botPersonalities.set(botName, personality);
        
        console.log(`🤖 Creating ${botName} with personality: ${personality}`);
        
        const agent = await registerBot(botName);
        if (!agent) {
            console.error(`❌ Failed to register ${botName}, skipping...`);
            continue;
        }
        
        // 将性格类型附加到 agent 对象上
        agent.personality = personality;
        agents.push(agent);
        await sleep(300);
    }
    
    if (agents.length === 0) {
        throw new Error('Failed to register any bots');
    }
    
    console.log(`\n✅ Successfully registered ${agents.length} random bots!\n`);
    
    // 【多房间大厅】获取所有赛区模板
    const roomsData = await getRooms();
    if (!roomsData || !roomsData.tiers || roomsData.tiers.length === 0) {
        throw new Error('No tiers available in lobby');
    }
    
    const tiers = roomsData.tiers;
    
    console.log('\n🎰 Available tiers:');
    tiers.forEach(tier => {
        console.log(`   ${tier.name} (${tier.tierId}) - 盲注 ${tier.blinds[0]}/${tier.blinds[1]}, 最低 $${tier.minBuyIn}`);
    });
    console.log('');
    
    // 【择木而栖】每个机器人根据余额选择最高级别赛区
    const selectedTiers = new Map();
    
    for (const agent of agents) {
        const bestTier = selectBestTier(tiers, agent.balance);
        if (!bestTier) {
            console.log(`⚠️  ${agent.name} 余额 $${agent.balance} 无法进入任何赛区`);
            continue;
        }
        
        // 生动的入场日志
        let entranceMessage = '';
        if (bestTier.tierId === 'highroller') {
            entranceMessage = `💎 ${agent.name} 资产 $${agent.balance}，大摇大摆走进了 [${bestTier.name}]！`;
        } else if (bestTier.tierId === 'advanced') {
            entranceMessage = `⚔️  ${agent.name} 资产 $${agent.balance}，昂首阔步进入 [${bestTier.name}]`;
        } else {
            entranceMessage = `🌱 ${agent.name} 资产 $${agent.balance}，谨慎地来到 [${bestTier.name}]`;
        }
        console.log(entranceMessage);
        
        selectedTiers.set(agent.id, bestTier);
        await sleep(300);
    }
    
    console.log('');
    
    // 【智能匹配】让所有机器人加入各自选择的赛区，系统自动分配房间
    let allJoinedSuccess = true;
    const joinResults = [];
    const assignedRooms = new Map(); // 存储每个 agent 被分配到的实际房间 ID
    
    for (const agent of agents) {
        const tier = selectedTiers.get(agent.id);
        if (!tier) {
            console.error(`❌ ${agent.name} 没有选择到合适的赛区`);
            allJoinedSuccess = false;
            continue;
        }
        
        try {
            const result = await joinRoom(tier.tierId, agent.id, agent.name, tier.name);
            if (!result.success) {
                console.error(`❌ ${agent.name} 加入 [${tier.name}] 失败！`);
                allJoinedSuccess = false;
            } else {
                joinResults.push({ agent: agent.name, tier: tier.name });
                // 【关键】保存系统分配的实际房间 ID
                if (result.roomId) {
                    assignedRooms.set(agent.id, result.roomId);
                }
            }
        } catch (error) {
            console.error(`❌ ${agent.name} 加入 [${tier.name}] 时发生错误: ${error.message}`);
            allJoinedSuccess = false;
        }
        
        await sleep(500);
    }
    
    // 【修复】如果有任何一个机器人没有成功入座，立即退出程序
    if (!allJoinedSuccess) {
        console.error('\n💥 致命错误：部分机器人无法入座！');
        console.error('成功入座的机器人:');
        joinResults.forEach(r => console.error(`  ✓ ${r.agent} -> ${r.tier}`));
        console.error('\n请检查后端服务器状态和赛区配置。');
        console.error('程序即将退出...\n');
        process.exit(1);
    }
    
    console.log('\n✅ All bots have entered their tiers!\n');
    
    // 【关键】返回系统分配的实际房间 ID（用于后续游戏状态轮询）
    // 如果有多个房间，返回第一个分配的房间 ID
    const firstAssignedRoomId = assignedRooms.values().next().value;
    
    return {
        roomId: firstAssignedRoomId || 'beginner_default',
        agents,
        tiers,
        selectedTiers,
        assignedRooms  // 每个 agent 对应的实际房间 ID
    };
}

// 获取房间状态
// playerName: 可选，指定请求者的玩家名字，用于信息隔离（防止看到对手底牌）
async function getRoomState(roomId, playerName = null) {
    try {
        // 【信息隔离】如果提供了 playerName，附加到 URL 查询参数中
        const url = playerName 
            ? `${API_BASE}/room/${roomId}/state?playerName=${encodeURIComponent(playerName)}`
            : `${API_BASE}/room/${roomId}/state`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        // 【自愈机制】检测房间不存在的情况
        if (!data.success && data.error === 'ROOM_NOT_FOUND') {
            return { error: 'ROOM_NOT_FOUND', roomId };
        }
        
        return data.success ? data.state : null;
    } catch (error) {
        console.error('❌ 获取房间状态失败，报错原因:', error.message);
        return null;
    }
}

// 开始房间游戏
async function startRoomGame(roomId) {
    try {
        const response = await fetch(`${API_BASE}/room/${roomId}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('❌ 开始游戏失败:', error.message);
        return false;
    }
}
async function startNewHand() {
    try {
        console.log('\n🎬 正在命令服务器发牌...');
        await axios.post(`${API_BASE}/table/${TABLE_ID}/start`);
        return true;
    } catch (error) {
        return false;
    }
}

async function sendAction(roomId, playerId, actionData) {
    try {
        await axios.post(`${API_BASE}/room/${roomId}/action`, {
            playerId,
            ...actionData
        });
        return true;
    } catch (error) {
        console.error(`❌ 动作执行失败: ${error.response?.data?.error || error.message}`);
        return false;
    }
}

// 🧠 核心：让 DeepSeek 思考德州扑克策略
async function askDeepSeekToPlay(gameState, player, callAmount, agents) {
    // 【关键修复】检测是否为单挑局（Heads-Up）
    const activePlayers = gameState.players.filter(p => !p.folded && p.chips > 0);
    const isHeadsUp = activePlayers.length === 2;

    // 【AI 人格系统】根据机器人的性格类型注入不同的扑克策略
    const personalityTemplates = {
        'Nit': {
            name: 'Rock (Nit)',
            systemPrompt: `You are an extremely conservative rock player.

[CORE STRATEGY]
- You are an extremely conservative player who only plays premium hands
- If you don't have big pairs (AA, KK, QQ, JJ) or very strong hole cards (like AK, AQ), you must ruthlessly FOLD
- Never bluff, never be impulsive, only bet when you're certain of a high win rate
- Even if the pot is small, bad hands must FOLD - never waste chips

[STRICT CONSTRAINTS]
⚠️ You must strictly follow your personality to output actions!
⚠️ If you're conservative, even with a small pot, bad hands must FOLD!
⚠️ No bluffing, no impulse, only RAISE with premium hands!

[HAND STRENGTH DEFINITION]
- Premium hands: AA, KK, QQ, JJ, AK
- Strong hands: TT, 99, AQ, AJ
- All other hands: Must FOLD

[ACTION STYLE]
- Without strong hands: Decisively FOLD, no hesitation
- With strong hands: Small raise, typically 30%-50% of pot
- With premium hands: Raise 50%-100% of pot
- Public statements: Cautious, conservative, rational English phrases like "Bad hand, not wasting chips." or "Playing it safe."

${isHeadsUp ? '【单挑局调整】\n- 单挑局时，手牌价值略有提升\n- 但依然保持保守风格，只有 A 高牌、对子、同花听牌才考虑 CALL/RAISE\n- 小牌依然必须 FOLD' : ''}

你必须严格按照这个性格来做决策，并以 JSON 格式返回。`
        },
        'TAG': {
            name: 'Tight-Aggressive (TAG)',
            systemPrompt: `You are a smart professional player (Tight-Aggressive TAG).

[CORE STRATEGY]
- You are a smart professional player, selective pre-flop, aggressive post-flop
- RAISE decisively with good hands, FOLD immediately with bad hands
- Bet rationally based on community cards, not impulsive nor overly conservative
- Aggressively raise with good hands, decisively fold without them

[STRICT CONSTRAINTS]
⚠️ You must strictly follow your personality to output actions!
⚠️ Must RAISE with good hands, must FOLD with bad hands!
⚠️ Don't be overly conservative or aggressive, maintain balance!

[HAND STRENGTH DEFINITION]
- Premium hands: AA, KK, QQ, JJ, AK, AQ
- Strong hands: TT, 99, 88, AJ, KQ
- Medium hands: 77, 66, AT, KJ, QJ
- Weak hands: All other cards

[ACTION STYLE]
- Premium hands: Large raise, 70%-150% of pot
- Strong hands: Medium raise, 50%-80% of pot
- Medium hands: Small raise or CALL, 30%-50% of pot
- Weak hands: Decisively FOLD
- Public statements: Calm, rational, professional English phrases like "Strong hand, raising." or "Calculated aggression."

${isHeadsUp ? '【单挑局调整】\n- 单挑局时，手牌价值大幅提升\n- 任何对子、A 高牌、K 高牌都应该积极 RAISE\n- 只有极差的牌（如7-2, 8-3）才 FOLD' : ''}

你必须严格按照这个性格来做决策，并以 JSON 格式返回。`
        },
        'Maniac': {
            name: 'Maniac',
            systemPrompt: `You are a complete maniac!

[CORE STRATEGY]
- You are a complete maniac! No matter how bad your hole cards are, you must crazily RAISE or ALL_IN
- Extremely fond of bluffing and taunting opponents
- Almost never FOLD, either raise or go all-in
- Use crazy raises to pressure opponents and make them crumble

[STRICT CONSTRAINTS]
⚠️ You must strictly follow your personality to output actions!
⚠️ You're a maniac, must crazily RAISE, forbidden to FOLD!
⚠️ Even with 7-2, you must raise crazily, use momentum to crush opponents!

[ACTION STYLE]
- Any hand: Crazy RAISE, raise amount at least 80%-200% of pot
- Frequently choose ALL_IN, use chips to pressure opponents
- Almost never FOLD, unless out of chips
- Public statements: Arrogant, wild, provocative English phrases like "All in! Feel the pressure!" or "You can't handle this!" or "Crushing you with aggression!"

${isHeadsUp ? '【单挑局加强】\n- 单挑局时，更加疯狂！\n- 几乎每手都 RAISE 或 ALL_IN\n- 用疯狂的气势压垮对手，让他们崩溃！' : ''}

你必须严格按照这个性格来做决策，并以 JSON 格式返回。`
        }
    };

    // 【根据机器人的性格类型匹配人格】
    // 从 agents 数组中找到当前玩家的性格类型
    const currentAgent = agents.find(a => a.name === player.name);
    const personalityType = currentAgent ? currentAgent.personality : 'Maniac'; // 默认为疯狗
    const personality = {
        name: `${player.name} - ${personalityTemplates[personalityType].name}`,
        systemPrompt: personalityTemplates[personalityType].systemPrompt
    }

    // 构造牌局现场的情报
    const headsUpWarning = isHeadsUp ? `
    ⚠️ 【单挑局警告】⚠️
    当前是单挑局（Heads-Up），只剩你和对手两人对决！
    手牌价值评估需大幅提升，严禁频繁弃牌！
    除非手牌极差且对方大幅加注，否则应优先选择跟注（CALL）或加注（RAISE）来保持博弈！
    ` : '';

    const prompt = `
    【当前状态】
    阶段: ${gameState.stage}
    底池总金额: $${gameState.pot}
    桌上的公共牌: ${gameState.communityCards && gameState.communityCards.length > 0 ? gameState.communityCards.join(', ') : '暂无'}
    活跃玩家数: ${activePlayers.length} 人${isHeadsUp ? ' (单挑局！)' : ''}

    【你的情况】
    你的名字: ${player.name}
    你的手牌: ${player.hand.join(', ')}
    你剩余的筹码: $${player.chips}
    你需要跟注(CALL)的金额: $${callAmount}
    ${headsUpWarning}
    【决策要求】
    请严格按照你的性格设定来做决策。你可以选择：
    - CHECK (过牌，只有在需要跟注金额为0时可用)
    - CALL (跟注)
    - RAISE (加注，请指定金额)
    - FOLD (弃牌)

    【公共频道宣言】
    你必须在做出决策时，同时发表一句公共宣言（public_statement），这句话会在监控大屏上实时展示给所有人看！
    要求：
    - 严格限制在20个字以内（包括标点符号）
    - 必须符合你的性格特征，要放狠话、嘲讽、或展示气势
    - 不要解释策略，要像真实玩家一样放话
    - 例如："小牌也敢跟我玩？"、"梭哈才是王道！"、"你以为我怕你？"

    请务必以合法的 JSON 格式返回你的决定，格式如下：
    {
      "action": "CALL" | "RAISE" | "FOLD" | "CHECK",
      "amount": 加注时的金额数字(如果不是RAISE则写0),
      "public_statement": "你的公共宣言，20字以内，必须符合你的性格"
    }
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: `你是一个只输出严格 JSON 格式的德扑AI引擎。\n\n${personality.systemPrompt}` },
                { role: "user", content: prompt }
            ],
            response_format: { type: 'json_object' },
            timeout: 90000  // 90秒超时（适配大模型延迟）
        });

        // 解析 AI 返回的 JSON 决定
        let decision = JSON.parse(completion.choices[0].message.content);
        
        // 【关键修复】单挑局强制动作兜底：防止过度保守
        if (isHeadsUp && decision.action === 'FOLD' && callAmount > 0 && callAmount < 50) {
            console.log(`⚠️  ${player.name} 在单挑局想弃牌，但跟注金额很小 ($${callAmount})，强制修正为 CALL`);
            decision = {
                action: 'CALL',
                amount: 0,
                public_statement: '单挑不能怂，跟！'
            };
        }
        
        return decision;
    } catch (error) {
        console.error("AI 思考时睡着了，执行默认过牌/弃牌...", error.message);
        // 【关键修复】单挑局兜底逻辑也要更激进
        if (isHeadsUp && callAmount > 0 && callAmount < 50) {
            return { action: 'CALL', amount: 0, public_statement: "单挑不怂，跟！" };
        }
        return callAmount === 0 ? { action: 'CHECK', amount: 0, public_statement: "系统兜底" } : { action: 'FOLD', amount: 0, public_statement: "系统兜底" };
    }
}

async function run() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║  MoltPlayground 真 AI 思考引擎已启动   ║');
    console.log('║  DeepSeek-V3 正在接管所有机器人大脑... ║');
    console.log('╚════════════════════════════════════════╝\n');

    // 【多房间大厅】初始化房间并让机器人择木而栖
    let currentRoomId, agents, tiers, selectedTiers, assignedRooms;
    try {
        const initResult = await ensureRoomReady();
        currentRoomId = initResult.roomId;
        agents = initResult.agents;
        tiers = initResult.tiers;
        selectedTiers = initResult.selectedTiers;
        assignedRooms = initResult.assignedRooms;
    } catch (error) {
        console.error('\n💥 Fatal Error: 无法初始化房间系统');
        console.error('请确保:');
        console.error('1. 后端服务器运行在 http://127.0.0.1:3000');
        console.error('2. API 端点可访问\n');
        process.exit(1);
    }

    let roundCount = 0;
    let hasLoggedWaiting = false; // 状态锁：防止重复打印等待日志
    const botStates = new Map(); // 跟踪每个机器人的状态
    
    // 初始化机器人状态
    agents.forEach(agent => {
        botStates.set(agent.id, {
            name: agent.name,
            isActive: true,
            lastEvictionCheck: Date.now()
        });
    });

    while (true) {
        // 【信息隔离】不传 playerName，因为我们需要看到完整状态来判断轮到谁
        // 但在调用 askDeepSeekToPlay 时，只会传入当前玩家的底牌
        const gameState = await getRoomState(currentRoomId);
        
        // 【自愈机制】检测主房间是否已解散
        if (gameState && gameState.error === 'ROOM_NOT_FOUND') {
            console.log(`\n🔄 [自愈机制] 主房间 ${currentRoomId} 已解散，等待机器人重新匹配...`);
            await sleep(2000);
            continue;
        }
        
        // 【破产检测 & 自愈机制】检查每个机器人在其各自房间中的状态
        for (const agent of agents) {
            const botState = botStates.get(agent.id);
            const agentRoomId = assignedRooms.get(agent.id);
            
            if (!agentRoomId || !botState.isActive) continue;
            
            // 获取该机器人所在房间的状态
            const agentRoomState = await getRoomState(agentRoomId);
            
            // 【自愈机制】检测房间已解散的情况
            if (agentRoomState && agentRoomState.error === 'ROOM_NOT_FOUND') {
                console.log(`\n🔄 [自愈机制] 房间 ${agentRoomId} 已解散，${agent.name} 准备重新匹配...`);
                
                // 清除旧房间记忆，触发重新加入逻辑
                assignedRooms.delete(agent.id);
                botState.isActive = false;
                
                // 立即尝试重新加入
                const tier = selectedTiers.get(agent.id);
                if (tier) {
                    console.log(`🔍 [自愈机制] ${agent.name} 尝试重新加入 ${tier.name}...`);
                    const result = await joinRoom(tier.tierId, agent.id, agent.name, tier.name);
                    if (result.success && result.roomId) {
                        console.log(`✅ [自愈机制] ${agent.name} 已成功重新入座房间 ${result.roomId}！`);
                        assignedRooms.set(agent.id, result.roomId);
                        botState.isActive = true;
                    } else {
                        console.log(`❌ [自愈机制] ${agent.name} 重新入座失败`);
                    }
                }
                continue;
            }
            
            if (agentRoomState && agentRoomState.players) {
                const playerIds = new Set(agentRoomState.players.map(p => p.id));
                const isInRoom = playerIds.has(agent.id);
                
                // 如果机器人之前在房间内，现在不在了，说明被驱逐
                if (!isInRoom) {
                    console.log(`\n💀 [破产检测] ${agent.name} 已被驱逐出房间 ${agentRoomId}！`);
                    
                    // 检查状态并尝试触发救济金
                    console.log(`🔍 [破产恢复] 检查 ${agent.name} 的账户状态...`);
                    const updatedAgent = await checkAgentStatus(agent.id, agent.name);
                    
                    if (updatedAgent) {
                        // 检查是否有足够余额重新入座
                        const tier = selectedTiers.get(agent.id);
                        if (tier && updatedAgent.balance >= tier.minBuyIn) {
                            console.log(`💰 [破产恢复] ${agent.name} 余额充足 ($${updatedAgent.balance})，尝试重新入座...`);
                            const result = await joinRoom(tier.tierId, agent.id, agent.name, tier.name);
                            if (result.success) {
                                console.log(`✅ [破产恢复] ${agent.name} 已成功重新入座！`);
                                botState.isActive = true;
                                // 更新分配的房间 ID
                                if (result.roomId) {
                                    assignedRooms.set(agent.id, result.roomId);
                                }
                            } else {
                                console.log(`❌ [破产恢复] ${agent.name} 重新入座失败`);
                                botState.isActive = false;
                            }
                        } else {
                            // 余额不足且救济金在冷却期
                            if (updatedAgent.lastReliefAt) {
                                const now = new Date();
                                const lastRelief = new Date(updatedAgent.lastReliefAt);
                                const hoursRemaining = Math.ceil((24 * 60 * 60 * 1000 - (now - lastRelief)) / (60 * 60 * 1000));
                                console.log(`⏳ [等待] ${agent.name} 余额不足且救济金冷却中，需等待 ${hoursRemaining} 小时`);
                            } else {
                                console.log(`⏳ [等待] ${agent.name} 余额不足 ($${updatedAgent.balance} < $${tier.minBuyIn})`);
                            }
                            botState.isActive = false;
                        }
                    }
                    
                    botState.lastEvictionCheck = Date.now();
                }
            }
        }

        if (!gameState) {
            console.log('📡 正在寻找房间...');
            await sleep(2000);
            continue;
        }

        // 等待游戏自动开始（后端已实现自动开局）
        if (gameState.stage === 'waiting') {
            if (!hasLoggedWaiting) {
                console.log('⏳ 等待其他玩家加入，房间将自动开局...');
                hasLoggedWaiting = true;
            }
            await sleep(2000);
            continue;
        }
        
        // 重置等待日志锁（离开 waiting 状态后）
        if (hasLoggedWaiting && gameState.stage !== 'waiting') {
            hasLoggedWaiting = false;
        }

        // 显示局数统计（游戏会自动重启，无需手动触发）
        if (gameState.stage === 'FINISHED') {
            roundCount++;
            console.log(`\n🏆 ===== 第 ${roundCount} 局 结束 ===== 🏆`);
            const sortedPlayers = [...gameState.players].sort((a, b) => b.chips - a.chips);
            sortedPlayers.forEach((p, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                console.log(`${medal} ${p.name}: $${p.chips}`);
            });
            console.log('\n⏳ 游戏将在 5 秒后自动开始下一局...\n');
            await sleep(6000); // 等待后端自动重启
            continue;
        }

        // 核心打牌逻辑
        const currentPlayerId = gameState.currentPlayer;
        if (currentPlayerId) {
            const player = gameState.players.find(p => p.id === currentPlayerId);
            
            // 检查当前玩家是否是我们的机器人之一
            const botState = botStates.get(currentPlayerId);
            if (!botState || !botState.isActive) {
                // 不是我们的机器人或机器人已暂停，跳过
                await sleep(1000);
                continue;
            }
            const callAmount = gameState.currentBet - player.currentBet;

            // 【信息隔离】获取当前玩家的视角状态（隐藏对手底牌）
            const playerViewState = await getRoomState(currentRoomId, player.name);
            
            // 使用玩家视角状态来获取正确的底牌信息
            const viewPlayer = playerViewState ? playerViewState.players.find(p => p.id === currentPlayerId) : player;

            console.log(`\n-------------------------------------------------`);
            console.log(`🤔 正在呼叫 DeepSeek 为 [${player.name}] 思考策略...`);
            console.log(`📊 桌面情况 -> 阶段: ${gameState.stage} | 底池: $${gameState.pot} | 公共牌: ${gameState.communityCards.join(' ')}`);
            console.log(`🎴 玩家底牌 -> ${viewPlayer.hand.join(' ')} | 剩余筹码: $${viewPlayer.chips} | 需跟注: $${callAmount}`);

            // 🌟 见证奇迹的时刻：等待 AI 大脑的返回！
            // 传入隔离后的状态，确保 AI 看不到对手底牌
            const aiDecision = await askDeepSeekToPlay(playerViewState || gameState, viewPlayer, callAmount, agents);

            console.log(`\n💬 [${player.name}] 公共频道: "${aiDecision.public_statement}"`);
            console.log(`🎯 最终动作: ${aiDecision.action} ${aiDecision.amount > 0 ? '$'+aiDecision.amount : ''}`);

            const actionData = {
                action: aiDecision.action,
                amount: aiDecision.amount,
                statement: aiDecision.public_statement || ''
            };

            await sendAction(currentRoomId, currentPlayerId, actionData);

            // 为了防止请求太频繁被封，思考完休息 1.5 秒
            await sleep(1500); 
        } else {
            await sleep(1000);
        }
    }
}

run();