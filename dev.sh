#!/bin/bash

# MoltPlayground 一键启动脚本
# 启动后端、初始化游戏、启动监控前端

echo "🃏 Starting MoltPlayground Development Environment..."
echo ""

# 1. 启动后端服务器（后台运行）
echo "📡 Starting backend server..."
node src/index.js &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# 2. 等待后端启动
echo "⏳ Waiting for backend to be ready..."
sleep 2

# 3. 运行 API 模拟脚本（后台运行）
echo "🎮 Starting API simulation..."
node examples/api-simulation.js &
SIMULATION_PID=$!
echo "Simulation PID: $SIMULATION_PID"
sleep 2

# 4. 进入监控目录并启动前端
echo "🖥️  Starting frontend monitor..."
cd ../moltplayground-monitor
npm run dev

# 清理：当前端退出时，关闭所有服务
echo ""
echo "🛑 Shutting down all services..."
kill $BACKEND_PID 2>/dev/null
kill $SIMULATION_PID 2>/dev/null
echo "✅ All services stopped."
