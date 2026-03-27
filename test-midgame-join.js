/**
 * Test script for mid-game join waiting mechanism
 * This simulates a player joining while a game is in progress
 */

const API_BASE = 'http://localhost:3000/api';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testMidGameJoin() {
    console.log('🧪 Testing Mid-Game Join Mechanism\n');
    
    // Step 0: Register agents in database
    console.log('📝 Step 0: Registering agents in database...');
    const agents = [
        { id: 'test-player-1', name: 'TestPlayer1', balance: 5000 },
        { id: 'test-player-2', name: 'TestPlayer2', balance: 5000 },
        { id: 'test-player-3', name: 'TestPlayer3-MidGame', balance: 5000 }
    ];
    
    for (const agent of agents) {
        const registerRes = await fetch(`${API_BASE}/agent/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(agent)
        });
        const registerResult = await registerRes.json();
        if (!registerResult.success) {
            console.log(`⚠️  ${agent.name} already registered or error: ${registerResult.error}`);
        } else {
            console.log(`✅ ${agent.name} registered successfully`);
        }
    }
    
    // Step 1: Create two players and start a game
    console.log('\n📝 Step 1: Joining initial players to beginner tier...');
    
    // Join beginner tier
    const join1 = await fetch(`${API_BASE}/room/beginner/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agents[0].id, name: agents[0].name })
    });
    const result1 = await join1.json();
    
    if (!result1.success) {
        console.error(`❌ ${agents[0].name} join failed:`, result1.error);
        return;
    }
    console.log(`✅ ${agents[0].name} joined: ${result1.roomId}`);
    
    const join2 = await fetch(`${API_BASE}/room/beginner/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agents[1].id, name: agents[1].name })
    });
    const result2 = await join2.json();
    
    if (!result2.success) {
        console.error(`❌ ${agents[1].name} join failed:`, result2.error);
        return;
    }
    console.log(`✅ ${agents[1].name} joined: ${result2.roomId}`);
    
    const roomId = result1.roomId;
    
    if (!roomId) {
        console.error('❌ Failed to get roomId from join response');
        return;
    }
    
    // Wait for game to start
    await sleep(2000);
    
    // Check game state
    const stateRes = await fetch(`${API_BASE}/room/${roomId}/state`);
    const state = await stateRes.json();
    console.log(`\n🎮 Game State: ${state.data.stage}`);
    console.log(`   Players: ${state.data.players.map(p => p.name).join(', ')}`);
    
    // Step 2: Join a third player mid-game
    console.log('\n📝 Step 2: Adding third player mid-game...');
    
    const join3 = await fetch(`${API_BASE}/room/beginner/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agents[2].id, name: agents[2].name })
    });
    const result3 = await join3.json();
    
    if (!result3.success) {
        console.error(`❌ ${agents[2].name} join failed:`, result3.error);
        return;
    }
    console.log(`✅ ${agents[2].name} joined: ${result3.roomId}`);
    
    // Check state immediately after join
    await sleep(500);
    const stateAfterJoin = await fetch(`${API_BASE}/room/${roomId}/state`);
    const stateData = await stateAfterJoin.json();
    
    console.log('\n🔍 Checking Player3 status...');
    const player3State = stateData.data.players.find(p => p.id === agents[2].id);
    
    if (player3State) {
        console.log(`   Status: ${player3State.status}`);
        console.log(`   Hand: ${player3State.hand.length} cards`);
        console.log(`   Expected: status=WAITING, hand=0 cards`);
        
        if (player3State.status === 'WAITING' && player3State.hand.length === 0) {
            console.log('\n✅ SUCCESS: Mid-game joiner correctly set to WAITING status!');
        } else {
            console.log('\n❌ FAILED: Mid-game joiner not properly isolated!');
        }
    } else {
        console.log('\n❌ FAILED: Player3 not found in game state!');
    }
    
    // Step 3: Wait for next hand to start
    console.log('\n📝 Step 3: Waiting for next hand to start...');
    console.log('   (This will take ~10 seconds for current hand to finish)');
    
    // Poll for stage change
    let attempts = 0;
    let activated = false;
    while (attempts < 30 && !activated) {
        await sleep(2000);
        const checkState = await fetch(`${API_BASE}/room/${roomId}/state`);
        const checkData = await checkState.json();
        const p3 = checkData.data.players.find(p => p.id === agents[2].id);
        
        if (p3 && p3.status === 'ACTIVE' && p3.hand.length === 2) {
            console.log(`\n🎬 Player3 activated!`);
            console.log(`   Status: ${p3.status}`);
            console.log(`   Hand: ${p3.hand.length} cards`);
            console.log('\n✅ SUCCESS: Waiting player activated at new hand start!');
            activated = true;
        }
        attempts++;
    }
    
    if (!activated) {
        console.log('\n⏳ Test timeout - manual verification needed');
    }
}

testMidGameJoin().catch(console.error);
